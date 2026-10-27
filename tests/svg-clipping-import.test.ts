import {expect,it}from 'vitest';
import {inspectSvgSource}from '../src/core/svg-import';
import {allLayers}from '../src/core/model';
import {Document}from '../src/dom';
import {validateSvgInspection}from '../src/engine/svg-import';
import {svgClipReference}from '../src/core/svg-clip-import';
import {svgClippingCases,svgClipSource}from './helpers/svg-clipping-fixtures';
for(const scene of svgClippingCases)it(`SVG ${scene.name} publishes a fully validated editable mask document`,()=>{
 const result=inspectSvgSource(scene.source);expect(result.report.canImportEditable,result.report.unsupportedFeatures.join('\n')).toBe(true);expect(()=>validateSvgInspection(result)).not.toThrow();expect(()=>Document.fromJSON(result.document)).not.toThrow();
 const masks=allLayers(result.document!.children).flatMap(layer=>layer.mask?[layer.mask]:[]);
 expect(masks.length).toBeGreaterThan(0);expect(masks.every(mask=>mask.kind==='vector'&&mask.linked&&mask.enabled)).toBe(true);
});
it('a native mask edit is owned, reversible and independent of other instances',()=>{
 const source=svgClippingCases.find(scene=>scene.name==='reused-definition')!,result=inspectSvgSource(source.source),doc=Document.fromJSON(result.document),masked=allLayers(doc.toJSON().children).filter(layer=>layer.mask),a=doc.getLayer(masked[0].id)!,b=doc.getLayer(masked[1].id)!,before=doc.toJSON(),past=doc.getSnapshot().past.length,other=b.mask!.toJSON();
 a.mask=a.mask!.with({x:20});expect(doc.getSnapshot().past.length).toBe(past+1);expect(b.mask!.toJSON()).toEqual(other);doc.undo();expect(doc.toJSON()).toEqual(before);
});
it('clip rules inherit from definitions and do not inherit from referencing artwork',()=>{
 const scene=svgClippingCases.find(scene=>scene.name==='definition-inheritance')!,result=inspectSvgSource(scene.source),mask=allLayers(result.document!.children).find(layer=>layer.mask)!.mask!;expect(mask.kind==='vector'?mask.fillRule:null).toBe('evenodd');
});
it('parses complete local URL tokens including escaped names without accepting fallback syntax',()=>{
 expect(svgClipReference('url("#mask")')).toBe('mask');expect(svgClipReference('u\\72l(#mask)')).toBe('mask');expect(svgClipReference('N\\4f NE')).toBeNull();
 for(const input of ['url(#mask) none','inset(2px)','url(https://example.invalid/a.svg#mask)','url(#)','var(--clip)'])expect(()=>svgClipReference(input)).toThrow();
});
for(const body of [
 '<defs><clipPath id="clip"><text>Unsupported text</text></clipPath></defs>',
 '<defs><clipPath id="clip"><use href="#group"/></clipPath><g id="group"><rect width="20" height="20"/></g></defs>',
 '<defs><clipPath id="clip" clip-path="url(#clip)"><rect width="20" height="20"/></clipPath></defs>',
 '<defs><clipPath id="clip"><rect width="20" height="20" style="transform:scale(2)"/></clipPath></defs>',
 '<defs><clipPath id="clip" clipPathUnits="invalid"><rect width="20" height="20"/></clipPath></defs>',
 '<defs><clipPath id="clip"><rect width="20" height="20" clip-rule="invalid"/></clipPath></defs>',
 '<defs><clipPath id="clip"><rect width="20" height="20" filter="url(#blur)"/></clipPath></defs>',
 '<defs><mask id="clip"><rect width="20" height="20"/></mask></defs>',
 '',
])it('unsupported clipping publishes no partial document: '+body.slice(0,70),()=>{
 const result=inspectSvgSource(svgClipSource(body+'<rect width="160" height="120" fill="red" clip-path="url(#clip)"/>'));expect(result.report.canImportEditable).toBe(false);expect(result.document).toBeUndefined();expect(result.assets).toEqual([]);expect(()=>validateSvgInspection(result)).not.toThrow();
});
it('inline clipping cannot silently disappear during character preparation',()=>{
 const source=svgClipSource('<defs><clipPath id="clip"><rect width="100" height="100"/></clipPath></defs><text y="40"><tspan clip-path="url(#clip)">Clipped inline</tspan></text>');expect(inspectSvgSource(source).report.canImportEditable).toBe(false);
});
