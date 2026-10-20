import {describe,it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {Document,LayerGroup,RasterLayer,LayerStyle} from '../src/dom';
import {parseCommands} from '../src/core/validation';
import {parsePsdAsync,getPsdCapabilityReport} from '../src/core/interchange/psd/parser';
import {psdToDocumentAsync} from '../src/core/interchange/psd/bridge';
import {planPsdExport} from '../src/core/interchange/psd/export-plan';
import {planSvgComposition} from '../src/core/svg-composition';
import {psdLayerTree} from '../src/core/interchange/psd/groups';

if(typeof ImageData==='undefined')globalThis.ImageData=class{readonly data:Uint8ClampedArray;readonly colorSpace='srgb';constructor(readonly width:number,readonly height:number){this.data=new Uint8ClampedArray(width*height*4);}} as unknown as typeof ImageData;
const root='tests/fixtures/psd/groups/';

describe('native pass-through group contracts',()=>{
 it('uses shared commands, atomic undo and schema-28 compatibility guards',()=>{
  const doc=new Document(),group=doc.layers.add(new LayerGroup({blendMode:'pass-through'}));
  expect(group.blendMode).toBe('pass-through');expect(doc.toJSON().schemaVersion).toBe(37);
  doc.transaction('Change group',()=>{group.opacity=.5;group.blendMode='normal';});doc.undo();expect(group.blendMode).toBe('pass-through');expect(group.opacity).toBe(1);
  expect(()=>Document.fromJSON({...doc.toJSON(),schemaVersion:27})).toThrow(/schema 28/);
  const legacy=new Document();legacy.layers.add(new LayerGroup());const restored=Document.fromJSON({...legacy.toJSON(),schemaVersion:27});expect(restored.toJSON().schemaVersion).toBe(37);expect(restored.layers.at(0)!.blendMode).toBe('normal');
  const raster=doc.layers.add(new RasterLayer({assetId:'source',width:3,height:2}));expect(()=>{raster.blendMode='pass-through';}).toThrow(/requires a group/);
  expect(parseCommands([{type:'layer.update',id:group.id,patch:{blendMode:'pass-through'}}])).toHaveLength(1);
 });
 it('rejects unsupported own styles/fill atomically while retaining masks and group opacity',()=>{
  const doc=new Document(),group=doc.layers.add(new LayerGroup({blendMode:'pass-through'})),before=doc.toJSON();
  expect(()=>{group.fillOpacity=.5;}).toThrow(/full fill opacity/);expect(doc.toJSON()).toEqual(before);
  expect(()=>{group.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#ff0000',opacity:1}});}).toThrow(/disabled group styles/);expect(doc.toJSON()).toEqual(before);
  group.opacity=.25;expect(group.opacity).toBe(.25);
 });
 it('retains Photoshop folders while SVG bakes its native dependent prefix without mutating the group',()=>{
  const doc=new Document();doc.layers.add(new RasterLayer({assetId:'backdrop',width:10,height:10}));const group=doc.layers.add(new LayerGroup({blendMode:'pass-through'}));group.layers.add(new RasterLayer({assetId:'child',width:10,height:10,blendMode:'multiply'}));doc.layers.add(new RasterLayer({assetId:'top',width:2,height:2}));const before=doc.toJSON();
  const plan=planPsdExport(before);expect(plan.mergedThrough).toBe(-1);expect(plan.layers).toHaveLength(3);expect(plan.layers.every(layer=>!layer.merged)).toBe(true);expect(plan.records.filter(record=>record.kind==='group')).toHaveLength(1);
  expect(planSvgComposition(before).prefixes).toBe(1);expect(doc.toJSON()).toEqual(before);
 });
});

describe('independent Photoshop hierarchy reconstruction',()=>{
 for(const fixture of ['normal','multiply-group','pass','pass-opacity','normal-opacity','pass-mask','pass-opacity-mask','normal-mask','hidden','locked','alpha-locked','wide-psb'])it(fixture,async()=>{
  const bytes=readFileSync(root+fixture+(fixture==='wide-psb'?'.psb':'.psd')),parsed=await parsePsdAsync(bytes),report=getPsdCapabilityReport(parsed);
  expect(report.canImportAsLayers,JSON.stringify(report.warnings)).toBe(true);
  const result=await psdToDocumentAsync(bytes),doc=Document.fromJSON(result.document);
  expect(doc.layers.length).toBe(3);const group=doc.layers.at(1) as LayerGroup;expect(group).toBeInstanceOf(LayerGroup);expect(group.name).toBe('Outer Ω');expect(group.layers.length).toBe(2);
  const inner=group.layers.at(1) as LayerGroup;expect(inner.name).toBe('Inner isolated');expect(inner.layers.length).toBe(2);expect(inner.layers.at(0)!.name).toBe('Blue');expect(inner.layers.at(1)!.name).toBe('Screen white');
  expect(group.x).toBe(4);expect(group.layers.at(0)!.x).toBe(2);expect(group.visible).toBe(fixture!=='hidden');expect(group.locked).toBe(fixture==='locked'||fixture==='alpha-locked');
  if(group.locked){expect(()=>{group.x+=1;}).toThrow(/Unlock this layer and its parent groups first/);expect(()=>{group.layers.at(0)!.opacity=.5;}).toThrow(/Unlock this layer and its parent groups first/);}
  if(fixture==='alpha-locked')expect(report.warnings.join(' ')).toContain('full native lock');
  if(fixture.includes('mask'))expect(group.mask!.kind).toBe('bitmap');
 });
 it('rejects malformed source boundary stacks instead of attaching children to the wrong group',async()=>{
  const parsed=await parsePsdAsync(readFileSync(root+'normal.psd'));
  expect(()=>psdLayerTree(parsed.layers.filter(layer=>!layer.isGroupEnd))).toThrow(/boundaries/);
 });
 it('requires merged fallback for unknown group modes, clipping and unsupported own appearance',async()=>{
  for(const mode of ['blend','clipping','effects','fill'] as const){
   const parsed=await parsePsdAsync(readFileSync(root+'pass.psd')),group=parsed.layers.find(layer=>layer.isGroup&&layer.name==='Outer Ω')!;
   if(mode==='blend')group.groupBlendModeKey='diss';
   if(mode==='clipping')group.clipping=1;
   if(mode==='effects')group.unsupportedAppearance=['Photoshop layer effects'];
   if(mode==='fill')group.unsupportedAppearance=['Photoshop fill opacity'];
   const report=getPsdCapabilityReport(parsed);expect(report.canImportAsLayers).toBe(false);expect(report.warnings.join(' ')).toContain('merged composite');
   expect(report.supportedConstructs.some(value=>value.startsWith("Group 'Outer Ω':"))).toBe(false);
  }
 });
 it('reports native hierarchy budgets and partial lock granularity explicitly',async()=>{
  const parsed=await parsePsdAsync(readFileSync(root+'normal.psd')),pixel=parsed.layers.find(layer=>layer.imageData)!;
  expect(()=>psdLayerTree(Array.from({length:65},()=>pixel))).toThrow(/64-layer budget/);
  const end=parsed.layers.find(layer=>layer.isGroupEnd)!,group=parsed.layers.find(layer=>layer.isGroup)!;
  expect(()=>psdLayerTree([...Array(9).fill(end),pixel,...Array(9).fill(group)])).toThrow(/depth 8/);
  group.protectedFlags=1;const report=getPsdCapabilityReport(parsed);expect(report.canImportAsLayers).toBe(true);expect(report.warnings.join(' ')).toContain('full native lock');
 });
});
