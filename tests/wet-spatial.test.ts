import { beforeAll, expect, it } from 'vitest';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';
import { createHash } from 'node:crypto';
import { AffineTransform } from '../src/core/affine';
import { BrushStroke, PencilStroke, BrushSymmetry } from '../src/dom';
import type { BrushStrokeData, Rect } from '../src/core/drawing';
import { prepareWetStroke, type WetStrokeOptions, type WetStrokeResult } from '../src/engine/wet-stroke';
import { sampleWetField, wetRegion, wetTileKey, type WetField, type WetFieldTile } from '../src/engine/wet-spatial';
import type { WetTile, WetTileStore } from '../src/engine/wet-store';
import { instantiateKernel, mixFiltered, prepareBrushTexture, renderSelection, type PixelKernel } from '../src/engine/wasm';
import { loadWetPaint, mixWetPaint } from '../src/engine/wet-paint';

let kernel: PixelKernel;
beforeAll(async () => { kernel = await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm'))); });
class MemoryStore implements WetTileStore {
  data = new Map<string, WetTile>(); closed = false; puts = 0;
  async get(key: string) { if (this.closed) throw new Error('closed'); return this.data.get(key)?.slice(); }
  async put(key: string, value: WetTile) { if (this.closed) throw new Error('closed'); this.data.set(key, value.slice()); this.puts++; }
  async remove(key: string) { this.data.delete(key); }
  async dispose() { this.closed = true; this.data.clear(); }
}
const processor = {
  loadWetPaint: async (...args: Parameters<typeof loadWetPaint> extends [PixelKernel, ...infer P] ? P : never) => loadWetPaint(kernel, ...args),
  mixWetPaint: async (...args: Parameters<typeof mixWetPaint> extends [PixelKernel, ...infer P] ? P : never) => mixWetPaint(kernel, ...args),
  mixFiltered: async (...args: Parameters<typeof mixFiltered> extends [PixelKernel, ...infer P] ? P : never) => mixFiltered(kernel, ...args),
  selection: async (tile: Parameters<typeof renderSelection>[1]) => renderSelection(kernel, tile),
  brushTexture: async (...args: Parameters<typeof prepareBrushTexture> extends [PixelKernel, ...infer P] ? P : never) => prepareBrushTexture(kernel, ...args),
};
const brush = (patch: Partial<BrushStrokeData> = {}): BrushStrokeData => ({ ...new PencilStroke({ size: 3, pressureSize: false, points: [{ x: 3.5, y: 4.5, pressure: 1 }, { x: 6.5, y: 4.5, pressure: 1 }] }).toJSON(), ...patch } as BrushStrokeData);
const source = (pixel: (x: number, y: number) => number[]) => async (region: Rect) => {
  const result = new Uint8ClampedArray(region.width * region.height * 4);
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) result.set(pixel(region.x + x, region.y + y), (y * region.width + x) * 4);
  return result;
};
const hardCoverage = async (stroke: BrushStrokeData, frame: AffineTransform, region: Rect) => {
  const inverse = frame.inverse(), mask = new Uint8Array(region.width * region.height);
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    const p = inverse.point({ x: region.x + x + .5, y: region.y + y + .5 });
    if (stroke.kind === 'pencil' ? p.x >= -1 && p.x < 1 && p.y >= -1 && p.y < 1 : p.x * p.x + p.y * p.y < 1) mask[y * region.width + x] = 255;
  }
  return mask;
};
async function pixels(result: WetStrokeResult) {
  const values = new Map<string, number[]>();
  for await (const tile of result.tiles()) for (let y = 0; y < tile.region.height; y++) for (let x = 0; x < tile.region.width; x++) if (tile.changed[y * tile.region.width + x]) values.set(wetTileKey(tile.region.x + x, tile.region.y + y), [...tile.pixels.slice((y * tile.region.width + x) * 4, (y * tile.region.width + x + 1) * 4)]);
  return values;
}
async function run(stroke: BrushStrokeData, read: ReturnType<typeof source>, options: WetStrokeOptions = {}) {
  const store = new MemoryStore();
  const result = await prepareWetStroke(stroke, read, processor, { tileSize: 8, cacheBytes: 0, coverage: hardCoverage, storage: async () => store, ...options });
  return { result, store };
}

it('a spatial smudge carries a striped footprint intact instead of replacing it with an average color', async () => {
  const read = source((x, y) => y >= 3 && y <= 5 && x >= 2 && x <= 4 ? [[255, 0, 0, 255], [0, 255, 0, 255], [0, 0, 255, 255]][x - 2] : [0, 0, 0, 0]);
  const { result, store } = await run(brush(), read, { mix: { pickup: 0 } });
  const changed = await pixels(result);
  expect(changed.get('5,4')).toEqual([255, 0, 0, 255]); expect(changed.get('6,4')).toEqual([0, 255, 0, 255]); expect(changed.get('7,4')).toEqual([0, 0, 255, 255]);
  expect(result.diagnostics.dabs).toBe(4); expect(result.diagnostics.peakCacheBytes).toBe(0);
  expect([...store.data.keys()].every(key => key.startsWith('result/') || key.startsWith('original/'))).toBe(true);
  await result.dispose(); expect(store.closed).toBe(true); expect(store.data.size).toBe(0);
});

it('carried transparency lifts existing paint on a later footprint and an L-shaped path retains every turn', async () => {
  const red = source((x, y) => x >= 3 && x <= 5 && y >= 3 && y <= 5 ? [255, 0, 0, 255] : [0, 0, 0, 0]);
  const first = await run(brush({ points: [{ x: .5, y: 4.5, pressure: 1 }, { x: 3.5, y: 4.5, pressure: 1 }] }), red, { mix: { pickup: 0 } });
  expect((await pixels(first.result)).get('3,4')).toEqual([0, 0, 0, 0]); expect((await pixels(first.result)).get('4,4')).toEqual([0, 0, 0, 0]);
  await first.result.dispose();
  const second = await run(brush({ size: 1, points: [{ x: 1.5, y: 1.5, pressure: 1 }, { x: 4.5, y: 1.5, pressure: 1 }, { x: 4.5, y: 4.5, pressure: 1 }] }), source((x, y) => x === 1 && y === 1 ? [255, 0, 0, 255] : [0, 0, 0, 0]), { mix: { pickup: 0 } });
  const changed = await pixels(second.result);
  for (const key of ['2,1', '3,1', '4,1', '4,2', '4,3', '4,4']) expect(changed.get(key)).toEqual([255, 0, 0, 255]);
  expect(changed.has('3,3')).toBe(false); expect(second.result.diagnostics.dabs).toBe(7); await second.result.dispose();
});

it('tile size, cache pressure, negative coordinates and result cropping do not change full spatial replay', async () => {
  const stroke = new BrushStroke({ size: 6, opacity: .63, pressureSize: true, pressureOpacity: true, flow: .37, spacing: .4, tip: { roundness: .6, angle: 37 }, points: [{ x: -3.5, y: -1.5, pressure: .6 }, { x: 7.5, y: 5.5, pressure: 1 }, { x: 4.5, y: 9.5, pressure: .3 }] }).toJSON() as BrushStrokeData;
  const read = source((x, y) => [(x * 73 + y * 19) & 255, (y * 47) & 255, (x * 31) & 255, ((x + y) * 59) & 255]);
  const a = await run(stroke, read, { tileSize: 8, cacheBytes: 0, mix: { pickup: .43, wetness: .17 }, load: { color: [255, 10, 60, 191], load: .23 } });
  const b = await run(stroke, read, { tileSize: 16, cacheBytes: 512 * 1024, mix: { pickup: .43, wetness: .17 }, load: { color: [255, 10, 60, 191], load: .23 } });
  try {
    expect(await pixels(a.result)).toEqual(await pixels(b.result));
    const all = await pixels(a.result), crop = { x: 3, y: 2, width: 5, height: 7 }, cropped = new Map<string, number[]>();
    for await (const tile of a.result.tiles(crop)) for (let y = 0; y < tile.region.height; y++) for (let x = 0; x < tile.region.width; x++) if (tile.changed[y * tile.region.width + x]) cropped.set(wetTileKey(tile.region.x + x, tile.region.y + y), [...tile.pixels.slice((y * tile.region.width + x) * 4, (y * tile.region.width + x + 1) * 4)]);
    expect(cropped).toEqual(new Map([...all].filter(([key]) => { const [x, y] = key.split(',').map(Number); return x >= 3 && x < 8 && y >= 2 && y < 9; })));
    expect(a.result.diagnostics.peakCacheBytes).toBe(0); expect(b.result.diagnostics.peakCacheBytes).toBeLessThanOrEqual(512 * 1024);
  } finally { await a.result.dispose(); await b.result.dispose(); }
});

it('stroke selection and opacity apply once after pickup and deposit have accumulated', async () => {
  const input = brush({ size: 1, opacity: .5, flow: .5, points: [{ x: 2.5, y: 2.5, pressure: 1 }, { x: 2.5, y: 2.5, pressure: 1 }], clip: { regions: [{ shape: 'rectangle', operation: 'add', x: 2, y: 2, width: 1, height: 1 }] } });
  const { result } = await run(input, source(() => [0, 0, 0, 0]), { load: { load: 1, color: [255, 0, 0, 255] }, mix: { pickup: 0 } });
  expect((await pixels(result)).get('2,2')).toEqual([255, 0, 0, 96]); expect((await pixels(result)).size).toBe(1); await result.dispose();
});

it('final opacity preserves untouched hidden RGB instead of changing a backing-tile rectangle', async () => {
  const { result } = await run(brush({ size: 1, opacity: .5, points: [{ x: 2.5, y: 2.5, pressure: 1 }] }), source(() => [0, 0, 255, 0]), { load: { load: 1, color: [255, 0, 0, 255] }, mix: { pickup: 0 } });
  try { const all = await pixels(result); expect([...all]).toEqual([['2,2', [255, 0, 0, 128]]]); const tile = (await result.tiles().next()).value!; expect([...tile.pixels.slice(0, 4)]).toEqual([0, 0, 255, 0]); }
  finally { await result.dispose(); }
});

it('independent symmetry reservoirs sample their own starting colors in original-first dab order', async () => {
  const input = brush({ size: 1, points: [{ x: 1.5, y: 1.5, pressure: 1 }, { x: 3.5, y: 1.5, pressure: 1 }], symmetry: { copies: [AffineTransform.translation(0, 8).toJSON()] } });
  const { result } = await run(input, source((x, y) => x === 1 && y === 1 ? [255, 0, 0, 255] : x === 1 && y === 9 ? [0, 0, 255, 255] : [0, 0, 0, 0]), { mix: { pickup: 0 } });
  const changed = await pixels(result); expect(changed.get('3,1')).toEqual([255, 0, 0, 255]); expect(changed.get('3,9')).toEqual([0, 0, 255, 255]); expect(result.diagnostics.dabs).toBe(6); await result.dispose();
});

it('overlapping symmetry initializes from the preceding copy result while retaining separate carried patterns', async () => {
  const input = brush({ size: 1, points: [{ x: 1.5, y: 1.5, pressure: 1 }, { x: 2.5, y: 1.5, pressure: 1 }], symmetry: { copies: [new AffineTransform(-1, 0, 0, 1, 3, 0).toJSON()] } });
  const { result } = await run(input, source((x, y) => y === 1 && x === 1 ? [0, 0, 255, 255] : y === 1 && x === 2 ? [0, 255, 0, 255] : [0, 0, 0, 255]), { load: { color: [255, 0, 0, 255], load: .5 }, mix: { pickup: .5 } });
  // The finite Float32 reservoir rounds the 191.5 red half-tie downward here.
  try { const changed = await pixels(result); expect(changed.get('1,1')).toEqual([191, 0, 64, 255]); expect(changed.get('2,1')).toEqual([64, 0, 191, 255]); expect(changed.get('0,1')).toEqual([160, 0, 96, 255]); }
  finally { await result.dispose(); }
});

it('cancellation, source/coverage/processor/storage errors publish no result and remove private working state', async () => {
  for (const fail of ['abort', 'source', 'coverage', 'processor', 'store', 'progress']) {
    const store = new MemoryStore(), abort = new AbortController(), basePut = store.put.bind(store);
    if (fail === 'store') store.put = async (key, value) => { if (store.puts >= 2) throw new Error('store failed'); await basePut(key, value); };
    const options: WetStrokeOptions = { tileSize: 8, storage: async () => store, signal: abort.signal, coverage: async (...args) => { if (fail === 'coverage') return new Uint8Array(1); return hardCoverage(args[0], args[1], args[2]); }, onProgress: () => { if (fail === 'abort') abort.abort(new Error('abort')); if (fail === 'progress') throw new Error('progress'); } };
    const read = fail === 'source' ? async () => new Uint8ClampedArray(4) : source(() => [255, 0, 0, 255]);
    const p = fail === 'processor' ? { ...processor, mixWetPaint: async () => ({ pixels: new Uint8ClampedArray(4), carried: new Float32Array(4) }) } : processor;
    await expect(prepareWetStroke(brush(), read, p, options)).rejects.toThrow(); expect(store.closed).toBe(true); expect(store.data.size).toBe(0);
  }
});

it('mutable input capture, zero-effect cleanup and output ownership survive source/result closure', async () => {
  const store = new MemoryStore(), input = brush(), loaded = { color: [255, 0, 0, 255] as [number, number, number, number], load: 1 };
  let release!: () => void; const ready = new Promise<void>(resolve => { release = resolve; });
  const pending = prepareWetStroke(input, source(() => [0, 0, 0, 0]), processor, { tileSize: 8, storage: async () => { await ready; return store; }, coverage: hardCoverage, load: loaded, mix: { pickup: 0 } });
  input.points[0].x = 500; loaded.color.fill(0); loaded.load = 0; release();
  const result = await pending, values = await pixels(result); expect(values.get('6,4')).toEqual([255, 0, 0, 255]);
  const first = (await result.tiles().next()).value!; const retained = first.pixels.slice(); first.pixels.fill(17); const again = (await result.tiles().next()).value!; expect(again.pixels).toEqual(retained);
  await result.dispose(); expect(first.before.byteLength).toBeGreaterThan(0); await expect(result.tiles().next()).rejects.toThrow(/disposed/);
  const noop = await run(brush({ flow: 0 }), source(() => [1, 2, 3, 255])); expect(await pixels(noop.result)).toEqual(new Map()); expect(noop.store.data.size).toBe(0); await noop.result.dispose();
});

it('spatial sampling matches independent inverse-basis/bilinear equations through rotation, reflection and shear', async () => {
  const bounds = { x: -16, y: -16, width: 32, height: 32 }, tileSize = 8, tiles = new Map<string, string>(), data = new Map<string, Float32Array>();
  const value = (x: number, y: number) => { if (x < -16 || x >= 16 || y < -16 || y >= 16) return [0, 0, 0, 0]; const a = Math.fround(((x * 17 + y * 31) & 255) / 255); return [Math.fround((x + 16) / 32 * a), Math.fround((y + 16) / 32 * a), 0, a]; };
  for (let y = -16; y < 16; y += 8) for (let x = -16; x < 16; x += 8) { const key = wetTileKey(x, y), tile = new Float32Array(8 * 8 * 4); tiles.set(key, key); for (let py = 0; py < 8; py++) for (let px = 0; px < 8; px++) tile.set(value(x + px, y + py), (py * 8 + px) * 4); data.set(key, tile); }
  const previous = new AffineTransform(-1.7, .3, .6, 1.4, 2.25, -1.75), frame = new AffineTransform(.7, -.4, .2, 1.3, -.5, .25), field: WetField = { bounds, transform: previous, tiles }, region = { x: -3, y: -2, width: 7, height: 6 };
  const actual = await sampleWetField(field, frame, region, tileSize, async key => data.get(key)!, () => {});
  const determinant = frame.a * frame.d - frame.b * frame.c;
  for (let y = 0; y < region.height; y++) for (let x = 0; x < region.width; x++) {
    const nx = region.x + x + .5 - frame.e, ny = region.y + y + .5 - frame.f, u = (frame.d * nx - frame.c * ny) / determinant, v = (-frame.b * nx + frame.a * ny) / determinant;
    const sx = previous.a * u + previous.c * v + previous.e - .5, sy = previous.b * u + previous.d * v + previous.f - .5, bx = Math.floor(sx), by = Math.floor(sy), fx = sx - bx, fy = sy - by;
    for (let c = 0; c < 4; c++) { const expected = value(bx, by)[c] * (1 - fx) * (1 - fy) + value(bx + 1, by)[c] * fx * (1 - fy) + value(bx, by + 1)[c] * (1 - fx) * fy + value(bx + 1, by + 1)[c] * fx * fy; expect(actual[(y * region.width + x) * 4 + c]).toBeCloseTo(expected, 6); }
  }
});

it('unsafe native geometry, unsupported kinds and malformed working policies fail before source reads', async () => {
  const read = source(() => [0, 0, 0, 0]);
  for (const options of [{ tileSize: 0 }, { tileSize: 257 }, { cacheBytes: -1 }, { mix: null }, { load: null }]) await expect(run(brush(), read, options as never)).rejects.toThrow();
  for (const geometry of [{ x: Number.MAX_SAFE_INTEGER, y: 0, width: 1, height: 1 }, { x: 0, y: 0, width: 0, height: 1 }, { x: .5, y: 0, width: 1, height: 1 }]) expect(() => wetRegion(geometry)).toThrow(/precision/);
  await expect(run(brush({ kind: 'eraser' }), read)).rejects.toThrow(/footprint/);
  const singular = new AffineTransform(0, 0, 0, 0, 0, 0), region = { x: 0, y: 0, width: 1, height: 1 };
  await expect(sampleWetField({ bounds: region, transform: singular, tiles: new Map() }, singular, region, 8, async () => new Float32Array(256), () => {})).rejects.toThrow(/singular/);
});

for(const offset of[0,2**38])it(`compact carried fields preserve every dense bilinear word across partial cells at origin ${offset}`,async()=>{
 const bounds={x:offset-3,y:offset-5,width:13,height:17},tileSize=8,dense=new Map<string,WetFieldTile>(),compact=new Map<string,WetFieldTile>(),data=new Map<string,Float32Array>();
 const value=(x:number,y:number)=>{const a=Math.fround(((x-offset)*17+(y-offset)*31&255)/255);return[Math.fround(.25*a),Math.fround(.75*a),0,a];};
 for(let y=Math.floor(bounds.y/8)*8;y<bounds.y+bounds.height;y+=8)for(let x=Math.floor(bounds.x/8)*8;x<bounds.x+bounds.width;x+=8){
  const cell=wetTileKey(x,y),full=new Float32Array(8*8*4);for(let py=0;py<8;py++)for(let px=0;px<8;px++)full.set(value(x+px,y+py),(py*8+px)*4);dense.set(cell,'dense/'+cell);data.set('dense/'+cell,full);
  const left=Math.max(x,bounds.x),top=Math.max(y,bounds.y),region={x:left,y:top,width:Math.min(x+8,bounds.x+bounds.width)-left,height:Math.min(y+8,bounds.y+bounds.height)-top},pixels=new Float32Array(region.width*region.height*4);for(let py=0;py<region.height;py++)for(let px=0;px<region.width;px++)pixels.set(value(left+px,top+py),(py*region.width+px)*4);compact.set(cell,{key:'compact/'+cell,region});data.set('compact/'+cell,pixels);
 }
 const frames=offset?[new AffineTransform(1,0,0,1,.25,-.5)]:[new AffineTransform(),new AffineTransform(.7,-.4,.2,1.3,-.5,.25),new AffineTransform(-1,.3,.1,1.2,.125,-.375),new AffineTransform(2,.125,.25,.5,-.25,.75)];
 for(const frame of frames){const sourceFrame=offset?new AffineTransform(1,0,0,1,.25,-.5):new AffineTransform(1.1,.2,-.125,.9,.25,-.5),region={x:offset-4,y:offset-4,width:8,height:8},expected=await sampleWetField({bounds,transform:sourceFrame,tiles:dense},frame,region,tileSize,async key=>data.get(key)!,()=>{}),actual=await sampleWetField({bounds,transform:sourceFrame,tiles:compact},frame,region,tileSize,async key=>data.get(key)!,()=>{});expect(new Uint32Array(actual.buffer)).toEqual(new Uint32Array(expected.buffer));expect(actual.some(value=>value>0)).toBe(true);}
});

it('captures compact native metadata before reads and rejects incomplete support or malformed stored planes',async()=>{
 const region={x:1,y:2,width:2,height:2},reference={key:'pigment',region:{...region}},field:WetField={bounds:region,transform:new AffineTransform(),tiles:new Map([['0,0',reference]])},source=new Float32Array(16);for(let i=0;i<16;i+=4)source.set([.125,.25,0,.5],i);
 let release!:(value:Float32Array)=>void;const pending=sampleWetField(field,new AffineTransform(),region,8,()=>new Promise(resolve=>{release=resolve;}),()=>{});reference.region.x=99;(field.tiles as Map<string,WetFieldTile>).clear();release(source);expect(await pending).toEqual(source);
 for(const patch of[{x:0},{width:1},{height:3}])await expect(sampleWetField({...field,tiles:new Map([['0,0',{key:'pigment',region:{...region,...patch}}]])},new AffineTransform(),region,8,async()=>source,()=>{})).rejects.toThrow(/complete native cell support/);
 await expect(sampleWetField({...field,tiles:new Map([['0,0',{key:'pigment',region}]])},new AffineTransform(),region,8,async()=>source.subarray(4),()=>{})).rejects.toThrow(/matching Float32/);
});

it('preserves complete pre-optimization native output across dense tile sizes, cache pressure, reflected tips and symmetry',async()=>{
 const bytes=await readFile('tests/fixtures/wet-compact/native-reference.json.gz'),manifest=JSON.parse(await readFile('tests/fixtures/wet-compact/manifest.json','utf8')),reference=JSON.parse(gunzipSync(bytes).toString());expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifest.fixtureSha256);
 for(const row of reference.cases)for(const cacheBytes of[0,512*1024]){
  const stroke=new BrushStroke({size:6,spacing:.3,opacity:.63,flow:.57,pressureSize:true,pressureOpacity:true,tip:{roundness:.6,angle:37,tiltAngle:true},symmetry:BrushSymmetry.mirrorVertical(5),points:[{x:-3.5,y:-1.5,pressure:.4,tilt:{altitude:.4,azimuth:.2}},{x:7.5,y:5.5,pressure:1,tilt:{altitude:.8,azimuth:1}},{x:4.5,y:9.5,pressure:.3,tilt:{altitude:.5,azimuth:2}}]}).toJSON()as BrushStrokeData,read=source((x,y)=>[(x*73+y*19)&255,(y*47)&255,(x*31)&255,((x+y)*59)&255]),transform=new AffineTransform(row.reflected?-1.1:1.1,.2,.1,.9,-.5,1.5),{result}=await run(stroke,read,{tileSize:row.tileSize,cacheBytes,transform,mix:{pickup:.43,wetness:.17},load:{color:[255,10,60,191],load:.23}});
  try{const actual=[...await pixels(result)].map(([key,rgba])=>[...key.split(',').map(Number),...rgba]).sort((a,b)=>a[1]-b[1]||a[0]-b[0]);expect(actual).toEqual(row.pixels);expect(createHash('sha256').update(JSON.stringify(actual)).digest('hex')).toBe(row.sha256);}finally{await result.dispose();}
 }
});

it('retains only bounded processor footprint pigment instead of a full floating backing cell',async()=>{
 const store=new MemoryStore(),put=store.put.bind(store);let maximumStored=0,maximumWorking=0,carriedWrites=0;
 store.put=async(key,value)=>{if(key.startsWith('carried/')){expect(value).toBeInstanceOf(Float32Array);maximumStored=Math.max(maximumStored,value.byteLength);carriedWrites++;}await put(key,value);};
 const stroke=new BrushStroke({size:6,pressureSize:false,spacing:.3,points:[{x:24,y:24},{x:52,y:24}]}).toJSON()as BrushStrokeData,result=await prepareWetStroke(stroke,source(()=>[255,0,0,255]),{...processor,mixWetPaint:async(...args)=>{maximumWorking=Math.max(maximumWorking,args[1].byteLength);return processor.mixWetPaint(...args);}},{tileSize:128,coverage:hardCoverage,storage:async()=>store,load:{load:1,color:[0,255,0,255]},mix:{pickup:0}});
 try{expect(carriedWrites).toBeGreaterThan(1);expect(maximumStored).toBeLessThanOrEqual(maximumWorking);expect(maximumStored).toBeLessThan(128*128*4*Float32Array.BYTES_PER_ELEMENT);expect((await pixels(result)).size).toBeGreaterThan(0);}finally{await result.dispose();}
});
