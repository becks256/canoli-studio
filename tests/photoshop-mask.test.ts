import {describe, expect, it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parsePsdAsync, getPsdCapabilityReport} from '../src/core/interchange/psd/parser';
import {psdToDocumentAsync} from '../src/core/interchange/psd/bridge';
import {referencedAssets, validateDocument} from '../src/core/model';
import {Document} from '../src/dom';

if (typeof ImageData === 'undefined') globalThis.ImageData = class {
 readonly data:Uint8ClampedArray; readonly colorSpace='srgb';
 constructor(readonly width:number, readonly height:number) {this.data=new Uint8ClampedArray(width*height*4);}
} as unknown as typeof ImageData;

const directory='tests/fixtures/psd/masks/';
const fixtures=JSON.parse(readFileSync(directory+'manifest.json','utf8')).cases as {
 file:string; width:number; height:number; layerLeft:number; layerTop:number; maskLeft:number; maskTop:number;
 maskWidth:number; maskHeight:number; background:number; relative:boolean; inverted:boolean; disabled:boolean;
 density:number; feather:number; empty:boolean; coverageSha256:string; sourceRgbaSha256:string; rgbaSha256:string;
}[];
const hash=(bytes:Uint8Array|Uint8ClampedArray)=>createHash('sha256').update(bytes).digest('hex');

describe('Photoshop raster-mask import preserves actual native pixel sources',()=>{
 for(const fixture of fixtures.filter(f=>f.width*f.height<50_000_000)) it(fixture.file,async()=>{
  const input=readFileSync(directory+fixture.file), before=Buffer.from(input), parsed=await parsePsdAsync(input);
  const layer=parsed.layers[0];
  expect(hash(layer.imageData!.data)).toBe(fixture.sourceRgbaSha256);
  expect(layer.mask).toMatchObject({left:fixture.maskLeft,top:fixture.maskTop,defaultColor:fixture.background,relativeToLayer:fixture.relative,inverted:fixture.inverted,disabled:fixture.disabled,density:fixture.density/255,feather:fixture.feather});
  if(!fixture.empty){
   const pixels=layer.maskData!;
   expect([pixels.width,pixels.height]).toEqual([fixture.maskWidth,fixture.maskHeight]);
   const coverage=Uint8Array.from({length:pixels.width*pixels.height},(_,i)=>pixels.data[i*4]);
   expect(hash(coverage)).toBe(fixture.coverageSha256);
  }
  const result=await psdToDocumentAsync(input);
  validateDocument(result.document);
  expect(referencedAssets(result.document)).toEqual(new Set(result.assets.keys()));
  if(fixture.feather){
   expect(result.report.canImportAsLayers).toBe(false);expect(result.assets.size).toBe(1);
   expect(hash([...result.assets.values()][0].data)).toBe(fixture.rgbaSha256);
  }else{
   expect(result.report.canImportAsLayers).toBe(true);
   const native=result.document.children[0];
   expect(native.mask).toMatchObject({kind:fixture.empty?'paint':'bitmap',enabled:!fixture.disabled,inverted:(fixture.background===255)!==fixture.inverted,linked:fixture.relative,x:fixture.maskLeft,y:fixture.maskTop,density:fixture.density/255});
   expect(result.assets.size).toBe(fixture.empty?1:2);
   const doc=Document.fromJSON(result.document), target=doc.layers.at(0)!;
   const initial=doc.toJSON();target.mask=target.mask!.with({density:.25});doc.undo();expect(doc.toJSON()).toEqual(initial);
   if(native.mask!.kind==='bitmap'){
    const source=result.assets.get(native.mask!.assetId)!;
    const alpha=Uint8Array.from({length:source.width*source.height},(_,i)=>fixture.background===255?255-source.data[i*4+3]:source.data[i*4+3]);
    expect(hash(alpha)).toBe(fixture.coverageSha256);
   }
  }
  const omitted=await psdToDocumentAsync(input,{preserveMasks:false});
  expect(omitted.document.children[0].mask).toBeUndefined();expect(omitted.assets.size).toBe(1);
  expect(omitted.report.warnings.join(' ')).toContain('preserveMasks:false');
  expect(input).toEqual(before);
 });

 it('reports missing channels without manufacturing a rectangular mask',async()=>{
  const parsed=await parsePsdAsync(readFileSync(directory+'black-raw.psd'));
  parsed.layers[0].maskData=undefined;
  expect(getPsdCapabilityReport(parsed).canImportAsLayers).toBe(false);
  expect(getPsdCapabilityReport(parsed).warnings.join(' ')).toContain('missing or unsupported raster mask');
  expect(getPsdCapabilityReport(parsed,{preserveMasks:false}).canImportAsLayers).toBe(true);
 });

 it('does not advertise mask preservation for malformed group boundaries',async()=>{
  const parsed=await parsePsdAsync(readFileSync(directory+'black-raw.psd'));
  const raster=parsed.layers[0],group={...raster,isGroup:true,imageData:undefined};
  parsed.layers=[group,{...raster,mask:undefined,maskData:undefined}];
  const report=getPsdCapabilityReport(parsed);
  expect(report.canImportAsLayers).toBe(false);
  expect(report.supportedConstructs.join(' ')).not.toContain('native pixel raster mask');
  expect(report.warnings.join(' ')).toContain('Malformed Photoshop group boundaries');
 });

 it('detects a standalone vector-mask tag without inventing raster coverage',async()=>{
  const input=readFileSync(directory+'vector-only.psd'),parsed=await parsePsdAsync(input);
  expect(parsed.layers[0].hasVectorMask).toBe(true);expect(parsed.layers[0].mask).toBeUndefined();
  expect(getPsdCapabilityReport(parsed).canImportAsLayers).toBe(false);
  expect(getPsdCapabilityReport(parsed).warnings.join(' ')).toContain('Photoshop vector masks');
  const result=await psdToDocumentAsync(input);
  expect(result.assets.size).toBe(1);expect([...result.assets.values()][0].data.every(value=>value===0)).toBe(true);
  expect(getPsdCapabilityReport(parsed,{preserveMasks:false}).canImportAsLayers).toBe(true);
 });

 it('rejects invalid mask bounds/background before interpreting the channel',async()=>{
  const original=readFileSync(directory+'black-raw.psd');
  const marker=Buffer.alloc(18);marker.writeInt32BE(8,0);marker.writeInt32BE(8,4);marker.writeInt32BE(13,8);marker.writeInt32BE(15,12);
  const start=original.indexOf(marker);expect(start).toBeGreaterThan(0);
  for(const field of ['bounds','background']){
   const data=Buffer.from(original);
   if(field==='bounds')data.writeInt32BE(7,start+8);else data[start+16]=77;
   await expect(parsePsdAsync(data)).rejects.toThrow(/mask geometry or background/);
  }
 });
});
