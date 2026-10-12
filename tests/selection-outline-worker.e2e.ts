import {test,expect} from '@playwright/test';
test('selection outline jobs terminate on replacement and ignore late results',async({page})=>{
 await page.addInitScript(()=>{
  const NativeWorker=window.Worker;
  (window as any).outlineJobs=[];
  window.Worker=function(url:string|URL,options?:WorkerOptions){
   if(String(url).includes('selection-outline.worker')){
    const job={onmessage:null as any,onerror:null as any,terminated:false,postMessage(){},terminate(){this.terminated=true;}};
    (window as any).outlineJobs.push(job);return job;
   }
   return new NativeWorker(url,options);
  } as any;
 });
 await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
 const select=async(width:number)=>page.evaluate(width=>{
  const {editor,MarqueeSelection}=window.luma;
  editor.document.selection=new MarqueeSelection({shape:'pixels',x:0,y:0,width,height:2,coverage:{width,height:2,runs:[width*2,255]}});
 },width);
 await select(2);await expect.poll(()=>page.evaluate(()=>(window as any).outlineJobs.length)).toBe(1);
 await select(3);await expect.poll(()=>page.evaluate(()=>(window as any).outlineJobs.length)).toBe(2);
 expect(await page.evaluate(()=>(window as any).outlineJobs[0].terminated)).toBe(true);
 await page.evaluate(()=>(window as any).outlineJobs[0].onmessage({data:{paths:['M9 9H10']}}));
 await expect(page.getByTestId('pixel-selection-outline')).toHaveAttribute('d','');
 await page.evaluate(()=>(window as any).outlineJobs[1].onmessage({data:{paths:['M0 0H3']}}));
 await expect(page.getByTestId('pixel-selection-outline')).toHaveAttribute('d','M0 0H3');
 await page.getByRole('button',{name:'Brush tool (B)',exact:true}).click();
 expect(await page.evaluate(()=>(window as any).outlineJobs.length)).toBe(2);
 await select(4);await expect.poll(()=>page.evaluate(()=>(window as any).outlineJobs.length)).toBe(3);
 await page.keyboard.press('Control+d');
 await expect(page.getByTestId('pixel-selection-outline')).toHaveCount(0);
 await expect.poll(()=>page.evaluate(()=>(window as any).outlineJobs[2].terminated)).toBe(true);
 await page.evaluate(()=>(window as any).outlineJobs[2].onmessage({data:{paths:['M7 7H8']}}));
 await expect(page.getByTestId('pixel-selection-outline')).toHaveCount(0);
 await select(5);await expect.poll(()=>page.evaluate(()=>(window as any).outlineJobs.length)).toBe(4);
 await page.evaluate(()=>(window as any).outlineJobs[3].onerror(new Event('error')));
 await expect(page.getByText('Selection outline worker failed. Reselect the area to retry.',{exact:true})).toBeVisible();
 expect(await page.evaluate(()=>window.luma.editor.document.selection!.toJSON().regions[0].width)).toBe(5);
 expect(await page.evaluate(()=>(window as any).outlineJobs[3].terminated)).toBe(true);
});
