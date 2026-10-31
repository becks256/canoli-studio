import {parentPort} from 'node:worker_threads';
import './typescript-worker.mjs';
const {FloatTileWindowReader}=await import('../src/core/float-source/window-reader.ts');
const {decodeTile}=await import('../src/core/float-source/codec.ts');
const {validateManifest,validateTileMeta,floatSourceDescriptorSchema,FLOAT_TILE_BATCH_SIZE}=await import('../src/core/float-source/types.ts');
const {freeze}=await import('../src/core/immutable.ts');
const {readTiffFileWindow}=await import('./tiff-files.ts');
const reader=new FloatTileWindowReader(),sources=new Map(),cancelled=new Set(),known=new Set();let serial=Promise.resolve();
parentPort.on('message',data=>{
  const id=data?.id;if(data?.kind==='cancel'){if(known.has(id))cancelled.add(id);return;}
  if(!Number.isSafeInteger(id)||id<1||known.has(id)){parentPort.postMessage({id,error:'Invalid native TIFF reader identity.'});return;}
  known.add(id);serial=serial.catch(()=>{}).then(async()=>{
    const check=()=>{if(cancelled.has(id))throw new DOMException('Native TIFF read cancelled.','AbortError');};
    try{
      check();
      if(data.kind==='verify'){
        const descriptor=floatSourceDescriptorSchema.parse(data.descriptor),tiles=data.tiles;
        if(!Array.isArray(tiles)||!tiles.length||tiles.length>FLOAT_TILE_BATCH_SIZE||new Set(tiles.map(tile=>tile?.meta?.index)).size!==tiles.length)throw new Error('Invalid native TIFF verification batch.');
        for(const tile of tiles){check();const meta=validateTileMeta(descriptor,tile?.meta);await decodeTile(tile,meta);check();}
        parentPort.postMessage({id,verified:tiles.map(tile=>tile.meta)});
      }else if(data.kind==='read'){
        if(data.manifest){const manifest=freeze(validateManifest(data.manifest));sources.delete(data.directory);sources.set(data.directory,manifest);while(sources.size>4)sources.delete(sources.keys().next().value);}
        const manifest=sources.get(data.directory);if(!manifest||manifest.buildId!==data.buildId)throw new Error('Native TIFF reader source identity is missing.');
        const pixels=await readTiffFileWindow(data.directory,manifest,data.bounds,reader,check,fraction=>parentPort.postMessage({id,progress:{phase:'reading',fraction}}));check();parentPort.postMessage({id,pixels},[pixels.buffer]);
      }else throw new Error('Unknown native TIFF reader request.');
    }catch(error){parentPort.postMessage({id,error:error instanceof Error?error.message:String(error),corrupt:!(error instanceof DOMException&&error.name==='AbortError')});}
    finally{known.delete(id);cancelled.delete(id);}
  });
});
