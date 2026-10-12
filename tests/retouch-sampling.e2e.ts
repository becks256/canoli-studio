import { test, expect } from '@playwright/test';

for (const [width,height] of [[698,396],[698,1500],[2000,1500]]) test(`sampling ${width}x${height} preserves native pixels against square-tile assembly`, async ({page}) => {
  await page.goto('/');
  const results = await page.evaluate(async ({width,height}) => {
    const {sampleRetouchRegion} = await import(/* @vite-ignore */ String('/src/engine/retouch-sampling.ts'));
    const {editor:e,AffineTransform,LayerMask,MarqueeSelection} = window.luma;
    e.newDocument({width,height});
    const canvas = new OffscreenCanvas(256,256), c = canvas.getContext('2d')!;
    const image = c.createImageData(256,256);
    for (let i=0;i<256*256;i++) image.data.set([i%251,(i*17)%253,(i*31)%255,1+(i*13)%255],i*4);
    c.putImageData(image,0,0);
    const layer = await e.importImage(new File([await canvas.convertToBlob()],'pattern.png',{type:'image/png'}));
    layer.update({width:1800,height:1300,x:25.25,y:30.5});
    const region = {x:0,y:0,width,height};
    const results=[];
    for (const styled of [false,true]) {
      if (styled) {
        layer.transform = new AffineTransform(1,.07,-.03,.9,15,7);
        layer.mask = new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:10,y:20,width:1750,height:1250}),feather:3.5});
      }
      const source=e.document.getSnapshot().document;
      const actual=await sampleRetouchRegion(source,e.assetStore,e.renderer,region);
      const expected=new Uint8ClampedArray(actual.length);
      for(let y=0;y<region.height;y+=1024) for(let x=0;x<region.width;x+=1024) {
        const width=Math.min(1024,region.width-x),height=Math.min(1024,region.height-y);
        const tile=await e.renderer.render(source,e.assetStore,{region:{x,y,width,height},outputSize:{width,height},cache:false,readback:true});
        try {
          const pixels=tile.getContext('2d')!.getImageData(0,0,width,height).data;
          for(let row=0;row<height;row++) expected.set(pixels.subarray(row*width*4,(row+1)*width*4),((y+row)*region.width+x)*4);
        } finally {tile.width=tile.height=0;}
      }
      let max=0,different=0;
      for(let i=0;i<actual.length;i++) {const delta=Math.abs(actual[i]-expected[i]);max=Math.max(max,delta);if(delta)different++;}
      results.push({styled,max,different});
    }
    return results;
  },{width,height});
  expect(results.every(result=>result.max===0),JSON.stringify(results)).toBe(true);
});
