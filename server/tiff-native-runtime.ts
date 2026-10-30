import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {describeFloatSource,prepareFloatTiles} from '../src/core/float-source/prepare';
import {floatSourceInputSchema,validateManifest,FLOAT_TILE_BATCH_SIZE,FLOAT_SOURCE_NATIVE_SHA,type FloatEncodedTile,type FloatSourceManifest} from '../src/core/float-source/types';
import {FloatTileWindowReader} from '../src/core/float-source/window-reader';
import {NativeIccEngine} from '../src/core/color/icc-native';
import {iccTarget} from '../src/core/color/profile-source';
import {inspectTiff} from '../src/core/interchange/tiff/inspect';
import {tiffFloatColorSchema} from '../src/core/interchange/tiff/types';
import {projectFloatWindow} from '../src/engine/float-projection';
import {AffineTransform} from '../src/core/affine';
import {encodeRgbaPng} from '../src/engine/png';
import {readTiffFileWindow} from './tiff-files';

/** Runs only inside a real disposable Node worker. The host acknowledges every
 * checked/persisted batch before native decoding continues. */
export async function prepareNativeTiff(value:unknown,buildId:string,directory:string,send:(message:unknown)=>void,checkpoint:()=>Promise<void>){
  const input=floatSourceInputSchema.parse(value),described=await describeFloatSource(input,{onProgress:progress=>send({kind:'progress',progress})});
  send({kind:'descriptor',descriptor:described.descriptor,key:described.key});await checkpoint();
  const wasm=new Uint8Array(await readFile(new URL('../src/core/color/codec/canoli_icc.wasm',import.meta.url)));
  if(createHash('sha256').update(wasm).digest('hex')!==FLOAT_SOURCE_NATIVE_SHA)throw new Error('Native ICC binary differs from its pinned identity.');
  const tiles:FloatSourceManifest['tiles']=[];let batch:FloatEncodedTile[]=[],prepared:FloatSourceManifest['prepared']|undefined;
  const flush=async()=>{if(!batch.length)return;send({kind:'tiles',tiles:batch});await checkpoint();batch=[];};
  for await(const part of prepareFloatTiles(described,{},()=>NativeIccEngine.create(wasm))){
    if(part.kind==='prepared'){prepared=part.prepared;send(part);}
    else{tiles.push(part.tile.meta);batch.push(part.tile);if(batch.length===FLOAT_TILE_BATCH_SIZE)await flush();}
  }
  await flush();if(!prepared)throw new Error('Native TIFF conversion receipt is missing.');
  const manifest=validateManifest({version:1,key:described.key,buildId,descriptor:described.descriptor,prepared,tiles}),reader=new FloatTileWindowReader(),source={width:input.width,height:input.height,readWindow:(bounds:Parameters<typeof readTiffFileWindow>[2])=>readTiffFileWindow(directory,manifest,bounds,reader,()=>{})};
  const factor=Math.min(1,96/input.width,96/input.height),width=Math.max(1,Math.round(input.width*factor)),height=Math.max(1,Math.round(input.height*factor));
  const pixels=await projectFloatWindow(source,AffineTransform.scale(width/input.width,height/input.height),{x:0,y:0,width,height}),display=await NativeIccEngine.create(wasm);
  try{
    const conversion=display.beginRgb(new Uint8Array(await iccTarget('linear-srgb').source.arrayBuffer()),new Uint8Array(await iccTarget('srgb').source.arrayBuffer()),{inputFormat:'rgba-float32',outputFormat:'rgba8'}),rgba=display.applyWindow(pixels);
    if(!(rgba instanceof Uint8ClampedArray))throw new Error('Native TIFF preview changed sample representation.');
    const preview=await encodeRgbaPng(new Uint8Array(rgba),width,height),color=tiffFloatColorSchema.parse({version:1,engine:'Little CMS 2.19.1',wasmSha256:FLOAT_SOURCE_NATIVE_SHA,source:input.expectedSource,outputSpace:'srgb8',usesIntentFallback:prepared.usesIntentFallback||conversion.usesIntentFallback,warnings:[...new Set([...prepared.warnings,...conversion.warnings])]});
    send({kind:'complete',manifest,preview,color,report:described.inspection.report});
  }finally{display.dispose();}
}

export async function inspectNativeTiff(original:unknown){if(!(original instanceof Blob))throw new Error('Choose complete TIFF source bytes.');return(await inspectTiff(original)).report;}
