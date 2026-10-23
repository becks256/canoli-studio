import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {inspectServerRaw,developServerRaw} from '../server/raw';
import {openPngRows} from '../server/png-rows';
import {AssetStore,captureAssetSource} from '../src/core/assets';
import {prepareRawDerivation} from '../src/core/interchange/raw/derive';

const file=async(name='bayer-rggb.dng')=>new Blob([new Uint8Array(await readFile('tests/fixtures/raw/'+name))],{type:'image/x-adobe-dng'});
async function rgba(blob:Blob){const image=openPngRows(new Uint8Array(await blob.arrayBuffer())),parts:Uint8ClampedArray[]=[];for await(const strip of image.strips)parts.push(strip.pixels);return Buffer.concat(parts.map(p=>Buffer.from(p)));}

it('develops actual RAW sensor bytes in the Node worker against independent reference pixels',async()=>{
  const original=await file(),before=await original.arrayBuffer(),report=await inspectServerRaw(original),result=await developServerRaw(original,{allowPrecisionLoss:true,development:{exposure:1.25,highlightPreservation:0.5}}),expected=new Blob([new Uint8Array(await readFile('tests/fixtures/raw/exposure-up.png'))],{type:'image/png'});
  expect(report).toMatchObject({canDevelop:true,displayWidth:64,displayHeight:48});expect(await rgba(result.png)).toEqual(await rgba(expected));expect(await original.arrayBuffer()).toEqual(before);
},20000);

for(const action of ['abort','callback']as const)it(`terminates an actual native RAW ${action} job and admits a clean retry`,async()=>{
  const original=await file(),abort=new AbortController();let entered=false;
  const pending=developServerRaw(original,{allowPrecisionLoss:true},{signal:abort.signal,onProgress:value=>{if(entered||value.phase!=='developing')return;entered=true;if(action==='abort')abort.abort(new Error('Cancel native RAW'));else throw new Error('RAW progress failed');}});
  await expect(pending).rejects.toThrow(action==='abort'?'Cancel native RAW':'RAW progress failed');expect(entered).toBe(true);
  expect((await developServerRaw(original,{allowPrecisionLoss:true})).report.canDevelop).toBe(true);
},20000);

it('rejects missing consent, corrupt sensor data and unavailable camera WB without accepted pixels',async()=>{
  await expect(developServerRaw(await file())).rejects.toThrow(/consent/);
  await expect(developServerRaw(new Blob(['Not RAW']),{allowPrecisionLoss:true})).rejects.toThrow();
  await expect(developServerRaw(await file('no-camera-wb.dng'),{allowPrecisionLoss:true})).rejects.toThrow(/white balance/i);
  expect((await developServerRaw(await file('no-camera-wb.dng'),{allowPrecisionLoss:true,development:{whiteBalance:'auto'}})).report.canDevelop).toBe(true);
},20000);

it('retains verified encoded pixels without pretending to own a browser bitmap',async()=>{
  const original=await file(),result=await prepareRawDerivation(original,'Original.dng',{allowPrecisionLoss:true},{},()=>{},developServerRaw),store=new AssetStore();
  const asset=store.installEncoded({id:'encoded',name:'Accepted RAW',width:64,height:48,blob:result.png,raw:result.source}),pin=captureAssetSource(store,asset.id);
  expect(()=>asset.bitmap).toThrow(/no browser bitmap/);expect(asset.raw!.originalBlob).toBe(original);pin.check();store.remove(asset.id);expect(()=>pin.check()).toThrow(/changed/);store.dispose();
},20000);
