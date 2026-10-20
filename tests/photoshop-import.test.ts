import {describe,it,expect} from 'vitest';
import {photoshopInputBlob,photoshopInspectionSchema,photoshopOptionsSchema} from '../src/core/photoshop-import';
import {decodePackBits} from '../src/core/interchange/psd/packbits';
import {ByteReader} from '../src/core/interchange/psd/stream';

describe('trusted Photoshop input and metadata boundary',()=>{
 it('snapshots only the supplied legacy byte view and never detaches or rewrites it',async()=>{
  const bytes=new Uint8Array([99,1,2,3,88]),view=bytes.subarray(1,4),snapshot=photoshopInputBlob(view);view.fill(7);
  expect([...new Uint8Array(await snapshot.arrayBuffer())]).toEqual([1,2,3]);expect(bytes.byteLength).toBe(5);expect([...bytes]).toEqual([99,7,7,7,88]);
  const blob=new Blob(['native']);expect(photoshopInputBlob(blob)).toBe(blob);
 });
 it('retains strict compatibility options and rejects unknown external fields',()=>{
  expect(photoshopOptionsSchema.parse({mode:'flatten',legacyStraightAlpha:false,convertCmyk:true,preserveMasks:false})).toEqual({mode:'flatten',legacyStraightAlpha:false,convertCmyk:true,preserveMasks:false});
  for(const value of [{mode:'other'},{preserveMasks:'yes'},{upload:true}])expect(()=>photoshopOptionsSchema.parse(value)).toThrow();
 });
 it('validates metadata without accepting retained decoded planes or inconsistent counts',()=>{
  const metadata={version:1,header:{signature:'8BPS',version:2,channels:4,width:100000,height:3,depth:8,colorMode:3},layers:[],report:{supportedConstructs:[],warnings:[],degradedFeatures:[],layerCount:0,colorMode:'RGB',bitDepth:8,hasComposite:true,hasIccProfile:false,canImportAsLayers:false}};
  expect(photoshopInspectionSchema.parse(metadata).header.width).toBe(100000);
  for(const value of [{...metadata,composite:new Uint8Array(4)},{...metadata,report:{...metadata.report,layerCount:1}},{...metadata,header:{...metadata.header,version:1}}])expect(()=>photoshopInspectionSchema.parse(value)).toThrow();
 });
 it('rejects corrupt 8-bit PackBits extents rather than returning invented pixels',()=>{
  for(const [bytes,width] of [[[0],1],[[255],2],[[254,7],2],[[0,7,0,8],1]] as [number[],number][])
   expect(()=>decodePackBits(new Uint8Array(bytes),width,true)).toThrow(/Photoshop/);
  expect([...decodePackBits(new Uint8Array([0,7,128,128]),1,true)]).toEqual([7]);
  const reader=new ByteReader(new Uint8Array(8));expect(()=>reader.readBytes(-1)).toThrow();expect(()=>reader.seek(.5)).toThrow();
 });
});
