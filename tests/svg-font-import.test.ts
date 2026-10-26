import {expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {inspectSvgSource} from '../src/core/svg-import';
import {validateSvgInspection} from '../src/engine/svg-import';
import {allLayers} from '../src/core/model';
const wrap=(body:string)=>`<svg xmlns="http://www.w3.org/2000/svg" width="300" height="150">${body}</svg>`;
const original=readFileSync('tests/fixtures/fonts/Regular.ttf'),url='data:font/ttf;base64,'+original.toString('base64');

it('retains complete embedded source bytes from font-face rules in inert definitions',async()=>{
 const result=inspectSvgSource(wrap(`<defs><style>@font-face{font-family:"Brand; Face";src:url("${url}") format("truetype");font-weight:400}</style></defs><text x="20" y="60" style='font-family:"Brand; Face";font-size:40px'>AAAA</text>`));
 expect(result.report.canImportEditable,result.report.unsupportedFeatures.join('\n')).toBe(true);expect(result.report).toMatchObject({fonts:1,texts:1});expect(Buffer.from(await result.fonts[0].sources[0].arrayBuffer())).toEqual(original);expect(result.fonts[0].family).toBe('brand; face');expect(result.document?.fontFiles).toBeUndefined();expect(validateSvgInspection(result).texts).toEqual(result.texts);
});
it('keeps whole-line native typography, inherited style and independent positioned lines',()=>{
 const result=inspectSvgSource(wrap('<g font-size="20" font-family="serif" direction="rtl" text-anchor="end"><text x="10" y="40"> A <tspan>B</tspan> C </text><text font-size="150%"><tspan x="80" y="80">First</tspan><tspan x="80" dy="1em">Second</tspan></text></g>'));
 expect(result.report.canImportEditable,result.report.unsupportedFeatures.join('\n')).toBe(true);const text=allLayers(result.document!.children).filter(l=>l.kind==='text');expect(text.map(l=>l.text)).toEqual(['A B C','First','Second']);expect(text.map(l=>l.fontSize)).toEqual([20,30,30]);expect(text.every(l=>l.direction==='rtl'&&l.align==='left')).toBe(true);expect(result.texts.map(p=>({x:p.x,y:p.y}))).toEqual([{x:10,y:40},{x:80,y:80},{x:80,y:110}]);
});
it('preserves literal spaces without silently converting unsupported tabs or positioning',()=>{
 const good=inspectSvgSource(wrap('<text x="0" y="30" xml:space="preserve">  A <tspan>B</tspan>  </text>'));expect(good.report.canImportEditable).toBe(true);expect(allLayers(good.document!.children).find(l=>l.kind==='text')?.text).toBe('  A B  ');
 for(const content of ['<text style="white-space:pre">A\tB</text>','<text x="0 10">AB</text>','<text textLength="50">AB</text>','<text dominant-baseline="middle">AB</text>','<text><textPath href="#p">AB</textPath></text>']){const result=inspectSvgSource(wrap(content));expect(result.report.canImportEditable,content).toBe(false);expect(result.document).toBeUndefined();expect(result.texts).toEqual([]);}
});
it.each(['@im\\70ort "https://example.invalid/a.css";','@font-face{font-family:Brand;src:url(https://example.invalid/a.ttf)}','text{fill:u\\72l("https://example.invalid/a")}','text{--x:url(https://example.invalid/a);fill:var(--x)}','text{anim\\61tion:move 1s}'])('rejects escaped, custom-property and font external access: %s',css=>{
 expect(()=>inspectSvgSource(wrap(`<style>${css}</style><text>AB</text>`))).toThrow();
});
it('reports stylesheet selectors in defs and unsupported font descriptors before editable publication',()=>{
 for(const rules of [`@font-face{font-family:Brand;src:url("${url}");unicode-range:U+0041}`,`text{fill:red}`,`@media all{ text{fill:red} }`]){const result=inspectSvgSource(wrap(`<defs><style>${rules}</style></defs><text font-family="Brand">AAAA</text>`));expect(result.report.canImportEditable).toBe(false);expect(result.report.unsupportedFeatures.length).toBeGreaterThan(0);expect(()=>validateSvgInspection(result)).not.toThrow();}
});
it('rejects forged placement/resource envelopes before native reconstruction',()=>{
 const result=inspectSvgSource(wrap(`<style>@font-face{font-family:Brand;src:url("${url}")}</style><text font-family="Brand">AAAA</text>`));
 for(const changed of [{...result,texts:[]},{...result,texts:[...result.texts,...result.texts]},{...result,fontFiles:[]},{...result,fonts:[{...result.fonts[0],sources:['untrusted URL']}]},{...result,report:{...result.report,fonts:0}}])expect(()=>validateSvgInspection(changed)).toThrow();
});

it('normalizes unquoted family whitespace and CSS keyword case without treating computed values as families',()=>{
 const result=inspectSvgSource(wrap('<text font-family="Brand   Face" font-weight="BOLD" font-style="ITALIC" text-anchor="MIDDLE" direction="RTL">AAAA</text>'));expect(result.report.canImportEditable).toBe(true);const text=allLayers(result.document!.children).find(l=>l.kind==='text');expect(text).toMatchObject({fontFamily:'Brand Face',fontWeight:'bold',fontStyle:'italic',align:'center',direction:'rtl'});
 for(const family of ['var(--brand)','Brand,initial'])expect(inspectSvgSource(wrap(`<text font-family="${family}">AAAA</text>`)).report.canImportEditable).toBe(false);
});
it('does not silently use fonts with unsupported source format or technology hints',()=>{
 for(const hint of ['format("unknown-font")','tech(incremental)']){const result=inspectSvgSource(wrap(`<style>@font-face{font-family:Brand;src:url("${url}") ${hint}}</style><text font-family="Brand">AAAA</text>`));expect(result.report.canImportEditable).toBe(false);expect(result.report.unsupportedFeatures.join(' ')).toContain('hints');expect(result.document).toBeUndefined();}
});
it.each(['image-set("https://example.invalid/a.png" 1x)','-webkit-image-set("https://example.invalid/a.png" 1x)','image("https://example.invalid/a.png",red)'])('rejects image-function URL strings before either import mode: %s',value=>{
 expect(()=>inspectSvgSource(wrap(`<style>text{background-image:${value}}</style><text>AAAA</text>`))).toThrow(/External SVG/);
});
it('rejects computed image references while preserving inert embedded image options',()=>{
 expect(()=>inspectSvgSource(wrap('<style>text{--address:"https://example.invalid/a.png";background-image:image-set(var(--address) 1x)}</style>'))).toThrow(/Computed SVG/);
 const image='data:image/png;base64,'+readFileSync('tests/fixtures/raw/bayer-rggb.png').toString('base64');const result=inspectSvgSource(wrap(`<style>text{background-image:image-set("${image}" 1x)}</style><text>AAAA</text>`));expect(result.report.canImportEditable).toBe(false);expect(()=>validateSvgInspection(result)).not.toThrow();
});
it('decodes URI-encoded base64 font payloads without altering the supplied original bytes',async()=>{
 const escaped=[...original.toString('base64')].map(c=>'%'+c.charCodeAt(0).toString(16)).join(''),result=inspectSvgSource(wrap(`<style>@font-face{font-family:Brand;src:url("data:font/ttf;base64,${escaped}")}</style><text font-family="Brand">AAAA</text>`));expect(result.report.canImportEditable).toBe(true);expect(Buffer.from(await result.fonts[0].sources[0].arrayBuffer())).toEqual(original);
});
it.each(['transform:translate(50px,0)','tr\\61nsform:translate(50px,0)','x:50px','\\78:50px','w\\69 dth:50px'])('requires explicit flatten for parsed CSS geometry instead of dropping it: %s',style=>{
 const result=inspectSvgSource(wrap(`<rect width="10" height="10" style="${style}"/>`));expect(result.report.canImportEditable).toBe(false);expect(result.report.unsupportedFeatures).toContain('CSS transforms and geometry properties require flattened import.');expect(result.document).toBeUndefined();expect(()=>validateSvgInspection(result)).not.toThrow();
});
it.each(['dx:50px','d\\78:50px','dy:20px'])('never treats inline CSS as text-position attributes: %s',style=>{
 const result=inspectSvgSource(wrap(`<text x="20" y="60" dx="5" dy="3" style="${style}">AAAA</text>`));expect(result.report.canImportEditable).toBe(false);expect(result.report.unsupportedFeatures).toContain('CSS transforms and geometry properties require flattened import.');expect(result.document).toBeUndefined();
 const attributes=inspectSvgSource(wrap('<text x="20" y="60" dx="5" dy="3">AAAA</text>'));expect(attributes.report.canImportEditable).toBe(true);expect(attributes.texts).toEqual([{layerId:expect.any(String),x:25,y:63}]);
});
