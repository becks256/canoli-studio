import {describe,it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {ByteReader,ByteWriter} from '../src/core/interchange/psd/stream';
import {photoshopLength} from '../src/core/interchange/psd/length';
import {validatePsdDimensions,planPsdExport} from '../src/core/interchange/psd/export-plan';
import {parsePsd} from '../src/core/interchange/psd/parser';
import {Document,RasterLayer} from '../src/dom';
import {getExportCapabilityReport} from '../src/engine/export';

if(typeof ImageData==='undefined')globalThis.ImageData=class {
 readonly data:Uint8ClampedArray;readonly colorSpace='srgb';
 constructor(readonly width:number,readonly height:number){this.data=new Uint8ClampedArray(width*height*4);}
} as unknown as typeof ImageData;

describe('Photoshop large document boundaries and external RLE fixtures',()=>{
 it('keeps PSD and PSB geometry boundaries separate from document/import geometry',()=>{
  expect(()=>validatePsdDimensions(30001,1)).toThrow(/Choose PSB/);expect(()=>validatePsdDimensions(300000,300000,'psb')).not.toThrow();
  for(const n of [0,1.5,300001,NaN])expect(()=>validatePsdDimensions(n,1,'psb')).toThrow(/PSB supports/);
  const d=new Document({width:100000,height:1});d.layers.add(new RasterLayer({assetId:'source',width:100000,height:1,x:-10}));
  expect(planPsdExport(d.toJSON(),'layers','psb').layers[0].left).toBe(-10);
  expect(planPsdExport(d.toJSON(),'layers','psd').layers[0].left).toBe(0);
  expect(getExportCapabilityReport(d.toJSON(),{format:'psb'}).warnings.join(' ')).toContain('8-bit RGB pixel-layer, folder and pixel-mask subset');
 });
 it('writes and reads exact 64-bit PSB lengths beyond PSD and real-file test sizes',()=>{
  for(const n of [0,0xffffffff,2**32+29,Number.MAX_SAFE_INTEGER]){const bytes=photoshopLength(n,'psb');expect(bytes).toHaveLength(8);expect(new ByteReader(bytes).readUint64()).toBe(n);}
  expect(photoshopLength(0xffffffff,'psd')).toHaveLength(4);expect(()=>photoshopLength(2**32,'psd')).toThrow(/Choose PSB/);
  for(const n of [-1,1.5,2**53,Infinity])expect(()=>photoshopLength(n,'psb')).toThrow(/exact browser/);
  const writer=new ByteWriter();expect(()=>writer.writeUint64(2**53)).toThrow(/exact browser/);
  expect(()=>new ByteReader(new Uint8Array([255,255,255,255,255,255,255,255])).readUint64()).toThrow(/exact browser/);
 });
 it('rejects malformed PSB header extents before pixel allocation',async()=>{
  const original=new Uint8Array(await readFile('tests/fixtures/psb/rle-30001.psb'));
  for(const field of ['width','height','channels','depth']){
   const bytes=original.slice(),view=new DataView(bytes.buffer);
   if(field==='width')view.setUint32(18,300001);else if(field==='height')view.setUint32(14,0);else if(field==='channels')view.setUint16(12,57);else view.setUint16(22,12);
   expect(()=>parsePsd(bytes)).toThrow(/Invalid Photoshop file header/);
  }
 });
 for(const width of [30001,100000])it(`decodes every independently written ${width}-pixel PSB RLE layer and composite sample`,async()=>{
  const bytes=new Uint8Array(await readFile(`tests/fixtures/psb/rle-${width}.psb`)),parsed=parsePsd(bytes);
  expect(parsed.header.version).toBe(2);expect(parsed.layers).toHaveLength(1);
  for(const image of [parsed.layers[0].imageData!,parsed.composite!]){
   expect(image.width).toBe(width);expect(image.height).toBe(3);
   for(let y=0;y<3;y++)for(let x=0;x<width;x++){
    const i=(y*width+x)*4;
    if(image.data[i]!==x*37%256||image.data[i+1]!==(x*19+y*11+7)%256||image.data[i+2]!==(x*11+y*23+3)%256||image.data[i+3]!==255)throw new Error(`Incorrect external PSB sample at ${x},${y}`);
   }
  }
 });
});
