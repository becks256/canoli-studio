import {test,expect} from '@playwright/test';

for(const budget of [4096,1024*1024])test(`mixed surface and pixel cache respects ${budget} byte budget and entry ceiling`,async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async(budget)=>{
  const {CanvasCache}=await import(/* @vite-ignore */ String('/src/engine/cache.ts'));
  const cache=new CanvasCache(budget),source=document.createElement('canvas'),target=document.createElement('canvas');
  source.width=source.height=target.width=target.height=16;
  source.getContext('2d')!.fillStyle='#abcdef';source.getContext('2d')!.fillRect(0,0,16,16);
  const pixels=source.getContext('2d')!.getImageData(0,0,16,16).data;
  let maxBytes=0;
  for(let i=0;i<260;i++){
   if(i%2)cache.writePixels(String(i),'v',pixels);else cache.write(String(i),'v',source);
   maxBytes=Math.max(maxBytes,cache.byteLength);
  }
  const oldest=cache.read('0','v',target),fifth=cache.read('4','v',target);
  const recent=cache.read('258','v',target),recentPixels=cache.readPixels('259','v');
  const pixel=[...target.getContext('2d')!.getImageData(0,0,1,1).data];
  cache.clear();const cleared=cache.byteLength;
  source.width=source.height=target.width=target.height=1;
  return {maxBytes,oldest,fifth,recent,pixel,pixels:recentPixels?.length,cleared};
 },budget);
 expect(result.maxBytes).toBeLessThanOrEqual(budget);
 expect(result).toMatchObject({oldest:false,fifth:budget>4096,recent:true,pixel:[171,205,239,255],pixels:1024,cleared:0});
});
