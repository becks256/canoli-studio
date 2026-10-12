import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { coverageOutline, encodeCoverage, coverageAt, pixelCoverageSchema, wandCoverage } from '../src/core/pixel-selection';
import { Document, RasterLayer, EraserStroke, MarqueeSelection } from '../src/dom';
import { instantiateKernel, renderSelection } from '../src/engine/wasm';

it('preserves alpha and holes through encoded, transformed and tiled WASM selections', async () => {
  const kernel = await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));
  const alpha = new Uint8Array([0, 64, 255, 128, 0, 255]);
  const coverage = encodeCoverage(alpha, 3, 2);
  expect(pixelCoverageSchema.parse(coverage)).toEqual(coverage);
  for (let i = 0; i < alpha.length; i++) expect(coverageAt(coverage, i%3, Math.floor(i/3))).toBe(alpha[i]);
  const selection = new MarqueeSelection({ shape: 'pixels', x: 4, y: 7, width: 3, height: 2, coverage }).toJSON();
  const options = { selection, width: 3, height: 2, x: 4, y: 7, stepX: 1, stepY: 1 };
  const full = renderSelection(kernel, options);
  expect([...full.filter((_,i) => i%4===3)]).toEqual([...alpha]);
  const bottom = renderSelection(kernel, { ...options, y: 8, height: 1 });
  expect([...bottom]).toEqual([...full.slice(12)]);
  const clipped = new MarqueeSelection(selection).combine(new MarqueeSelection({ shape: 'rectangle', x: 5, y: 7, width: 1, height: 2 }), 'intersect');
  expect([...renderSelection(kernel,{...options,selection:clipped.toJSON()}).filter((_,i)=>i%4===3)]).toEqual([0,64,0,0,0,0]);
  expect(()=>pixelCoverageSchema.parse({...coverage,runs:[2,255,1,0]})).toThrow();
});

it('wand distinguishes contiguous islands, tolerance, transparency and noncontiguous matching', () => {
  const pixels = new Uint8ClampedArray([255,0,0,255, 0,0,255,255, 250,0,0,255, 10,20,30,0, 99,88,77,0, 0,0,0,128]);
  expect([...wandCoverage(pixels,6,1,0,0,8,true)]).toEqual([255,0,0,0,0,0]);
  expect([...wandCoverage(pixels,6,1,0,0,8,false)]).toEqual([255,0,255,0,0,0]);
  expect([...wandCoverage(pixels,6,1,3,0,0,true)]).toEqual([0,0,0,255,255,0]);
  expect(()=>wandCoverage(pixels,6,1,0,0,256)).toThrow();
});

it('raster erasures share validation, lock protection, undo and schema persistence', () => {
  const document = new Document();
  const layer = document.layers.add(new RasterLayer({ name:'Image', assetId:'source', width:8, height:8 }));
  const before = document.toJSON();
  layer.erase(new EraserStroke({ points:[{x:2,y:2}], size:2 }));
  expect(document.toJSON().children[0]).toMatchObject({ kind:'raster',assetId:'source',erasures:[{width:8,height:8,stroke:{kind:'eraser'}}] });
  expect(Document.fromJSON(document.toJSON()).toJSON()).toEqual(document.toJSON());
  const legacy = document.toJSON(); legacy.schemaVersion=15;
  expect(()=>Document.fromJSON(legacy)).toThrow(/schema version 16/);
  document.undo(); expect(document.toJSON()).toEqual(before);
  document.redo(); layer.locked=true;
  expect(()=>layer.erase(new EraserStroke({points:[{x:1,y:1}]}))).toThrow(/Unlock/);
});

it('appending raster erasures retains prior immutable clips without weakening schema validation', () => {
  const document = new Document();
  const image = document.layers.add(new RasterLayer({assetId:'image',width:8,height:8}));
  const clip = new MarqueeSelection({shape:'pixels',x:0,y:0,width:2,height:1,
    coverage:{width:2,height:1,runs:[1,128,2,255]}});
  image.erase(new EraserStroke({points:[{x:1,y:1}],clip}));
  const before = document.getSnapshot().document.children[0];
  if (before.kind !== 'raster') throw new Error('Expected raster');
  for (let i=0;i<5;i++) image.erase(new EraserStroke({points:[{x:i,y:2}],clip}));
  const after = document.getSnapshot().document.children[0];
  if (after.kind !== 'raster') throw new Error('Expected raster');
  expect(after.erasures![0]).toBe(before.erasures![0]);
  expect(before.erasures).toHaveLength(1);
  expect(()=>image.update({erasures:[{width:8,height:8,stroke:{...after.erasures![0].stroke,kind:'brush'} as any}]})).toThrow();
  expect(document.getSnapshot().document.children[0]).toBe(after);
});

it('compact outlines preserve every boundary edge for holes, islands and gaps',()=>{
 let seed=723;
 for(let fixture=0;fixture<20;fixture++){
  const width=9,height=8;
  const alpha=Uint8Array.from({length:width*height},()=>{seed=(seed*1664525+1013904223)>>>0;return seed%3?128:0;});
  const selected=(x:number,y:number)=>x>=0&&x<width&&y>=0&&y<height&&alpha[y*width+x]>0;
  const expected=new Set<string>();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++)if(selected(x,y)){
   if(!selected(x,y-1))expected.add(`h:${x}:${y}`);
   if(!selected(x,y+1))expected.add(`h:${x}:${y+1}`);
   if(!selected(x-1,y))expected.add(`v:${x}:${y}`);
   if(!selected(x+1,y))expected.add(`v:${x+1}:${y}`);
  }
  const path=coverageOutline(encodeCoverage(alpha,width,height)),actual:string[]=[];
  for(const match of path.matchAll(/M(\d+) (\d+)(H|v)(\d+)/g)){
   const x=Number(match[1]),y=Number(match[2]),end=Number(match[4]);
   if(match[3]==='H')for(let p=x;p<end;p++)actual.push(`h:${p}:${y}`);
   else for(let p=y;p<y+end;p++)actual.push(`v:${x}:${p}`);
  }
  expect(new Set(actual)).toEqual(expected);expect(actual.length).toBe(expected.size);
 }
 const tall=coverageOutline({width:1,height:5000,runs:[5000,255]});
 expect(tall.length).toBeLessThan(80);
});

it('native pixel-grid masks match supersampling for every alpha byte, clipped tiles and translated regions',async()=>{
  const kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));
  for(const [width,height] of [[256,1],[17,19]]){
    const alpha=Uint8Array.from({length:width*height},(_,i)=>i%256);
    const selection=new MarqueeSelection({shape:'pixels',x:4,y:-3,width,height,coverage:encodeCoverage(alpha,width,height)}).toJSON();
    for(const shift of [0,0.25,3])for(const [x,y,w,h] of [[4,-3,width,height],[-2,-6,12,10],[9,0,8,12],[width+10,4,5,5]]){
      const actualSelection=structuredClone(selection);
      actualSelection.regions[0].transform={a:1,b:0,c:0,d:1,e:shift,f:shift};
      // An out-of-bounds extra region forces the unchanged generic kernel.
      const generic={regions:[...actualSelection.regions,{shape:'rectangle' as const,operation:'add' as const,x:10000,y:10000,width:1,height:1}]};
      const tile={selection:actualSelection,width:w,height:h,x:x+shift,y:y+shift,stepX:1,stepY:1};
      const fast=renderSelection(kernel,tile);
      const reference=renderSelection(kernel,{...tile,selection:generic});
      expect(fast).toEqual(reference);
      for(let row=0;row<h;row++)for(let col=0;col<w;col++){
        const lx=x+col-4,ly=y+row+3;
        expect(fast[(row*w+col)*4+3]).toBe(lx>=0&&lx<width&&ly>=0&&ly<height?alpha[ly*width+lx]:0);
      }
    }
  }
});

it('wand color matching preserves premultiplied RGBA thresholds and four-connected islands', () => {
  const reference = (pixels: Uint8ClampedArray, width: number, height: number, seed: number, tolerance: number, contiguous: boolean) => {
    const accepted = new Uint8Array(width * height);
    for (let i = 0; i < accepted.length; i++) {
      const a = pixels[i * 4 + 3], b = pixels[seed * 4 + 3];
      let distance = Math.abs(a - b);
      for (let c = 0; c < 3; c++) distance = Math.max(distance, Math.abs(pixels[i * 4 + c] * a / 255 - pixels[seed * 4 + c] * b / 255));
      if (distance <= tolerance) accepted[i] = 255;
    }
    if (!contiguous) return accepted;
    const selected = new Uint8Array(accepted.length), pending = [seed];
    selected[seed] = 255;
    for (let head = 0; head < pending.length; head++) {
      const i = pending[head], x = i % width, y = Math.floor(i / width);
      for (const [dx,dy] of [[-1,0],[1,0],[0,-1],[0,1]]) {
        const nx = x + dx, ny = y + dy, next = ny * width + nx;
        if (nx >= 0 && nx < width && ny >= 0 && ny < height && accepted[next] && !selected[next]) {
          selected[next] = 255; pending.push(next);
        }
      }
    }
    return selected;
  };
  let random = 17;
  const next = () => { random = (Math.imul(random,1664525) + 1013904223) >>> 0; return random >>> 24; };
  for (let fixture = 0; fixture < 24; fixture++) {
    const width = 13, height = 11;
    const pixels = Uint8ClampedArray.from({length:width*height*4}, next);
    for (let i = 0; i < width*height; i++) {
      if (fixture % 4 === 0) pixels.set([i%3 ? 100 : 180, 70, 130, i%5 ? 128 : 0], i*4);
      if (fixture % 4 === 1) pixels[i*4+3] = 255;
      if (fixture % 4 === 2) {
        const row = Math.floor(i / width), col = i % width;
        const path = row % 2 === 0 || col === (row % 4 === 1 ? 0 : width - 1);
        pixels.set([path ? 100 : 240, 0, 0, 255], i * 4);
      }
    }
    const seed = fixture * 5;
    for (const tolerance of [0,1,31,32,64,127,128,254,255]) for (const contiguous of [false,true]) {
      expect(wandCoverage(pixels,width,height,seed%width,Math.floor(seed/width),tolerance,contiguous))
        .toEqual(reference(pixels,width,height,seed,tolerance,contiguous));
    }
  }
});
