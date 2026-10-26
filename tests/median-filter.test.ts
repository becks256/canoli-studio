import {SCHEMA_VERSION as CURRENT_DOCUMENT_SCHEMA} from '../src/core/model';
import { readFile } from 'node:fs/promises';
import { beforeAll, expect, it } from 'vitest';
import { applyMedianFilter, instantiateKernel, type PixelKernel } from '../src/engine/wasm';
import { Document, MedianFilter, GaussianBlurFilter, SmartToneFilter, LayerGroup, VectorLayer, VectorPath } from '../src/dom';
import {planSvgSmart} from '../src/core/svg-smart';
import {svgDocumentChunks} from '../src/core/svg-export';
import { smartFilterHalo } from '../src/core/smart/filters';
import { validateDocument } from '../src/core/model';
import { parseCommands } from '../src/core/validation';
let kernel:PixelKernel;
beforeAll(async()=>{kernel=await instantiateKernel(new Uint8Array(await readFile('public/wasm/pixels.wasm')));});

// Deliberately sort raw weighted samples independently of the sliding-histogram kernel.
export function medianReference(input:Uint8ClampedArray,width:number,height:number,radius:number) {
  const output=input.slice();
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
    const at=(y*width+x)*4;if(!input[at+3])continue;
    for(let c=0;c<3;c++){
      const values:{value:number;weight:number}[]=[];let total=0;
      for(let yy=Math.max(0,y-radius);yy<=Math.min(height-1,y+radius);yy++)
        for(let xx=Math.max(0,x-radius);xx<=Math.min(width-1,x+radius);xx++){
          const p=(yy*width+xx)*4,weight=input[p+3];
          if(weight){values.push({value:input[p+c],weight});total+=weight;}
        }
      values.sort((a,b)=>a.value-b.value);let sum=0;
      for(const sample of values){sum+=sample.weight;if(sum*2>=total){output[at+c]=sample.value;break;}}
    }
  }
  return output;
}

it('matches an independent weighted sort over random RGBA, single rows/columns, large supports and all radii',()=>{
  let seed=0x72ee901;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed>>>24;};
  let comparisons=0;
  for(const [width,height] of [[1,1],[1,19],[23,1],[2,3],[17,13],[31,7]])for(let radius=0;radius<=32;radius++){
    const input=Uint8ClampedArray.from({length:width*height*4},(_,i)=>i%4===3&&random()<85?0:random()),saved=input.slice();
    const result=applyMedianFilter(kernel,input,width,height,radius);
    expect(result,`${width}x${height} radius ${radius}`).toEqual(medianReference(input,width,height,radius));
    expect(input).toEqual(saved);expect(result.buffer).not.toBe(input.buffer);comparisons++;
  }
  expect(comparisons).toBe(198);
});

it('removes impulse noise, keeps hard edges and original alpha, and ignores hidden transparent color',()=>{
  const input=new Uint8ClampedArray(13*9*4);
  for(let y=0;y<9;y++)for(let x=0;x<13;x++)input.set(x<6?[70,100,130,255]:[180,210,240,255],(y*13+x)*4);
  input.set([255,255,255,255],(4*13+3)*4);input.set([0,0,0,255],(4*13+9)*4);
  const output=applyMedianFilter(kernel,input,13,9,1);
  expect([...output.slice((4*13+3)*4,(4*13+3)*4+4)]).toEqual([70,100,130,255]);
  expect([...output.slice((4*13+9)*4,(4*13+9)*4+4)]).toEqual([180,210,240,255]);
  for(let x=0;x<13;x++)expect(output[(4*13+x)*4]).toBe(x<6?70:180);
  const sparse=new Uint8ClampedArray([1,2,255,0, 240,70,10,128, 0,255,2,0]);
  expect(applyMedianFilter(kernel,sparse,3,1,32)).toEqual(sparse);
  // Equal total weight uses the lower value, not channel averages or an unweighted rank.
  expect([...applyMedianFilter(kernel,new Uint8ClampedArray([10,20,30,255,240,220,200,255]),2,1,1)])
    .toEqual([10,20,30,255,10,20,30,255]);
  const weighted=new Uint8ClampedArray([240,220,200,255,10,20,30,1,10,20,30,1]);
  expect(applyMedianFilter(kernel,weighted,3,1,2)[4]).toBe(240);
});

it('produces byte-identical whole and irregular halo tiles without changing original or hidden bytes',()=>{
  const width=79,height=41,input=Uint8ClampedArray.from({length:width*height*4},(_,i)=>(i*71+Math.floor(i/11)*23)%256);
  for(const radius of [0,1,4,16,32]){
    const whole=applyMedianFilter(kernel,input,width,height,radius),tiled=input.slice();
    for(let y=0;y<height;y+=9)for(let x=0;x<width;x+=13){
      const w=Math.min(13,width-x),h=Math.min(9,height-y),tw=w+radius*2,th=h+radius*2,tile=new Uint8ClampedArray(tw*th*4);
      for(let yy=0;yy<th;yy++)for(let xx=0;xx<tw;xx++){
        const sx=x+xx-radius,sy=y+yy-radius;
        if(sx>=0&&sy>=0&&sx<width&&sy<height)tile.set(input.subarray((sy*width+sx)*4,(sy*width+sx)*4+4),(yy*tw+xx)*4);
      }
      const filtered=applyMedianFilter(kernel,tile,tw,th,radius);
      for(let yy=0;yy<h;yy++)tiled.set(filtered.subarray(((yy+radius)*tw+radius)*4,((yy+radius)*tw+radius+w)*4),((y+yy)*width+x)*4);
    }
    expect(tiled,`radius ${radius}`).toEqual(whole);
  }
});

it('validates internal geometry/radius and retains WASM-backed input ownership across growth',()=>{
  const input=new Uint8ClampedArray(16);
  for(const radius of [-1,.5,33,NaN,Infinity,null,'1'])expect(()=>applyMedianFilter(kernel,input,2,2,radius as number)).toThrow();
  for(const [w,h] of [[0,2],[2,0],[1.5,2],[3,2],[Infinity,2]])expect(()=>applyMedianFilter(kernel,input,w,h,1)).toThrow(/geometry/);
  const offset=Math.ceil(kernel.bufferOffset()/4)*4,required=offset+4*128*128;
  if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));
  const view=new Uint8ClampedArray(kernel.memory.buffer,offset,128*128*4);view.fill(255);const captured=view.slice();
  expect(applyMedianFilter(kernel,view,128,128,1)).toEqual(captured);
});

it('uses strict immutable constructors and additive finite support for active filters only',()=>{
  const filter=new MedianFilter();expect(filter.toJSON()).toMatchObject({kind:'median',radius:1,enabled:true});expect(Object.isFrozen(filter)).toBe(true);
  for(const options of [{radius:null},{radius:1.5},{radius:33},{enabled:null},{extra:1},{kind:'median'}])expect(()=>new MedianFilter(options as never)).toThrow();
  const saved=filter.toJSON();(saved as {radius:number}).radius=20;expect(filter.toJSON()).toMatchObject({radius:1});
  expect(smartFilterHalo([filter.toJSON(),new GaussianBlurFilter({sigma:1.5}).toJSON(),new MedianFilter({radius:32,enabled:false}).toJSON(),new SmartToneFilter().toJSON()])).toBe(6);
});

it('retains editable SVG geometry for zero-radius and disabled median values',()=>{
  const document=new Document({width:32,height:32}),master=new Document({width:16,height:16});
  master.layers.add(new VectorLayer()).paths.add(VectorPath.rectangle({x:1,y:1,width:12,height:12},0,{fill:'#cc4020',stroke:null}));
  const instance=document.placeSmartObject(document.defineComponent(master));
  const baseline=planSvgSmart(document.toJSON()),svg=[...svgDocumentChunks(baseline.document)].join('');
  for(const filter of [new MedianFilter({radius:0}),new MedianFilter({radius:32,enabled:false})]){
    instance.setFilters([filter]);const saved=document.toJSON(),plan=planSvgSmart(saved);
    expect(plan.filtered).toBe(0);expect(plan.expanded).toBe(1);expect([...svgDocumentChunks(plan.document)].join('')).toBe(svg);
    expect(document.toJSON()).toEqual(saved);
  }
  instance.setFilters([new MedianFilter()]);expect(planSvgSmart(document.toJSON()).filtered).toBe(1);
});

it('shares commands, locks, one-step history and schema-age checks, including nested component masters',()=>{
  const document=new Document(),key=document.defineComponent(new Document({width:8,height:8})),instance=document.placeSmartObject(key);
  const before=document.toJSON(),history=document.getSnapshot().past.length;
  instance.setFilters([new MedianFilter({radius:2}),new SmartToneFilter({contrast:5})]);
  const after=document.toJSON();expect(after.schemaVersion).toBe(CURRENT_DOCUMENT_SCHEMA);expect(document.getSnapshot().past).toHaveLength(history+1);
  expect(after.components).toEqual(before.components);expect(Document.fromJSON(after).toJSON()).toEqual(after);
  document.undo();expect(document.toJSON()).toEqual(before);document.redo();expect(document.toJSON()).toEqual(after);
  expect(()=>validateDocument({...after,schemaVersion:37})).toThrow(/Median filters require schema version 38/);
  const owner=new Document();owner._dispatch({type:'component.set',definition:before.components![0]});
  const nested=owner.defineComponent(document);owner.placeSmartObject(nested);const saved=owner.toJSON();
  const definition=saved.components!.find(d=>d.id===nested)!;if(definition.source.kind!=='document')throw new Error('fixture');
  definition.source.document.schemaVersion=37;
  expect(()=>Document.fromJSON(saved)).toThrow(/Median filters require schema version 38/);
  instance.locked=true;const locked=document.toJSON();expect(()=>instance.setFilters([new MedianFilter()])).toThrow(/Unlock/);expect(document.toJSON()).toEqual(locked);
  expect(()=>parseCommands([{type:'smartObject.filters',id:instance.id,filters:[{...new MedianFilter().toJSON(),radius:1.5}]}])).toThrow();
  const old=new Document(),group=old.layers.add(new LayerGroup());group.name='Legacy';
  const legacy={...old.toJSON(),schemaVersion:37 as const};expect(Document.fromJSON(legacy).toJSON()).toEqual({...legacy,schemaVersion:CURRENT_DOCUMENT_SCHEMA});
  const state=old.getSnapshot(),restored=Document._fromWorkspace(legacy,{version:1,past:state.past,future:state.future});
  restored.undo();expect(restored.toJSON().schemaVersion).toBe(CURRENT_DOCUMENT_SCHEMA);restored.redo();expect(restored.toJSON()).toEqual({...legacy,schemaVersion:CURRENT_DOCUMENT_SCHEMA});
});
