import {test,expect} from '@playwright/test';

test('PNG encoding alternatives preserve pixels and record native tile cost',async({page},info)=>{
 await page.goto('/');
 const results=await page.evaluate(async()=>{
  const {encodeRgbaPng}=await import(/* @vite-ignore */ String('/src/engine/png.ts'));
  const results=[];
  for(const pattern of ['flat','gradient']) {
   const size=1024,data=new Uint8ClampedArray(size*size*4);
   for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4;data[i]=pattern==='flat'?255:x%256;data[i+1]=pattern==='flat'?51:y%256;
    data[i+2]=pattern==='flat'?0:(x*y)%256;data[i+3]=255;
   }
   for(let repeat=0;repeat<3;repeat++) for(const method of ['direct','offscreen']) {
    const start=performance.now();let blob:Blob;
    if(method==='direct')blob=await encodeRgbaPng(new Uint8Array(data.buffer),size,size);
    else {
     const canvas=new OffscreenCanvas(size,size);
     canvas.getContext('2d')!.putImageData(new ImageData(data,size,size),0,0);
     blob=await canvas.convertToBlob({type:'image/png'});
     canvas.width=canvas.height=1;
    }
    const ms=performance.now()-start;
    const bitmap=await createImageBitmap(blob),decoded=new OffscreenCanvas(size,size),context=decoded.getContext('2d')!;
    context.drawImage(bitmap,0,0);bitmap.close();const actual=context.getImageData(0,0,size,size).data;
    let equal=true;for(let i=0;i<data.length;i++)if(data[i]!==actual[i]){equal=false;break;}
    decoded.width=decoded.height=1;
    results.push({pattern,repeat,method,ms,bytes:blob.size,equal});
   }
  }
  return results;
 });
 console.log('png-encoding',JSON.stringify(results));
 await info.attach('png-encoding',{body:JSON.stringify(results),contentType:'application/json'});
 expect(results.every(row=>row.equal)).toBe(true);
});

test('worker-native captured PNG matches direct encoding across partial alpha',async({page})=>{
 await page.goto('/');
 const result=await page.evaluate(async()=>{
  const {encodeRgbaPng}=await import(/* @vite-ignore */ String('/src/engine/png.ts'));
  const width=256,height=32,pixels=new Uint8ClampedArray(width*height*4);
  for(let y=0;y<height;y++)for(let x=0;x<width;x++){
   const i=(y*width+x)*4;pixels[i]=(x*13+y*7)%256;pixels[i+1]=(x*3+y*11)%256;pixels[i+2]=(x*17+y)%256;pixels[i+3]=x;
  }
  const reference=await encodeRgbaPng(new Uint8Array(pixels.buffer),width,height);
  const native=await window.luma.editor.renderer.processor.encodePng(pixels,width,height);
  const decode=async(blob:Blob)=>{
   const image=await createImageBitmap(blob),canvas=new OffscreenCanvas(width,height),c=canvas.getContext('2d')!;
   c.drawImage(image,0,0);image.close();return c.getImageData(0,0,width,height).data;
  };
  const a=await decode(reference),b=await decode(native);
  let differences=0,max=0;for(let i=0;i<a.length;i++){const delta=Math.abs(a[i]-b[i]);if(delta)differences++;max=Math.max(max,delta);}
  return {differences,max};
 });
 expect(result).toEqual({differences:0,max:0});
});
