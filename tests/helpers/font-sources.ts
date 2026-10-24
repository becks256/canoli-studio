import {expect,type Page,type TestInfo} from '@playwright/test';
import {historyScript,historyProject,historyPng} from './history-inspector';
import {openFontManager} from './font-management';
import {readFile,writeFile} from 'node:fs/promises';

async function previewPixels(page:Page){
  return page.evaluate(async()=>{
    const frame=document.querySelector<HTMLIFrameElement>('iframe[title="Selected font preview"]'),canvas=frame?.contentDocument?.querySelector('canvas');
    if(!canvas||!canvas.width||!canvas.height)return null;
    const pixels=canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;
    if(!pixels.some((value,i)=>i%4===3&&value>0))return null;
    const visible=document.querySelector<HTMLCanvasElement>('canvas.font-source-preview');
    if(!visible||visible.width!==canvas.width||visible.height!==canvas.height)return null;
    const displayed=visible.getContext('2d')!.getImageData(0,0,visible.width,visible.height).data;
    if(pixels.some((value,i)=>value!==displayed[i]))return null;
    return {width:canvas.width,height:canvas.height,advance:canvas.getContext('2d')!.measureText('AAAA').width,sha256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels.buffer))].map(v=>v.toString(16).padStart(2,'0')).join(''),privateFaces:[...frame!.contentDocument!.fonts].length,parentEmbeddedFaces:[...document.fonts].filter(face=>face.family.startsWith('CanoliFont_')).length};
  });
}

async function compareOriginalFace(page:Page,info:TestInfo,name:'Regular'|'Bold'){
  const encoded=(await readFile(`tests/fixtures/fonts/${name}.ttf`)).toString('base64');
  const result=await page.evaluate(async({encoded,weight})=>{
    const doc=document.querySelector<HTMLIFrameElement>('iframe[title="Selected font preview"]')!.contentDocument!,actual=doc.querySelector('canvas')!,context=actual.getContext('2d')!;
    const family='CanoliOriginalReference',face=new FontFace(family,Uint8Array.from(atob(encoded),v=>v.charCodeAt(0)),{weight:String(weight)});await face.load();doc.fonts.add(face);
    const reference=doc.createElement('canvas');reference.width=actual.width;reference.height=actual.height;
    try{
      const c=reference.getContext('2d')!;c.setTransform(context.getTransform());c.textBaseline='top';c.fillStyle=context.fillStyle;c.font=`normal ${weight} 36px ${family}`;c.fillText('AAAA',12,28);
      const x=context.getImageData(0,0,actual.width,actual.height).data,y=c.getImageData(0,0,reference.width,reference.height).data;
      let max=0;for(let i=0;i<x.length;i++)max=Math.max(max,Math.abs(x[i]-y[i]));
      return{max,actual:actual.toDataURL('image/png').split(',')[1],visible:document.querySelector<HTMLCanvasElement>('canvas.font-source-preview')!.toDataURL('image/png').split(',')[1],reference:reference.toDataURL('image/png').split(',')[1]};
    }finally{doc.fonts.delete(face);reference.width=reference.height=0;}
  },{encoded,weight:name==='Bold'?700:400});
  await writeFile(info.outputPath(`font-source-${name.toLowerCase()}-actual.png`),Buffer.from(result.actual,'base64'));
  await writeFile(info.outputPath(`font-source-${name.toLowerCase()}-reference.png`),Buffer.from(result.reference,'base64'));
  await writeFile(info.outputPath(`font-source-${name.toLowerCase()}-visible.png`),Buffer.from(result.visible,'base64'));
  expect(result.max).toBe(0);
}

export async function fontSourceWorkflow(page:Page,info:TestInfo,production=false){
  await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(!production);
  await historyScript(page,"document.resize(400,300);document.layers.add(new TextLayer({name:'Unchanged font source target',text:'Canoli source inspection',fontFamily:'serif',fontSize:24,x:20,y:20}));",'Font source target ready');
  const before=await historyProject(page,info,'font-source-before.luma'),beforePng=await historyPng(page,info,'font-source-before.png');
  const token=await page.evaluate(()=>((window as any).fontSourceWorkflowMarker=crypto.randomUUID()));
  const dialog=await openFontManager(page);await dialog.locator('summary').filter({hasText:'Inspect font files'}).click();
  await dialog.getByTestId('font-source-input').setInputFiles('tests/fixtures/fonts/Collection.ttc');
  await expect(dialog.getByText('TTC · 2 faces · Showing 1–2',{exact:true})).toBeVisible();await expect(dialog.getByLabel('Font file face',{exact:true})).toHaveValue('');
  expect(await page.evaluate(()=>(window as any).fontSourceWorkflowMarker)).toBe(token);
  await dialog.getByLabel('Font file face',{exact:true}).selectOption('0');await dialog.getByRole('button',{name:'Preview selected face',exact:true}).click();
  await expect(dialog.getByText('Selected face is ready for preview.',{exact:true})).toBeVisible();await dialog.getByLabel('Font preview sample',{exact:true}).fill('AAAA');
  await expect.poll(()=>previewPixels(page)).not.toBeNull();const regular=await previewPixels(page);expect(regular!.parentEmbeddedFaces).toBe(0);expect(regular!.privateFaces).toBe(1);expect(regular!.advance).toBeCloseTo(86.4,2);await compareOriginalFace(page,info,'Regular');
  await dialog.getByLabel('Font file face',{exact:true}).selectOption('1');await dialog.getByRole('button',{name:'Preview selected face',exact:true}).click();await expect(dialog.getByText('Selected face is ready for preview.',{exact:true})).toBeVisible();
  await expect.poll(()=>previewPixels(page)).not.toBeNull();await expect.poll(async()=>(await previewPixels(page))!.sha256).not.toBe(regular!.sha256);const bold=await previewPixels(page);expect(bold).not.toBeNull();expect(bold!.parentEmbeddedFaces).toBe(0);expect(bold!.advance).toBeCloseTo(100.8,2);await compareOriginalFace(page,info,'Bold');
  await dialog.getByRole('img',{name:'Selected font preview',exact:true}).scrollIntoViewIfNeeded();await expect(dialog.getByRole('img',{name:'Selected font preview',exact:true})).toBeVisible();await page.screenshot({path:info.outputPath('font-source-desktop.png')});
  const light=(await previewPixels(page))!.sha256;await page.evaluate(()=>window.dispatchEvent(new CustomEvent('luma:set-appearance',{detail:'dark'})));await expect.poll(async()=>(await previewPixels(page))?.sha256).not.toBe(light);await page.screenshot({path:info.outputPath('font-source-dark.png')});await compareOriginalFace(page,info,'Bold');await page.evaluate(()=>window.dispatchEvent(new CustomEvent('luma:set-appearance',{detail:'light'})));await expect.poll(async()=>(await previewPixels(page))?.sha256).toBe(light);
  await page.setViewportSize({width:390,height:900});await dialog.getByRole('button',{name:'Done',exact:true}).scrollIntoViewIfNeeded();
  await expect(dialog.getByRole('button',{name:'Done',exact:true})).toBeVisible();
  // The desktop editor shell has an existing 760px minimum. Assert the modal
  // and its scroll body fit independently rather than claiming mobile editing.
  const narrow=await dialog.evaluate(element=>{const box=element.getBoundingClientRect(),body=element.querySelector('.font-manager-body')!;return{left:box.left,right:box.right,viewport:innerWidth,dialogFits:element.scrollWidth<=element.clientWidth,bodyFits:body.scrollWidth<=body.clientWidth};});
  expect(narrow.left).toBeGreaterThanOrEqual(0);expect(narrow.right).toBeLessThanOrEqual(narrow.viewport);expect(narrow.dialogFits).toBe(true);expect(narrow.bodyFits).toBe(true);
  await dialog.getByRole('img',{name:'Selected font preview',exact:true}).scrollIntoViewIfNeeded();await expect.poll(async()=>(await previewPixels(page))?.width).toBeLessThan(bold!.width);expect((await previewPixels(page))!.advance).toBeCloseTo(100.8,2);await compareOriginalFace(page,info,'Bold');
  await page.screenshot({path:info.outputPath('font-source-narrow.png')});await dialog.getByRole('button',{name:'Done',exact:true}).click();
  const after=await historyProject(page,info,'font-source-after.luma');expect(after.value.document).toEqual(before.value.document);expect((await historyPng(page,info,'font-source-after.png')).bytes).toEqual(beforePng.bytes);
  expect(await page.evaluate(()=>[...document.fonts].filter(face=>face.family.startsWith('CanoliFont_')).length)).toBe(0);
  await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();await expect(page.getByRole('button',{name:'Select Unchanged font source target',exact:true})).toHaveCount(0);
  await info.attach('font-source-preview',{body:JSON.stringify({regular,bold,modelUnchanged:true}),contentType:'application/json'});
}
