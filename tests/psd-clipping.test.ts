import {readFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {parsePsdAsync,getPsdCapabilityReport} from '../src/core/interchange/psd/parser';
import {psdToDocumentAsync,documentToPsd} from '../src/core/interchange/psd/bridge';
import {Document,PaintLayer,LayerGroup,LayerStyle,AdjustmentLayer}from '../src/dom';
import {planPsdExport}from '../src/core/interchange/psd/export-plan';
import {getExportCapabilityReport}from '../src/engine/export';
if(typeof globalThis.ImageData==='undefined')globalThis.ImageData=class{width:number;height:number;data:Uint8ClampedArray;constructor(data:Uint8ClampedArray|number,width:number,height?:number){this.width=typeof data==='number'?data:width;this.height=typeof data==='number'?width:height!;this.data=typeof data==='number'?new Uint8ClampedArray(data*width*4):data;}}as unknown as typeof ImageData;
const root='tests/fixtures/psd/clipping/',manifest=JSON.parse(readFileSync(root+'manifest.json','utf8'))as{cases:{name:string;file:string;editable:boolean}[]};
for(const scenario of manifest.cases)it(`independent Photoshop ${scenario.name} reports and imports its actual clipping boundary`,async()=>{
 const bytes=readFileSync(root+scenario.file),parsed=await parsePsdAsync(bytes),report=getPsdCapabilityReport(parsed),imported=await psdToDocumentAsync(bytes);
 expect(report.canImportAsLayers).toBe(scenario.editable);
 if(scenario.editable){
  const nodes=imported.document.children,scope=nodes[1]?.kind==='group'?nodes[1].children:nodes;
  expect(scope.at(-1)?.clipped).toBe(true);expect(scope.at(-2)?.clipped).toBeUndefined();
  expect(report.supportedConstructs.join(' ')).toContain('Editable sibling pixel clipping');
 }else{expect(report.warnings.join(' ')).toMatch(/clipping|knockout/);expect(imported.document.children).toHaveLength(1);expect(imported.document.children[0].clipped).toBeUndefined();}
});
for(const reason of ['group-base','group-member','base-fill','base-style','adjustment','orphan']as const)it(`Photoshop export keeps ${reason} clipping on its disclosed baked path`,()=>{
 const doc=new Document(),base=doc.layers.add(reason==='group-base'?new LayerGroup({name:'Base'}):new PaintLayer({name:'Base'}));
 if(reason==='base-fill')base.fillOpacity=.5;
 if(reason==='base-style')base.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#ff0000'}});
 if(reason==='orphan')base.clipped=true;
 doc.layers.add(reason==='group-member'?new LayerGroup({clipped:true,name:'Member'}):reason==='adjustment'?new AdjustmentLayer({clipped:true,name:'Member'}):new PaintLayer({clipped:true,name:'Member'}));
 doc.layers.add(new PaintLayer({name:'Later'}));
 const plan=planPsdExport(doc.toJSON());expect(plan.mergedThrough).toBe(1);expect(plan.layers.map(layer=>layer.name)).toEqual(['Merged through Member','Later']);expect(plan.layers.some(layer=>layer.clipped)).toBe(false);
 expect(getExportCapabilityReport(doc.toJSON(),{format:'psd'}).featuresDegradedOrOmitted.join(' ')).toContain('clipping');
});
it('a dependent prefix cannot strand later native members without their base',()=>{
 const doc=new Document(),group=doc.layers.add(new LayerGroup({blendMode:'pass-through'}));group.layers.add(new AdjustmentLayer());group.layers.add(new PaintLayer());group.layers.add(new PaintLayer({clipped:true}));
 const plan=planPsdExport(doc.toJSON());expect(plan.mergedThrough).toBe(0);expect(plan.layers).toHaveLength(1);expect(plan.layers[0].clipped).toBeUndefined();
});
it('low-level PSD serialization rejects clipping rather than producing an unclipped preview',async()=>{
 const doc=new Document();doc.layers.add(new PaintLayer({clipped:true}));await expect(documentToPsd(doc.toJSON(),()=>null)).rejects.toThrow('requires rendered PSD export');
});
