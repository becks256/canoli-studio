import parse from 'css-tree/parser';
import walk from 'css-tree/walker';
import generate from 'css-tree/generator';
import {ident} from 'css-tree/utils';
import type {CssNode} from 'css-tree';
import { fontFamilyParts } from './font-families';

export interface SvgFontSource {
  family: string;
  sources: Blob[];
  weight: string;
  style: string;
  stretch: string;
}
/** Decoded, complete CSS URL tokens; escaped url() names retain their tokens. */
export function svgCssUrl(node:CssNode):string|undefined{
 if(node.type==='Url')return node.value;
 if(node.type==='Function'&&ident.decode(node.name).toLowerCase()==='url'&&node.children.size===1){
  const child=node.children.first!;if(child.type==='String')return child.value;if(child.type==='Hash')return '#'+ident.decode(child.value);
 }
 return;
}

/** No URL is fetched. Original decoded font payloads cross the worker boundary. */
export function svgFontDataUrl(value: string): Blob | null {
  const match = /^data:(font\/(?:ttf|otf|woff2?|collection)|application\/(?:font-sfnt|font-woff|x-font-ttf|x-font-opentype|octet-stream));base64,([\s\S]*)$/i.exec(value);
  if (!match) return null;
  let decoded: string;
  try { decoded = decodeURIComponent(match[2]); } catch { throw new Error('Invalid embedded SVG font URL encoding.'); }
  const text = decoded.replace(/\s/g, '');
  const padding = text.endsWith('==') ? 2 : text.endsWith('=') ? 1 : 0, body = text.slice(0, text.length - padding);
  if (!body || /[^A-Za-z0-9+/]/.test(body) || text.length % 4 === 1 || padding && (text.length % 4 !== 0 || body.length % 4 !== 4 - padding)) throw new Error('Invalid embedded SVG font encoding.');
  const bytes = Uint8Array.from(atob(text), c => c.charCodeAt(0));
  return new Blob([bytes], { type: match[1].toLowerCase() });
}

function ast(value: string, context: 'stylesheet' | 'declarationList' | 'value') {
  return parse(value, { context, parseCustomProperty: true, onParseError(error) { throw error; } });
}

export function svgCheckCssValue(value: string, allowedReference: (url: string) => boolean) {
  inspectCss(ast(value, 'value'), allowedReference);
}

export function svgTextFontFamily(value: string): string {
  const tree = ast(value, 'value');
  if (tree.type !== 'Value') throw new Error('Invalid SVG font family.');
  let words = 0, quoted = false;
  for (const node of tree.children) {
    if (node.type === 'Operator' && node.value === ',') { if (!words) throw new Error('Invalid SVG font family list.'); words = 0; quoted = false; }
    else if (node.type === 'String' && !words && node.value) { words = 1; quoted = true; }
    else if (node.type === 'Identifier' && !quoted && !['inherit','initial','unset','revert','revert-layer'].includes(ident.decode(node.name).toLowerCase())) words++;
    else throw new Error('Computed SVG font families require flattened import.');
  }
  if (!words) throw new Error('Invalid SVG font family list.');
  return generate(tree);
}

/** Use parsed tokens, including escaped names, rather than URL/semicolon regexes. */
function inspectCss(node: CssNode, allowedReference: (url: string) => boolean) {
  walk(node, current => {
    if (current.type === 'Raw') throw new Error('Unparsed SVG CSS is not admitted.');
    if (current.type === 'Atrule' && /^(?:import|(?:-\w+-)?keyframes)$/i.test(ident.decode(current.name))) throw new Error('SVG imports do not run animations or external stylesheets.');
    if (current.type === 'Declaration' && /^(?:animation|transition)(?:-|$)/i.test(ident.decode(current.property))) throw new Error('SVG imports do not run animations or transitions.');
    if (current.type === 'Function' && ['image','image-set','-webkit-image-set','cross-fade','-webkit-cross-fade'].includes(ident.decode(current.name).toLowerCase())) {
      for (const child of current.children) {
        if (child.type === 'String' && !allowedReference(child.value)) throw new Error('External SVG image strings are not loaded.');
        if (child.type === 'Function' && ['var','env','attr'].includes(ident.decode(child.name).toLowerCase())) throw new Error('Computed SVG image references are not admitted. Embed static image pixels first.');
      }
    }
    let url: string | undefined;
    if (current.type === 'Url') url = current.value;
    else if (current.type === 'Function' && ident.decode(current.name).toLowerCase() === 'url') {
      url=svgCssUrl(current);if(url===undefined)throw new Error('Invalid SVG CSS URL.');
    }
    if (url !== undefined && !allowedReference(url) && !svgFontDataUrl(url)) throw new Error('External SVG resources are not loaded. Embed static images or complete font files first.');
  });
}

export function svgStyleDeclarations(value: string, allowedReference: (url: string) => boolean): Record<string, string> {
  const tree = ast(value, 'declarationList'), result: Record<string, string> = Object.create(null), important = new Set<string>();
  inspectCss(tree, allowedReference);
  if (tree.type !== 'DeclarationList') throw new Error('Invalid SVG inline style.');
  for (const node of tree.children) {
    if (node.type !== 'Declaration') throw new Error('Invalid SVG declaration.');
    const key = ident.decode(node.property).toLowerCase();
    if (node.important || !important.has(key)) { result[key] = generate(node.value); if (node.important) important.add(key); }
  }
  return result;
}

export function svgFontStylesheet(value: string, allowedReference: (url: string) => boolean, issue: (message: string) => void): { fonts: SvgFontSource[]; otherRules: boolean } {
  const tree = ast(value, 'stylesheet'); inspectCss(tree, allowedReference);
  if (tree.type !== 'StyleSheet') throw new Error('Invalid SVG stylesheet.');
  const fonts: SvgFontSource[] = []; let otherRules = false;
  for (const rule of tree.children) {
    if (rule.type !== 'Atrule' || ident.decode(rule.name).toLowerCase() !== 'font-face' || rule.prelude || !rule.block) { otherRules = true; continue; }
    const fields = new Map<string, CssNode>();
    for (const declaration of rule.block.children) {
      if (declaration.type !== 'Declaration' || declaration.important) { issue('Unsupported SVG font-face declaration.'); continue; }
      const key = ident.decode(declaration.property).toLowerCase();
      if (!['font-family', 'src', 'font-weight', 'font-style', 'font-stretch', 'font-display'].includes(key)) issue(`SVG font-face ${key} requires flattened import.`);
      fields.set(key, declaration.value);
    }
    try {
      const familyNode = fields.get('font-family'), source = fields.get('src');
      if (!familyNode || !source) throw new Error('SVG font-face requires a family and embedded source.');
      const parts = fontFamilyParts(generate(familyNode));
      if (parts.length !== 1 || !parts[0].name || ['serif', 'sans-serif', 'monospace', 'cursive', 'fantasy', 'system-ui', 'inherit', 'initial', 'unset'].includes(parts[0].name)) throw new Error('Invalid SVG font-face family.');
      if (source.type !== 'Value') throw new Error('Invalid SVG font-face source.');
      const sources: Blob[] = []; let expectUrl = true;
      for (const node of source.children) {
        if (node.type === 'Operator' && node.value === ',' && !expectUrl) { expectUrl = true; continue; }
        if (node.type === 'Function' && ['format', 'tech'].includes(ident.decode(node.name).toLowerCase()) && !expectUrl) {
          const name = ident.decode(node.name).toLowerCase(), hint = node.children.toArray();
          if (name === 'tech' || hint.length !== 1 || !['String','Identifier'].includes(hint[0].type) || !['truetype','opentype','woff','woff2','truetype-variations','opentype-variations','woff2-variations'].includes(hint[0].type === 'String' ? hint[0].value : hint[0].type === 'Identifier' ? ident.decode(hint[0].name) : '')) issue('Unsupported SVG font format or technology hints require flattened import.');
          continue;
        }
        const url = node.type === 'Url' ? node.value : node.type === 'Function' && ident.decode(node.name).toLowerCase() === 'url' && node.children.size === 1 && node.children.first?.type === 'String' ? node.children.first.value : undefined;
        if (!expectUrl || url === undefined) throw new Error('SVG font sources require embedded file URLs; local() and SVG fonts require flattened import.');
        const blob = svgFontDataUrl(url); if (!blob) throw new Error('SVG font sources require complete embedded font files.');
        sources.push(blob); expectUrl = false;
      }
      if (expectUrl || !sources.length) throw new Error('Missing SVG font source.');
      const field = (key: string, fallback: string) => fields.has(key) ? generate(fields.get(key)!).toLowerCase() : fallback;
      const weight = field('font-weight', 'normal'), style = field('font-style', 'normal'), stretch = field('font-stretch', 'normal');
      if (!/^(?:normal|bold|[\d.]+(?:\s+[\d.]+)?)$/.test(weight) || !['normal', 'italic'].includes(style) || !/^(?:normal|(?:ultra-|extra-|semi-)?(?:condensed|expanded)|[\d.]+%(?:\s+[\d.]+%)?)$/.test(stretch)) throw new Error('Unsupported SVG font-face matching descriptors.');
      fonts.push({ family: parts[0].name, sources, weight, style, stretch });
    } catch (error) { issue(error instanceof Error ? error.message : String(error)); }
  }
  return { fonts, otherRules };
}
