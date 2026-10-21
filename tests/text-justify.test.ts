import {describe,it,expect} from 'vitest';
import {Document,TextLayer,LayerGroup,VectorLayer} from '../src/dom';
import {layoutText} from '../src/core/text-layout';
import {parseCommands} from '../src/core/validation';
import {svgTextElements} from '../src/core/svg-text';
const measure=(text:string,spacing=0)=>text.length*10+(text.match(/[ \u00a0]/g)?.length??0)*spacing;
const flow=(text:string,options:Partial<Parameters<typeof layoutText>[0]>={})=>layoutText({text,fontSize:10,lineHeight:1,wrapWidth:90,paragraphJustify:'inter-word',...options},(text,spacing)=>measure(text,spacing??options.wordSpacing??0));

describe('native inter-word paragraph justification',()=>{
 it('expands only soft visual lines without changing authored spacing or hard/final lines',()=>{
  const text='one two three\nfour five six\u2028seven eight nine',result=flow(text);
  expect(result.lines.map(x=>x.text)).toEqual(['one two','three','four five','six','seven','eight','nine']);
  expect(result.lines[0].wordSpacing).toBe(20);expect(measure(result.lines[0].text,result.lines[0].wordSpacing)).toBe(90);
  for(const line of result.lines.slice(1))expect(line.wordSpacing).toBeUndefined();
  expect(result.height).toBe(70);expect(text).toBe('one two three\nfour five six\u2028seven eight nine');
 });
 it('respects physical alignment, logical indentation, signed spacing and literal separators',()=>{
  for(const direction of ['ltr','rtl'] as const)for(const align of ['left','center','right'] as const){
   const result=flow('a b c d e',{wrapWidth:70,firstLineIndent:10,direction,align,wordSpacing:-5});
   const first=result.lines[0];expect(measure(first.text,first.wordSpacing)).toBe(60);expect(first.wordSpacing).toBeGreaterThan(-5);
   expect(first.x).toBe(align==='left'?(direction==='rtl'?0:10):align==='right'?(direction==='rtl'?60:70):(direction==='rtl'?30:40));
  }
  const literal=flow(' a\u00a0b c longer',{wrapWidth:85});expect(literal.lines[0].text).toBe(' a\u00a0b c');expect(measure(literal.lines[0].text,literal.lines[0].wordSpacing)).toBe(85);
 });
 it('keeps point text, single words, no-space CJK, overflow and forced breaks unexpanded',()=>{
  for(const [text,options] of [['one two',{wrapWidth:null}],['unbreakable longer',{wrapWidth:1}],['你好世界',{wrapWidth:20}],['one two\u2028end',{}]] as const){
   expect(flow(text,options).lines.every(x=>x.wordSpacing===undefined)).toBe(true);
  }
  expect(()=>flow('one two three')).not.toThrow();
  expect(flow(' word longword',{wrapWidth:60}).lines[0].wordSpacing).toBeUndefined();
  expect(flow('a b c\n8\0a b c',{wrapWidth:38}).lines[0].wordSpacing).toBe(8);
  const unicode={text:'a\u2003b c',fontSize:10,lineHeight:1,wrapWidth:38,paragraphJustify:'inter-word' as const};
  expect(layoutText(unicode,(text,spacing=0)=>text.length*10+(text.match(/[ \u2003]/g)?.length??0)*spacing).lines[0].wordSpacing).toBe(8);
  expect(layoutText(unicode,measure).lines[0].wordSpacing).toBeUndefined();
  expect(()=>layoutText({text:'one two three',fontSize:10,lineHeight:1,wrapWidth:90,paragraphJustify:'inter-word'},t=>t.length*10)).toThrow(/cannot apply inter-word/);
 });
 it('retains an exact fractional frame while bounding cumulative native word-gap rounding',()=>{
  const first='a b c d e f g h i j k l m n o p q r s t',width=first.length*10+3.2;
  const quantized=(text:string,spacing=0)=>text.length*10+(text.match(/ /g)?.length??0)*Math.round(spacing*64)/64;
  const result=layoutText({text:first+' extra',fontSize:10,lineHeight:1,wrapWidth:width,paragraphJustify:'inter-word'},quantized),line=result.lines[0];
  expect(result.width).toBe(width);expect(line.text).toBe(first);const actual=quantized(line.text,line.wordSpacing);
  expect(actual).toBeLessThanOrEqual(width+1/64);expect(width-actual).toBeLessThanOrEqual(19/64);
 });
 it('persists an optional strict field, resets in one command and honors ancestor locks',()=>{
  const doc=new Document(),group=doc.layers.add(new LayerGroup()),layer=group.layers.add(new TextLayer({text:'one two three',wrapWidth:90,paragraphJustify:'inter-word'}));
  const before=doc.toJSON(),past=doc.getSnapshot().past.length;layer.resetParagraph();expect(layer.paragraphJustify).toBe('none');expect(layer.wrapWidth).toBeUndefined();expect(doc.getSnapshot().past.length).toBe(past+1);doc.undo();expect(doc.toJSON()).toEqual(before);
  group.locked=true;const locked=doc.toJSON();expect(()=>{layer.paragraphJustify='none';}).toThrow(/Unlock/);expect(doc.toJSON()).toEqual(locked);
  expect(()=>parseCommands([{type:'layer.update',id:layer.id,patch:{paragraphJustify:'all'}}])).toThrow();
  const vector=doc.layers.add(new VectorLayer());expect(()=>vector.update({paragraphJustify:'inter-word'})).toThrow(/text layer/);
 });
 it('upgrades old roots/history without injecting justification and rejects old labels including explicit none',()=>{
  const doc=new Document();doc.layers.add(new TextLayer({text:'Legacy',wrapWidth:90}));doc.name='Later';
  for(let schemaVersion=1;schemaVersion<=26;schemaVersion++){
   // Paragraph fields are valid only starting with 26.
   const legacy=doc.toJSON();if(schemaVersion<26)for(const node of legacy.children)if(node.kind==='text')delete node.wrapWidth;
   if(schemaVersion<26)for(const node of legacy.children)if(node.kind==='text'){node.width=60;}
   const restored=Document.fromJSON({...legacy,schemaVersion});expect(restored.toJSON().schemaVersion).toBe(39);expect(restored.toJSON().children[0]).not.toHaveProperty('paragraphJustify');
  }
  for(const paragraphJustify of ['none','inter-word'] as const){const data=new Document();data.layers.add(new TextLayer({paragraphJustify}));for(const source of [data.toJSON(),data.getSnapshot().document])expect(()=>Document.fromJSON({...source,schemaVersion:26})).toThrow(/version 27/);}
  const state=doc.getSnapshot(),old=(document:ReturnType<Document['toJSON']>)=>({...document,schemaVersion:26 as const}),restored=Document._fromWorkspace(old(doc.toJSON()),{version:1,past:state.past.map(e=>({...e,document:old(e.document)})),future:[]});restored.undo();expect(restored.name).toBe('Untitled');restored.redo();expect(restored.toJSON()).toEqual(doc.toJSON());
 });
 it('validates private SVG per-line spacing and retains whole editable text elements',()=>{
  const layer=new TextLayer({text:'one two three',wrapWidth:90,paragraphJustify:'inter-word'}).toJSON();if(layer.kind!=='text')throw new Error('Expected text');
  const layout={baselines:[8,18],color:'#ffffff',letterSpacing:0,lines:['one two','three'],xPositions:[0,0],wordSpacings:[20,0]},svg=[...svgTextElements(layer,layout)].join('');expect(svg).toContain('word-spacing="20"');expect(svg).toContain('word-spacing="0"');expect(svg.match(/<text /g)).toHaveLength(2);expect(svg).not.toContain('<image');
  for(const wordSpacings of [[NaN,0],[20],[Infinity,0]])expect(()=>[...svgTextElements(layer,{...layout,wordSpacings})]).toThrow(/justification spacing/);
 });
});
