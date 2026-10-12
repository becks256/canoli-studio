import {test,expect} from '@playwright/test';

for(const end of ['continue','cancel','commit','switch','zoom','revision'] as const)test(`pending transform frame respects ${end}`,async({page})=>{
  await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(async()=>{
    const e=window.luma.editor;e.newDocument({width:400,height:300});
    const c=new OffscreenCanvas(80,40);c.getContext('2d')!.fillRect(0,0,80,40);
    const layer=await e.importImage(new File([await c.convertToBlob()],'Transform.png',{type:'image/png'}));layer.update({x:100,y:100});
  });
  await page.keyboard.press('Control+1');await page.waitForTimeout(150);
  const handle=(await page.getByRole('button',{name:'Drag to rotate layer'}).boundingBox())!;
  await page.mouse.move(handle.x+handle.width/2,handle.y+handle.height/2);await page.mouse.down();
  await page.evaluate(()=>{
    const e=window.luma.editor,prepare=e.renderer.prepareViewport.bind(e.renderer);
    const state={held:false,presented:0,released:false,release:()=>{}};(window as any).pendingTransform=state;
    let armed=true;
    e.renderer.prepareViewport=async(...args)=>{
      const frame=await prepare(...args);
      if(armed){armed=false;const present=frame.present.bind(frame);frame.present=canvas=>{state.presented++;present(canvas);};state.held=true;await new Promise<void>(resolve=>{state.release=resolve;});state.released=true;}
      return frame;
    };
  });
  await page.mouse.move(handle.x+20,handle.y+15);
  await expect.poll(()=>page.evaluate(()=>(window as any).pendingTransform.held)).toBe(true);
  await page.mouse.move(handle.x+40,handle.y+30);
  if(end==='cancel')await page.keyboard.press('Escape');
  if(end==='commit')await page.mouse.up();
  if(end==='zoom')await page.keyboard.press('=');
  if(end==='revision')await page.evaluate(()=>{window.luma.editor.document.name='Changed';});
  if(end==='switch')await page.evaluate(()=>window.luma.editor.newDocument({width:50,height:50}));
  // Let React publish the newer target before releasing the older prepared frame.
  await page.evaluate(()=>new Promise<void>(resolve=>requestAnimationFrame(()=>requestAnimationFrame(()=>resolve()))));
  await page.evaluate(()=>(window as any).pendingTransform.release());
  await expect.poll(()=>page.evaluate(()=>(window as any).pendingTransform.released)).toBe(true);
  if(end==='continue')await expect.poll(()=>page.evaluate(()=>(window as any).pendingTransform.presented)).toBe(1);
  else {await page.waitForTimeout(100);expect(await page.evaluate(()=>(window as any).pendingTransform.presented)).toBe(0);}
  await page.mouse.up();
});
