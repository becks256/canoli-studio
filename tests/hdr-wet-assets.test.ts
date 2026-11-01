import {expect,it} from 'vitest';
import {createHash} from 'node:crypto';
import {AssetStore} from '../src/core/assets';
import {captureHdrWetAssets} from '../src/core/hdr-wet-assets';
import {encodeFloatWetTile,validateFloatWetTilePair} from '../src/core/float-wet-tile';
import {captureHdrWetAssetField} from '../src/engine/hdr-wet-field';
import {wetServerAssets} from '../server/wet-assets';
import {wetBrowserAssets} from '../src/engine/wet-composite';
import type {WetAssetProvider,WetImageSource} from '../src/core/wet-assets';
import type {WetPaintTileData} from '../src/core/wet-operation';
import {STANDARD_PROFILES} from '../src/core/color/icc';
import {FLOAT_SOURCE_NATIVE_SHA} from '../src/core/float-source/types';

const tile=():WetPaintTileData=>({x:-3,y:7,width:2,height:1,assetId:'color',coverage:{assetId:'coverage'}});
const region={x:-3,y:7,width:2,height:1};
async function fixture(){
  const color=await encodeFloatWetTile(new Float32Array([2,-8,4,.5,-0,8,-4,.25]),2,1),coverage=await encodeFloatWetTile(new Float32Array([0,0,0,.75,99,-99,1,.5]),2,1);
  const sources=new Map<string,WetImageSource>([['color',{blob:color,width:2,height:1,identity:{},pixels:{}}],['coverage',{blob:coverage,width:2,height:1,identity:{},pixels:{}}]]);
  const calls:{id:string;precision:string|undefined}[]=[];
  const provider:WetAssetProvider={get(id,precision){calls.push({id,precision});const source=sources.get(id);if(!source)throw new Error('Missing original: '+id);return source;},async *alpha(){throw new Error('HDR validation must never use byte alpha or a display thumbnail.');}};
  return {color,coverage,sources,provider,calls};
}

it('captures all ordered metadata and complete original identities before any asynchronous validation',async()=>{
  const f=await fixture(),input=[tile()],pending=captureHdrWetAssets(input,f.provider);input[0].x=999;input[0].coverage.assetId='foreign';input.length=0;
  const owner=await pending;expect(owner.tiles).toHaveLength(1);expect(owner.tiles[0]).toEqual({region,pixels:f.color,coverage:f.coverage});expect(Object.isFrozen(owner.tiles)).toBe(true);expect(Object.isFrozen(owner.tiles[0].region)).toBe(true);
  expect(f.calls.every(call=>call.precision==='float32')).toBe(true);owner.dispose();expect(()=>owner.tiles).toThrow('disposed');expect(()=>owner.check()).toThrow('disposed');owner.dispose();
});

it('shared provider fields preserve signed/HDR pigment, independent removal, overlaps and caller-owned reads',async()=>{
  const f=await fixture(),field=await captureHdrWetAssetField([tile(),tile()],f.provider),result=await field.readWindow(region);
  expect([...result]).toEqual([1.25,-5,2.5,.625,.9375,-0,3,-1.5,.375,.75]);expect(Object.is(result[5],-0)).toBe(true);
  result.fill(999);const fresh=await field.readWindow(region);expect(fresh[0]).toBe(1.25);field.dispose();expect(fresh[0]).toBe(1.25);await expect(field.readWindow(region)).rejects.toThrow('disposed');
});

it('full offscreen pairs reject alpha violations and mismatched geometry before a field is exposed',async()=>{
  const f=await fixture();f.sources.get('coverage')!.blob=await encodeFloatWetTile(new Float32Array([0,0,0,1,0,0,0,.125]),2,1);
  await expect(captureHdrWetAssetField([{...tile(),x:1000000}],f.provider)).rejects.toThrow('already be masked');
  f.sources.get('coverage')!.blob=f.coverage;f.sources.get('coverage')!.width=1;await expect(captureHdrWetAssets([tile()],f.provider)).rejects.toThrow('dimensions');
});

for(const property of ['blob','width','height','identity','pixels'] as const)it('rejects a changed '+property+' during asynchronous preparation and allows a fresh valid owner',async()=>{
  const f=await fixture(),source=f.sources.get('color')!,saved={...source},pending=captureHdrWetAssets([tile()],f.provider);
  if(property==='blob')source.blob=f.color.slice(0,f.color.size,'image/tiff');
  else if(property==='width'||property==='height')source[property]++;
  else source[property]={};
  await expect(pending).rejects.toThrow('changed');Object.assign(source,saved);const owner=await captureHdrWetAssets([tile()],f.provider);owner.check();owner.dispose();
});

it('completed pair proofs still enforce current provider lifetime and source identity for empty windows',async()=>{
  const f=await fixture();const first=await captureHdrWetAssets([tile()],f.provider);first.dispose();
  const field=await captureHdrWetAssetField([tile()],f.provider);f.sources.set('color',{...f.sources.get('color')!,identity:{}});
  await expect(field.readWindow({x:9000,y:9000,width:1,height:1})).rejects.toThrow('changed');field.dispose();
  const valid=await captureHdrWetAssets([tile()],f.provider);f.provider.check=()=>{throw new Error('Target store closed');};expect(()=>valid.check()).toThrow('Target store closed');valid.dispose();
});

it('reentrant external retirement rejects before publication and leaves previously returned words owned',async()=>{
  const f=await fixture();let owner:Awaited<ReturnType<typeof captureHdrWetAssetField>>|undefined,retire=false;
  owner=await captureHdrWetAssetField([tile()],f.provider,{check(){if(retire)owner!.dispose();}});
  const retained=await owner.readWindow(region);retire=true;await expect(owner.readWindow(region)).rejects.toThrow('disposed');expect(retained[0]).toBe(1);owner.dispose();
});

it('captures cancellation controls and rejects already-proven pairs after cancellation without poisoning recovery',async()=>{
  const f=await fixture(),abort=new AbortController(),control={signal:abort.signal,check:()=>{}};
  const pending=captureHdrWetAssets([tile()],f.provider,control);control.signal=new AbortController().signal;abort.abort(new Error('Stop HDR assets'));
  await expect(pending).rejects.toThrow('Stop HDR assets');const owner=await captureHdrWetAssets([tile()],f.provider);owner.dispose();
  await expect(validateFloatWetTilePair(f.color,f.coverage,2,1,{signal:abort.signal})).rejects.toThrow('Stop HDR assets');
  await expect(validateFloatWetTilePair(f.color,f.coverage,1,2)).rejects.toThrow('native');await validateFloatWetTilePair(f.color,f.coverage,2,1);
});

it('validates every tile including hidden later pairs and rejects missing original sources',async()=>{
  const f=await fixture();await expect(captureHdrWetAssets([tile(),{...tile(),assetId:'missing'}],f.provider)).rejects.toThrow('Missing original');
  const malformed=new Blob([await f.color.arrayBuffer()].map(bytes=>bytes.slice(0,bytes.byteLength-7)),{type:'image/tiff'});f.sources.set('bad',{blob:malformed,width:2,height:1});
  await expect(captureHdrWetAssets([tile(),{...tile(),assetId:'bad'}],f.provider)).rejects.toThrow();
});

it('rejects invalid geometry/metadata and empty preparation without adding an image-size tier',async()=>{
  const f=await fixture();for(const input of [[],[{...tile(),x:.5}],[{...tile(),width:0}],[{...tile(),x:Number.MAX_SAFE_INTEGER}],[{...tile(),coverage:null}],[{...tile(),unexpected:true}]])await expect(captureHdrWetAssets(input as never,f.provider)).rejects.toThrow();
  const distant=await captureHdrWetAssets([{...tile(),x:2**38,y:-(2**38)}],f.provider);expect(distant.tiles[0].region.x).toBe(2**38);distant.dispose();
});

it('headless asset records validate and replay original TIFFs without fabricated ImageBitmap or PNG decoding',async()=>{
  const f=await fixture(),store=new AssetStore(),profile=createHash('sha256').update(STANDARD_PROFILES['linear-srgb'].iccBytes!).digest('hex');
  for(const [id,blob]of [['color',f.color],['coverage',f.coverage]] as const)store.installEncodedTiff({id,name:id+'.tif',blob,width:2,height:1,thumbnail:'data:image/png;base64,AA==',tiff:{page:0,allowPrecisionLoss:false,editingPrecision:'float32'},tiffColor:{version:1,engine:'Little CMS 2.19.1',wasmSha256:FLOAT_SOURCE_NATIVE_SHA,source:{kind:'icc',sha256:profile},outputSpace:'srgb8',usesIntentFallback:false,warnings:[]}});
  const field=await captureHdrWetAssetField([tile()],wetServerAssets(store));expect([...await field.readWindow(region)]).toEqual([1,-4,2,.5,.75,-0,2,-1,.25,.5]);store.dispose();await expect(field.readWindow(region)).rejects.toThrow('disposed');field.dispose();
});

it('browser provider keeps byte-native geometry strict and accepts only correctly sized float thumbnails for original validation',()=>{
  const asset={id:'float',width:131,height:79,bitmap:{width:96,height:58},tiff:{editingPrecision:'float32'}};
  const provider=wetBrowserAssets({get:()=>asset as never,captureLifetime:()=>()=>{}});
  expect(()=>provider.get('float')).toThrow('dimensions');expect(provider.get('float','float32').width).toBe(131);asset.bitmap.width=95;expect(()=>provider.get('float','float32')).toThrow('dimensions');
});
