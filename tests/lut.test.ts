import { beforeAll, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { Document, AdjustmentLayer, LayerMask, MarqueeSelection } from "../src/dom";
import { parseCubeLut, serializeCubeLut, defaultLutAdjustment, cubeLutSchema, lutValues, primeLutCache } from "../src/core/lut";
import { validateDocument } from "../src/core/model";
import { parseCommands } from "../src/core/validation";
import { applyLookup, instantiateKernel, type PixelKernel } from "../src/engine/wasm";
import { adjustLookup } from "../src/engine/lut";
import { RecipeRecorder, executeRecipe } from "../src/ai/recipes";

let kernel: PixelKernel;
beforeAll(async () => { kernel = await instantiateKernel(new Uint8Array(await readFile("public/wasm/pixels.wasm"))); });
const cube = 'TITLE "Swap # look"\nLUT_3D_SIZE 2\n0 0 0\n0 0 1\n0 1 0\n0 1 1\n1 0 0\n1 0 1\n1 1 0\n1 1 1\n';

it("parses portable red-fastest 1D/3D tables, comments, numeric syntax, domains and format maxima", () => {
  const lut = parseCubeLut('\uFEFF# comment\r\n\r\n'+cube.replace(/\n/g, '\r'));
  expect(lut.title).toBe("Swap # look"); expect(lut.dimension).toBe(3); expect(lut.size).toBe(2);
  expect(lutValues(lut).slice(3, 6)).toEqual(new Float32Array([0, 0, 1]));
  expect(parseCubeLut(serializeCubeLut(lut))).toEqual(lut);
  const signedZero=parseCubeLut('LUT_1D_SIZE 2\n-0 0 0\n1 1 1');
  expect(parseCubeLut(serializeCubeLut(signedZero))).toEqual(signedZero);
  const one = parseCubeLut('DOMAIN_MIN -.5 0 +.25\nLUT_1D_SIZE 2\nDOMAIN_MAX 1.5 1e0 2\n-1 0 0 # row\n2 1 1');
  expect(one.domainMin).toEqual([-.5, 0, .25]); expect(lutValues(one)[0]).toBe(-1);
  const maximum = parseCubeLut('LUT_1D_SIZE 65536\n' + '0 0 0\n'.repeat(65535) + '1 .5 .25');
  expect(lutValues(maximum)).toHaveLength(65536 * 3);
  expect(Array.from(applyLookup(kernel,new Uint8ClampedArray([255,255,255,128,0,0,0,1]),{...defaultLutAdjustment(),lut:maximum})))
    .toEqual([255,128,64,128,0,0,0,1]);
  // A valid maximum-size header must fail for missing rows, not an invented size cap.
  expect(() => parseCubeLut('LUT_3D_SIZE 256')).toThrow(/Incomplete/);
});

it("rejects malformed, ambiguous, unsupported and nonfinite Cube data and hostile packed payloads", () => {
  for (const source of ['', 'LUT_3D_SIZE 257', 'LUT_1D_SIZE 65537', 'LUT_1D_SIZE 1', 'LUT_1D_SIZE 2.5',
    'LUT_1D_SIZE 2\n0 0 0', 'LUT_1D_SIZE 2\n0 0 0\n1 1 1\n1 1 1',
    'LUT_1D_SIZE 2\nLUT_3D_SIZE 2', 'LUT_1D_SIZE 2\nLUT_1D_INPUT_RANGE 0 1',
    'LUT_1D_SIZE 2\nNaN 0 0\n1 1 1', 'LUT_1D_SIZE 2\n1e100 0 0\n1 1 1',
    'LUT_1D_SIZE 2\n0x10 0 0\n1 1 1', 'TITLE unquoted\nLUT_1D_SIZE 2',
    'LUT_1D_SIZE 2\nDOMAIN_MIN 1 0 0\n0 0 0\n1 1 1',
    'LUT_1D_SIZE 2\n0 0 0\nDOMAIN_MAX 1 1 1\n1 1 1',
    'LUT_1D_SIZE 2\nDOMAIN_MIN 0 0 0\nDOMAIN_MIN 0 0 0\n0 0 0\n1 1 1'])
    expect(() => parseCubeLut(source), source).toThrow();
  const { lut } = defaultLutAdjustment();
  for (const invalid of [{ ...lut, data: lut.data + 'AAAA' }, { ...lut, data: lut.data.replace('A', '!') },
    {...lut,data:lut.data.slice(0,-1)+'='}, {...lut,data:lut.data.slice(0,10)+' '+lut.data.slice(11)},
    { ...lut, domainMax: [0, 1, 1] }, { ...lut, extra: true }, { ...lut, size: 3 },
    { ...lut, domainMin: [-1e308, 0, 0], domainMax: [1e308, 1, 1] }]) expect(() => cubeLutSchema.parse(invalid)).toThrow();
  const raw = new Uint8Array(24);new DataView(raw.buffer).setFloat32(0, NaN, true);
  expect(() => cubeLutSchema.parse({ ...lut, data: Buffer.from(raw).toString('base64') })).toThrow(/finite/);
  expect(() => parseCubeLut('# first\n\nLUT_1D_SIZE 2\n0 0 0\nBad data here')).toThrow(/line 5/);
});

it("actual WASM agrees with the JS oracle on 1D/3D interpolation, clamping, amount, alpha and memory growth", () => {
  const pixels = new Uint8ClampedArray(65536 * 4); let seed = 2390;
  for (let i = 0; i < pixels.length; i++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; pixels[i] = seed >>> 24; }
  const original = pixels.slice();
  for (const lut of [defaultLutAdjustment().lut, parseCubeLut(cube),
    parseCubeLut('LUT_1D_SIZE 3\nDOMAIN_MIN -.5 0 .25\nDOMAIN_MAX 1.5 2 1\n-1 0 .5\n.25 .4 2\n1.5 1 0')])
    for (const interpolation of ['tetrahedral', 'trilinear'] as const) for (const amount of [0, 35, 100]) {
      const adjustment = { kind: 'lut' as const, lut, amount, interpolation };
      const actual = applyLookup(kernel, pixels, adjustment), expected = adjustLookup(pixels, adjustment);
      expect(actual.findIndex((value, i) => value !== expected[i]), JSON.stringify({ dimension: lut.dimension, amount, interpolation })).toBe(-1);
    }
  expect(pixels).toEqual(original);
  const swap = { ...defaultLutAdjustment(), lut: parseCubeLut(cube) };
  expect(Array.from(applyLookup(kernel, new Uint8ClampedArray([80,120,150,1]), swap))).toEqual([150,120,80,1]);
  expect(() => applyLookup(kernel, new Uint8ClampedArray(3), swap)).toThrow(/RGBA/);
  expect(applyLookup(kernel, new Uint8ClampedArray(), swap)).toHaveLength(0);
});

it("schema 20 preserves tables, masks and history through strict commands, OOP setters, locks and migration", () => {
  const doc = new Document(), empty = doc.toJSON(), layer = doc.layers.add(new AdjustmentLayer());
  layer.setLut(cube, { amount: 35, interpolation: 'trilinear' });
  layer.mask = new LayerMask({ selection: new MarqueeSelection({ shape: 'rectangle', x: 0, y: 0, width: 10, height: 10 }) });
  const before = doc.getSnapshot(), saved = doc.toJSON();expect(saved.schemaVersion).toBe(39);
  expect(Document.fromJSON(saved).toJSON()).toEqual(saved);
  expect(() => validateDocument({ ...saved, schemaVersion: 19 })).toThrow(/version 20/);
  expect(Document.fromJSON({ ...empty, schemaVersion: 19 }).toJSON()).toEqual(empty);
  for (const adjustment of [{...layer.adjustment, amount: 101}, {...layer.adjustment, interpolation: 'nearest'},
    {...layer.adjustment, extra: true}, {...layer.adjustment, lut: {...(layer.adjustment as any).lut, data: 'AAAA'}}]) {
    expect(() => parseCommands([{type:'layer.update',id:layer.id,patch:{adjustment}}])).toThrow();
    expect(() => {layer.adjustment = adjustment as any;}).toThrow();expect(doc.getSnapshot()).toBe(before);
  }
  expect(() => layer.setLut(cube, { extra: true } as any)).toThrow();
  expect(() => layer.setLut(cube, { amount: null } as any)).toThrow();
  for (let schemaVersion = 1; schemaVersion <= 19; schemaVersion++)
    expect(Document.fromJSON({ ...empty, schemaVersion }).toJSON()).toEqual(empty);
  const old = new Document(); old.layers.add(new AdjustmentLayer({ adjustment: {kind:'white-balance',temperature:9000,tint:12} }));
  const oldSaved = old.toJSON(); expect(Document.fromJSON({...oldSaved,schemaVersion:19}).toJSON()).toEqual(oldSaved);
  layer.setLut(cube);doc.undo();expect(doc.toJSON()).toEqual(saved);doc.redo();expect((layer.adjustment as any).amount).toBe(100);
  const checkpoint=doc.getSnapshot();expect(()=>doc.transaction('Invalid lookup',()=>{layer.setLut(cube,{amount:20});doc.resize(-1,2);})).toThrow();expect(doc.getSnapshot()).toBe(checkpoint);
  layer.locked=true;expect(()=>layer.setLut(cube)).toThrow(/lock/i);
});

it("recipes carry the portable table through deterministic offline replay and one-step undo", () => {
  const doc = new Document(), recorder = new RecipeRecorder();recorder.start();
  doc.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));
  const layer=new AdjustmentLayer();layer.setLut(cube,{amount:60});doc.layers.add(layer);
  const recipe=recorder.stop({name:'Lookup'}),target=new Document();expect(executeRecipe(recipe,target).success).toBe(true);
  expect((target.layers.at(0) as AdjustmentLayer).adjustment).toEqual(layer.adjustment);target.undo();expect(target.layers.length).toBe(0);
});

it("matches independent Colour Science .cube domain and interpolation outputs, including distinct tetrahedral and trilinear results", async () => {
  const reference=JSON.parse(await readFile('tests/fixtures/lut/reference.json','utf8'));
  expect(reference.cases).toHaveLength(12);
  for(const entry of reference.cases) {
    const lut=parseCubeLut(await readFile('tests/fixtures/lut/'+entry.file,'utf8'));
    expect(parseCubeLut(serializeCubeLut(lut))).toEqual(lut);
    const adjustment={kind:'lut' as const,lut,amount:entry.amount,interpolation:entry.interpolation};
    const actual=applyLookup(kernel,new Uint8ClampedArray(entry.pixels),adjustment);
    expect(Array.from(actual),JSON.stringify({file:entry.file,amount:entry.amount,interpolation:entry.interpolation})).toEqual(entry.expected);
  }
  const three=reference.cases.filter((entry:any)=>entry.file==='independent-3d.cube'&&entry.amount===100);
  expect(three[0].expected).not.toEqual(three[1].expected);
});

it("cooperative import validation owns its input and rejects cancellation or nonfinite data before trusting a table",async()=>{
  const raw=Buffer.alloc(65**3*12);raw.writeFloatLE(.314159,0);
  const lut={...defaultLutAdjustment().lut,title:'Async table',dimension:3 as const,size:65,data:raw.toString('base64')};
  const expected=structuredClone(lut),pending=primeLutCache(lut);lut.domainMin[0]=.5;lut.title='Changed';lut.data='AAAA';
  expect(await pending).toEqual(expected);expect(cubeLutSchema.parse(expected)).toEqual(expected);
  raw.writeFloatLE(.271828,0);const cancel={...expected,data:raw.toString('base64')};let checks=0;
  await expect(primeLutCache(cancel,()=>++checks>1)).rejects.toThrow(/cancelled/);
  raw.writeFloatLE(NaN,raw.length-4);const invalid={...expected,data:raw.toString('base64')};
  await expect(primeLutCache(invalid)).rejects.toThrow(/finite/);expect(()=>cubeLutSchema.parse(invalid)).toThrow(/finite/);
});
