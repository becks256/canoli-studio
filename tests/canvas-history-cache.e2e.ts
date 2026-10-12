import {test,expect} from '@playwright/test';

test('canvas cache retains one previous paint version with LRU and shared budget eviction',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {CanvasCache}=await import(/* @vite-ignore */ String('/src/engine/cache.ts'));
    const source=document.createElement('canvas');source.width=source.height=2;
    const target=document.createElement('canvas');target.width=target.height=2;
    const cache=new CanvasCache(100);
    const write=(signature:string,color:string)=>{source.getContext('2d')!.fillStyle=color;source.getContext('2d')!.fillRect(0,0,2,2);cache.write('paint',signature,source,2);};
    const read=(signature:string)=>{target.getContext('2d')!.clearRect(0,0,2,2);const hit=cache.read('paint',signature,target);return {hit,pixel:[...target.getContext('2d')!.getImageData(0,0,1,1).data]};};
    write('a','#ff0000');write('b','#0000ff');
    const prior=read('a'),current=read('b');
    write('c','#00ff00');const oldest=read('a'),retained=read('b');
    write('d','#ffffff');const lru=read('c'),recent=read('b');
    const bounded=cache.byteLength;
    cache.write('paint','e',source);const replaced=read('b');
    cache.clear();const cleared=cache.byteLength;
    const tight=new CanvasCache(36);
    tight.write('x','a',source,2);tight.write('x','b',source,2);tight.write('other','c',source);
    const evicted=!tight.read('x','a',target),tightBytes=tight.byteLength;
    tight.clear();
    const history=new CanvasCache(4096);
    for(let i=0;i<70;i++){
      source.getContext('2d')!.fillStyle=`rgb(${i},0,0)`;source.getContext('2d')!.fillRect(0,0,2,2);
      history.write('paint',String(i),source,64);
    }
    const historyHits=[];
    for(let i=0;i<70;i++)if(history.read('paint',String(i),target))
      historyHits.push({version:i,red:target.getContext('2d')!.getImageData(0,0,1,1).data[0]});
    const historyBytes=history.byteLength;history.clear();
    return {historyHits,historyBytes,prior,current,oldest,retained,lru,recent,bounded,replaced,cleared,evicted,tightBytes};
  });
  expect(result.historyHits).toEqual(Array.from({length:64},(_,i)=>({version:i+6,red:i+6})));
  expect(result.historyBytes).toBeLessThanOrEqual(4096);
  expect(result.prior).toEqual({hit:true,pixel:[255,0,0,255]});
  expect(result.current).toEqual({hit:true,pixel:[0,0,255,255]});
  expect(result.oldest.hit).toBe(false);expect(result.retained.hit).toBe(true);
  expect(result.lru.hit).toBe(false);expect(result.recent.hit).toBe(true);
  expect(result.bounded).toBe(36);expect(result.replaced.hit).toBe(false);
  expect(result.cleared).toBe(0);expect(result.evicted).toBe(true);expect(result.tightBytes).toBe(36);
});
