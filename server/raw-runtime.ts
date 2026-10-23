import {readFile} from 'node:fs/promises';
import factory from '../src/core/interchange/raw/codec/canoli_raw_decoder.js';
import {rawDecoder} from '../src/core/interchange/raw/codec';
import {rawDecodeOptionsSchema,type RawImportControl} from '../src/core/interchange/raw/types';
import {encodeRawWorkingImage} from '../src/core/interchange/raw/working-output';
import {openPngRows} from './png-rows';

/** Actual native sensor work in a disposable Node worker, with no browser surface. */
export async function rawNativeJob(mode:unknown,blob:unknown,options:unknown,progress:NonNullable<RawImportControl['onProgress']>){
  if(!(blob instanceof Blob)&&!(blob instanceof Uint8Array)||!['inspect','develop'].includes(String(mode)))throw new Error('Invalid RAW worker request.');
  const settings=rawDecodeOptionsSchema.parse(options);
  if(mode==='develop'&&!settings.allowPrecisionLoss)throw new Error('RAW working output requires explicit 8-bit precision-loss consent.');
  progress({phase:'inspecting',fraction:null});
  const native=await factory({wasmBinary:new Uint8Array(await readFile(new URL('../src/core/interchange/raw/codec/canoli_raw_decoder.wasm',import.meta.url)))}),decoder=rawDecoder(native);
  let last=0,lastPhase='';native.canoliRawProgress=stage=>{const phase=stage<=4?'inspecting':'developing',now=performance.now();if(lastPhase!==phase||now-last>=50){last=now;lastPhase=phase;progress({phase,fraction:null});}};
  const bytes=blob instanceof Blob?new Uint8Array(await blob.arrayBuffer()):blob;
  if(mode==='inspect')return{report:decoder.inspect(bytes,settings.development.image)};
  const image=decoder.develop(bytes,settings.development),report=image.report,png=await encodeRawWorkingImage(image,fraction=>progress({phase:'encoding',fraction}));
  // Validate complete native PNG output off the request thread, not only its header.
  const rows=openPngRows(new Uint8Array(await png.arrayBuffer()));
  if(rows.width!==report.displayWidth||rows.height!==report.displayHeight)throw new Error('Invalid native RAW PNG geometry.');
  for await(const strip of rows.strips){if(strip.pixels.some((value,index)=>index%4===3&&value!==255))throw new Error('RAW output unexpectedly contains transparency.');}
  return{report,png};
}
