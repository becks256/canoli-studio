import {expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import createRaw from '../src/core/interchange/raw/codec/canoli_raw_decoder.js';
import {rawDecoder} from '../src/core/interchange/raw/codec';
import {rawImportReportSchema} from '../src/core/interchange/raw/types';

const input=async(name:string)=>new Uint8Array(await readFile('tests/fixtures/raw-shooting/'+name+'.dng'));
async function native(){return createRaw({wasmBinary:new Uint8Array(await readFile('src/core/interchange/raw/codec/canoli_raw_decoder.wasm'))});}
const recorded={version:1,lensMake:'Canoli Optics',lensModel:'Canoli Reference 24-70mm F2.8',focalLength:35,focalLength35mm:53,aperture:Math.fround(5.6),exposureTime:Math.fround(.008),iso:400};

for(const name of ['recorded','missing-maker','invalid-numbers','nonfinite-numbers'])it(`native recorded shooting ${name} preserves every independent sensor sample`,async()=>{
 const decoder=rawDecoder(await native()),bytes=await input(name),before=bytes.slice(),report=decoder.inspect(bytes);
 const expected=name==='invalid-numbers'?{...recorded,focalLength:null,focalLength35mm:null,aperture:null,exposureTime:null,iso:null}:name==='nonfinite-numbers'?{...recorded,focalLength:null,aperture:null,exposureTime:null}:name==='missing-maker'?{...recorded,lensMake:''}:recorded;
 expect(report.shooting).toEqual(expected);expect(Object.isFrozen(report.shooting)).toBe(true);expect(Object.isFrozen(rawImportReportSchema.parse(report).shooting)).toBe(true);
 const image=decoder.develop(bytes);
 try{expect(image.report.shooting).toEqual(expected);expect(Buffer.from(image.readRows(0,image.height).buffer)).toEqual(await readFile('tests/fixtures/raw/bayer-rggb.rgb16le'));}finally{image.dispose();}
 expect(bytes).toEqual(before);
});

it('keeps missing declarations unknown and older saved reports free of injected shooting metadata',async()=>{
 const report=rawDecoder(await native()).inspect(new Uint8Array(await readFile('tests/fixtures/raw/bayer-rggb.dng')));
 expect(report.shooting).toEqual({version:1,lensMake:'',lensModel:'',focalLength:null,focalLength35mm:null,aperture:null,exposureTime:null,iso:null});
 const {shooting:_,...legacy}=report;expect(rawImportReportSchema.parse(legacy)).toEqual(legacy);expect(rawImportReportSchema.parse(legacy)).not.toHaveProperty('shooting');
});

it('rejects non-finite private native metadata and remains reusable after discarding the reply',async()=>{
 const module=await native(),decoder=rawDecoder(module),info=module._canoli_raw_info,bytes=await input('recorded');
 module._canoli_raw_info=()=>{const pointer=info();new Uint32Array(module.HEAPU8.buffer,pointer,32)[26]=0x7fc00000;return pointer;};
 try{expect(()=>decoder.inspect(bytes)).toThrow(/shooting metadata/);}finally{module._canoli_raw_info=info;}
 expect(decoder.inspect(bytes).shooting).toEqual(recorded);
});
