import {readFile} from 'node:fs/promises';
import {beforeAll,expect,it} from 'vitest';
import {applyBilateralFilter,instantiateKernel,type PixelKernel} from '../src/engine/wasm';
import {bilateralWeights,type BilateralFilterOptions} from '../src/core/smart/bilateral-filter';
import {Document,BilateralDenoiseFilter,MedianFilter,VectorLayer,VectorPath} from '../src/dom';
import {smartFilterHalo,isActiveSmartFilter} from '../src/core/smart/filters';
import {validateDocument} from '../src/core/model';
import {parseCommands} from '../src/core/validation';
import {planSvgSmart} from '../src/core/svg-smart';
import {svgDocumentChunks} from '../src/core/svg-export';
let kernel:PixelKernel,wasm:Uint8Array<ArrayBuffer>;
beforeAll(async()=>{wasm=new Uint8Array(await readFile('public/wasm/pixels.wasm'));kernel=await instantiateKernel(wasm);});

// Direct normalized 2D equation; no lookup tables or imported support/weight helper.
function reference(input:Uint8ClampedArray,width:number,height:number,options:BilateralFilterOptions){
  const output=input.slice(),{radius,colorSigma,amount}=options;
  if(!radius||!colorSigma||!amount)return output;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const p=(y*width+x)*4;if(!input[p+3])continue;
    const channels=[0,0,0];let total=0;
    for(let yy=Math.max(0,y-radius);yy<=Math.min(height-1,y+radius);yy++)for(let xx=Math.max(0,x-radius);xx<=Math.min(width-1,x+radius);xx++){
      const q=(yy*width+xx)*4;if(!input[q+3])continue;
      let distance=0;for(let c=0;c<3;c++)distance+=(input[q+c]-input[p+c])**2;
      const color=distance===0?0:distance/(6*colorSigma*colorSigma);
      const weight=input[q+3]/255*Math.exp(-((xx-x)**2+(yy-y)**2)/(2*(radius/2)**2)-color);
      total+=weight;for(let c=0;c<3;c++)channels[c]+=input[q+c]*weight;
    }
    for(let c=0;c<3;c++)output[p+c]=Math.round(input[p+c]+amount*(channels[c]/total-input[p+c]));
  }
  return output;
}
function fixture(w:number,h:number){return Uint8ClampedArray.from({length:w*h*4},(_,i)=>(i*71+Math.floor(i/7)*23)%256);}

it('matches independent direct equations across every radius, alpha, narrow shapes and color tolerances',()=>{
  let count=0;
  for(const [width,height]of [[1,1],[1,17],[19,1],[2,3],[17,11]])for(let radius=0;radius<=16;radius++){
    const input=fixture(width,height);for(let i=3;i<input.length;i+=28)input[i]=0;const before=input.slice();
    for(const colorSigma of [Number.MIN_VALUE,.1,8,25,255]){
      const options={radius,colorSigma,amount:count%2?.35:1},actual=applyBilateralFilter(kernel,input,width,height,options),expected=reference(input,width,height,options);
      let max=0;for(let i=0;i<actual.length;i++)max=Math.max(max,Math.abs(actual[i]-expected[i]));
      expect(max,`${width}x${height} r=${radius}, tolerance=${colorSigma}`).toBeLessThanOrEqual(1);
      for(let i=3;i<input.length;i+=4){expect(actual[i]).toBe(input[i]);if(!input[i])expect(actual.slice(i-3,i)).toEqual(input.slice(i-3,i));}
      expect(input).toEqual(before);expect(actual.buffer).not.toBe(input.buffer);count++;
    }
  }
  expect(count).toBe(425);
});

it('reduces controlled fine-noise MSE while retaining hard color edges and original coverage',()=>{
  const width=96,height=64,clean=new Uint8ClampedArray(width*height*4),noisy=clean.slice();let state=7319841;
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4,color=x<48?[60,85,110,255]:[185,210,235,255];clean.set(color,at);
    for(let c=0;c<3;c++){state=(Math.imul(state,1664525)+1013904223)>>>0;noisy[at+c]=color[c]+((state>>>24)%25)-12;}noisy[at+3]=255;
  }
  const options={radius:3,colorSigma:20,amount:1},filtered=applyBilateralFilter(kernel,noisy,width,height,options),mse=(a:Uint8ClampedArray)=>{
    let sum=0;for(let i=0;i<a.length;i++)if(i%4!==3)sum+=(a[i]-clean[i])**2;return sum/(width*height*3);
  };
  expect(mse(filtered)/mse(noisy)).toBeLessThan(.35);
  const edge=applyBilateralFilter(kernel,clean,width,height,{radius:8,colorSigma:10,amount:1});expect(edge).toEqual(clean);
  const broad=applyBilateralFilter(kernel,clean,width,height,{radius:8,colorSigma:255,amount:1});expect(broad[(32*width+47)*4]).toBeGreaterThan(60);
  for(let i=3;i<filtered.length;i+=4)expect(filtered[i]).toBe(255);
});

it('ignores hidden transparent color, weights partial coverage and has exact inert settings',()=>{
  const input=new Uint8ClampedArray([255,0,220,0, 95,100,105,255, 0,250,0,0]);
  expect(applyBilateralFilter(kernel,input,3,1,{radius:16,colorSigma:255,amount:1})).toEqual(input);
  const partial=new Uint8ClampedArray([250,0,0,1,100,100,100,255,0,250,0,1]);
  expect([...applyBilateralFilter(kernel,partial,3,1,{radius:1,colorSigma:255,amount:1}).slice(4,8)]).toEqual([100,100,100,255]);
  for(const options of [{radius:0,colorSigma:25,amount:1},{radius:4,colorSigma:0,amount:1},{radius:4,colorSigma:25,amount:0}])
    expect(applyBilateralFilter(kernel,partial,3,1,options)).toEqual(partial);
});

it('retains exact full-image versus irregular halo-tile output across stacked native supports',()=>{
  const width=71,height=39,input=fixture(width,height);
  for(const options of [{radius:1,colorSigma:25,amount:1},{radius:4,colorSigma:80,amount:.45},{radius:16,colorSigma:255,amount:1}]){
    const whole=applyBilateralFilter(kernel,input,width,height,options),tiled=input.slice(),r=options.radius;
    for(let y=0;y<height;y+=11)for(let x=0;x<width;x+=17){
      const w=Math.min(17,width-x),h=Math.min(11,height-y),tw=w+2*r,th=h+2*r,tile=new Uint8ClampedArray(tw*th*4);
      for(let yy=0;yy<th;yy++)for(let xx=0;xx<tw;xx++){
        const sx=x+xx-r,sy=y+yy-r;if(sx>=0&&sy>=0&&sx<width&&sy<height)tile.set(input.subarray((sy*width+sx)*4,(sy*width+sx)*4+4),(yy*tw+xx)*4);
      }
      const filtered=applyBilateralFilter(kernel,tile,tw,th,options);
      for(let yy=0;yy<h;yy++)tiled.set(filtered.subarray(((yy+r)*tw+r)*4,((yy+r)*tw+r+w)*4),((y+yy)*width+x)*4);
    }
    expect(tiled).toEqual(whole);
  }
});

it('keeps weight caches private, validates finite settings and snapshots WASM-backed input before growth',async()=>{
  const options={radius:2,colorSigma:25,amount:1},first=bilateralWeights(2,25);first.range.fill(0);first.spatial.fill(0);
  const second=bilateralWeights(2,25);expect(second.range[0]).toBe(1);expect(second.spatial[12]).toBe(1);
  for(const patch of [{radius:1.5},{radius:17},{radius:-1},{colorSigma:null},{colorSigma:Infinity},{colorSigma:-1},{amount:NaN},{amount:1.1},{amount:-1},{extra:1}])
    expect(()=>applyBilateralFilter(kernel,new Uint8ClampedArray(16),2,2,{...options,...patch}as never)).toThrow();
  expect(()=>applyBilateralFilter(kernel,new Uint8ClampedArray(8193*4),8193,1,options)).toThrow(/geometry/);
  const fresh=await instantiateKernel(wasm),offset=Math.ceil(fresh.bufferOffset()/8)*8,required=offset+128*128*4;
  if(required>fresh.memory.buffer.byteLength)fresh.memory.grow(Math.ceil((required-fresh.memory.buffer.byteLength)/65536));
  const view=new Uint8ClampedArray(fresh.memory.buffer,offset,128*128*4);view.fill(255);const saved=view.slice(),before=fresh.memory.buffer;
  expect(applyBilateralFilter(fresh,view,128,128,options)).toEqual(saved);expect(fresh.memory.buffer).not.toBe(before);
});

it('shares strict immutable values, commands, locks, history and schema-age checks in root and nested masters',()=>{
  const filter=new BilateralDenoiseFilter();expect(filter.toJSON()).toMatchObject({kind:'bilateral-denoise',radius:2,colorSigma:25,amount:.5,enabled:true});expect(Object.isFrozen(filter)).toBe(true);
  for(const options of [{radius:null},{enabled:null},{amount:null},{extra:1},{kind:'bilateral-denoise'}])expect(()=>new BilateralDenoiseFilter(options as never)).toThrow();
  expect(smartFilterHalo([filter.toJSON(),new MedianFilter({radius:3}).toJSON()])).toBe(5);
  const document=new Document(),key=document.defineComponent(new Document({width:8,height:8})),instance=document.placeSmartObject(key),before=document.toJSON(),history=document.getSnapshot().past.length;
  instance.addFilter(filter);const after=document.toJSON();expect(after.schemaVersion).toBe(43);expect(document.getSnapshot().past).toHaveLength(history+1);
  expect(after.components).toEqual(before.components);expect(Document.fromJSON(after).toJSON()).toEqual(after);
  document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);
  expect(()=>validateDocument({...after,schemaVersion:38})).toThrow(/Bilateral denoise filters require schema version 39/);
  const owner=new Document();owner._dispatch({type:'component.set',definition:before.components![0]});const nested=owner.defineComponent(document);owner.placeSmartObject(nested);const saved=owner.toJSON(),definition=saved.components!.find(d=>d.id===nested)!;
  if(definition.source.kind!=='document')throw new Error('fixture');definition.source.document.schemaVersion=38;expect(()=>Document.fromJSON(saved)).toThrow(/schema version 39/);
  instance.locked=true;const locked=document.toJSON();expect(()=>instance.setFilters([])).toThrow(/Unlock/);expect(document.toJSON()).toEqual(locked);
  expect(()=>parseCommands([{type:'smartObject.filters',id:instance.id,filters:[{...filter.toJSON(),amount:null}]}])).toThrow();
  const legacy={...new Document().toJSON(),schemaVersion:38 as const};expect(Document.fromJSON(legacy).toJSON()).toEqual({...legacy,schemaVersion:43});
});

it('preserves editable SVG and native support for every explicitly inert bilateral setting',()=>{
  const document=new Document({width:32,height:32}),master=new Document({width:16,height:16});master.layers.add(new VectorLayer()).paths.add(VectorPath.rectangle({x:1,y:1,width:12,height:12},0,{fill:'#cc4020',stroke:null}));
  const instance=document.placeSmartObject(document.defineComponent(master)),baseline=[...svgDocumentChunks(planSvgSmart(document.toJSON()).document)].join('');
  for(const options of [{radius:0},{colorSigma:0},{amount:0},{enabled:false}]){
    const filter=new BilateralDenoiseFilter(options);expect(isActiveSmartFilter(filter.toJSON())).toBe(false);expect(smartFilterHalo([filter.toJSON()])).toBe(0);
    instance.setFilters([filter]);const plan=planSvgSmart(document.toJSON());expect(plan.filtered).toBe(0);expect(plan.expanded).toBe(1);expect([...svgDocumentChunks(plan.document)].join('')).toBe(baseline);
  }
  instance.setFilters([new BilateralDenoiseFilter()]);expect(planSvgSmart(document.toJSON()).filtered).toBe(1);
});
