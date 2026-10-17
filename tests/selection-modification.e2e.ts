import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

test.beforeEach(async ({page}) => {
  await page.goto('/');
  await page.evaluate(() => {
    const {editor,MarqueeSelection,PaintLayer,PaintFill}=window.luma;
    editor.newDocument({width:64,height:64});
    const layer=editor.document.layers.add(new PaintLayer({name:'Artwork'}));
    layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:64},color:'#ff0000'}));
    layer.locked=true;
    editor.document.selection=new MarqueeSelection({shape:'rectangle',x:20,y:20,width:20,height:20});
  });
});

test('selection controls work over locked artwork and one commit survives undo and project reopening',async({page})=>{
  const before=await page.evaluate(()=>window.luma.editor.document.getSnapshot().revision);
  await page.getByRole('button',{name:'Modify selection…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Modify selection',exact:true});
  await dialog.getByRole('spinbutton',{name:'Radius',exact:true}).fill('2');
  await dialog.getByRole('button',{name:'Apply selection',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  const result=await page.evaluate(async()=>{
    const editor=window.luma.editor,doc=editor.document,selection=doc.selection!.toJSON();
    const {coverageAt}=await import(/* @vite-ignore */String('/src/core/pixel-selection.ts'));
    const r=selection.regions[0],alpha=(x:number,y:number)=>coverageAt(r.coverage!,x-r.x,y-r.y);
    const revision=doc.getSnapshot().revision;
    doc.undo(); const undone=doc.selection!.toJSON();doc.redo();
    const blob=await editor.saveProject();await editor.openProject(new File([blob],'modified.luma'));
    return{revision,alpha:[alpha(18,25),alpha(18,18),alpha(20,20)],undone,reopened:editor.document.selection!.toJSON(),selection,locked:editor.document.layers.at(0)!.locked};
  });
  expect(result.revision).toBe(before+1);
  expect(result.alpha).toEqual([255,0,255]);
  expect(result.undone.regions[0].shape).toBe('rectangle');
  expect(result.reopened).toEqual(result.selection);
  expect(result.locked).toBe(true);
});

test('command search exposes contraction and feathering, and cancel does not edit',async({page})=>{
  const before=await page.evaluate(()=>window.luma.editor.document.toJSON());
  await page.getByRole('button',{name:'Modify selection…',exact:true}).click();
  await page.getByRole('dialog').getByRole('button',{name:'Cancel',exact:true}).click();
  expect(await page.evaluate(()=>window.luma.editor.document.toJSON())).toEqual(before);
  await page.getByLabel('Editing canvas',{exact:true}).focus();await page.keyboard.press('Control+k');
  await page.getByRole('combobox',{name:'Search commands',exact:true}).fill('Contract selection');
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog',{name:'Modify selection',exact:true})).toBeVisible();
  await expect(page.getByRole('combobox',{name:'Selection modification',exact:true})).toHaveValue('contract');
  await page.getByRole('button',{name:'Apply selection',exact:true}).click();
  await expect(page.getByRole('dialog',{name:'Modify selection',exact:true})).toHaveCount(0);
  await page.evaluate(async()=>{await window.luma.editor.document.modifySelection({operation:'feather',radius:3});});
  const output=await page.evaluate(async()=>{
    const {coverageAt}=await import(/* @vite-ignore */String('/src/core/pixel-selection.ts'));
    const r=window.luma.editor.document.selection!.toJSON().regions[0];
    return coverageAt(r.coverage!,25-r.x,25-r.y);
  });
  expect(output).toBeGreaterThan(0);expect(output).toBeLessThan(255);
});

test('native 50 MP coverage remains tiled and reports progress while editing stays available',async({page})=>{
  const result=await page.evaluate(async()=>{
    const e=window.luma.editor;e.newDocument({width:10000,height:5000});e.document.selectAll();
    const start=performance.now(),progress:{completed:number;total:number}[]=[];
    const pending=e.document.modifySelection({operation:'contract',radius:1},{onProgress:p=>progress.push(p)});
    await new Promise(resolve=>setTimeout(resolve,0));
    const responded=performance.now()-start;
    await pending;
    const {coverageAt}=await import(/* @vite-ignore */String('/src/core/pixel-selection.ts'));
    const r=e.document.selection!.toJSON().regions[0];
    return{elapsed:performance.now()-start,responded,progress,dimensions:[r.coverage!.width,r.coverage!.height],alpha:[coverageAt(r.coverage!,0,0),coverageAt(r.coverage!,9998,4998)],runs:r.coverage!.runs.length};
  });
  expect(result.dimensions).toEqual([10000,5000]);expect(result.alpha).toEqual([0,255]);
  expect(result.progress[0]).toEqual({completed:0,total:200});expect(result.progress.at(-1)).toEqual({completed:200,total:200});
  expect(result.responded).toBeLessThan(result.elapsed);
  expect(result.runs).toBeLessThan(50000);
  console.log('50 MP contract selection',JSON.stringify({elapsed:result.elapsed,response:result.responded}));
});

test('abort and concurrent document edits reject private worker output without applying it',async({page})=>{
  const result=await page.evaluate(async()=>{
    const e=window.luma.editor;e.newDocument({width:3000,height:2000});e.document.selectAll();
    const source=e.document.selection!.toJSON(),revision=e.document.getSnapshot().revision;
    const controller=new AbortController();
    let cancelled='';
    try{await e.document.modifySelection({operation:'expand',radius:128},{signal:controller.signal,onProgress:p=>{if(p.completed===0)controller.abort();}});}catch(error){cancelled=String(error);}
    const unchanged=e.document.getSnapshot().revision===revision;
    let stale='';
    try{await e.document.modifySelection({operation:'expand',radius:3},{onProgress:p=>{if(p.completed===0)e.document.name='Changed';}});}catch(error){stale=String(error);}
    return{cancelled,stale,unchanged,selection:e.document.selection!.toJSON(),source};
  });
  expect(result.cancelled).toMatch(/abort/i);expect(result.unchanged).toBe(true);
  expect(result.stale).toMatch(/changed/i);expect(result.selection).toEqual(result.source);
});

test('documented async selection example runs in the sandbox and plugins require write permission',async({page})=>{
  const guide=await readFile('docs/SCRIPTING_API.md','utf8');
  const example=guide.match(/```js\n\/\/ example: modify-selection\n([\s\S]*?)```/)![1];
  await page.evaluate(()=>{window.luma.editor.document.layers.at(0)!.locked=false;});
  await page.getByRole('button',{name:'Scripts (Mod+Shift+K)',exact:true}).click();
  await page.getByLabel('Script code',{exact:true}).fill(example);
  await page.getByRole('button',{name:'Run script',exact:true}).click();
  await expect(page.getByLabel('Script output')).toContainText('Modified selection 1');
  await page.getByRole('button',{name:'Close scripts',exact:true}).click();
  const result=await page.evaluate(async()=>{
    const e=window.luma.editor;
    const plugin={format:'luma-plugin',apiVersion:1,id:'test.selection-modify',name:'Selection modifier',version:'1.0.0',permissions:['document:read','document:write'],commands:[{id:'run',title:'Modify',source:'await document.modifySelection({operation:"expand",radius:2});'}]};
    e.plugins.install(plugin);e.plugins.revokePermission(plugin.id,'document:write');
    const before=e.document.toJSON();let error='';
    try{await e.runPlugin(plugin.id,'run');}catch(value){error=String(value);}
    const unchanged=JSON.stringify(before)===JSON.stringify(e.document.toJSON());
    e.plugins.grantPermission(plugin.id,'document:write');await e.runPlugin(plugin.id,'run');
    const after=e.document.selection!.toJSON();e.document.undo();
    return{error,unchanged,after,restored:e.document.toJSON(),before};
  });
  expect(result.error).toMatch(/permission/i);expect(result.unchanged).toBe(true);
  expect(result.after.regions[0].shape).toBe('pixels');expect(result.restored).toEqual(result.before);
});

test('Cancel in the progress dialog terminates the live pixel worker and preserves history',async({page})=>{
  await page.evaluate(()=>{
    const e=window.luma.editor;e.newDocument({width:3000,height:2000});e.document.selectAll();
    const NativeWorker=window.Worker;
    (window as any).selectionWork={started:0,terminated:0};
    window.Worker=class extends NativeWorker {
      private tracked:boolean;
      constructor(url:string|URL,options?:WorkerOptions){
        super(url,options);this.tracked=String(url).includes('pixels.worker');
        if(this.tracked)this.addEventListener('message',event=>{if(event.data.type==='progress')(window as any).selectionWork.started++;});
      }
      terminate(){if(this.tracked)(window as any).selectionWork.terminated++;super.terminate();}
    };
  });
  const before=await page.evaluate(()=>({document:window.luma.editor.document.toJSON(),revision:window.luma.editor.document.getSnapshot().revision}));
  await page.getByRole('button',{name:'Modify selection…',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Modify selection',exact:true});
  await dialog.getByRole('spinbutton',{name:'Radius',exact:true}).fill('128');
  await dialog.getByRole('button',{name:'Apply selection',exact:true}).click();
  await expect.poll(()=>page.evaluate(()=>(window as any).selectionWork.started)).toBeGreaterThan(0);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  await expect(dialog).toHaveCount(0);
  await expect.poll(()=>page.evaluate(()=>(window as any).selectionWork.terminated)).toBe(1);
  expect(await page.evaluate(()=>({document:window.luma.editor.document.toJSON(),revision:window.luma.editor.document.getSnapshot().revision}))).toEqual(before);
});

test('feathered coverage exports real fractional mask alpha without altering source artwork',async({page})=>{
  const result=await page.evaluate(async()=>{
    const e=window.luma.editor,doc=e.document,layer=doc.layers.at(0)!;
    const before=layer.toJSON();
    await doc.modifySelection({operation:'feather',radius:3});
    const sourceAfter=layer.toJSON();
    layer.locked=false;layer.maskFromSelection(doc.selection!);
    const blob=await e.exportPng(),image=await createImageBitmap(blob);
    const c=document.createElement('canvas');c.width=c.height=64;
    const ctx=c.getContext('2d')!;ctx.drawImage(image,0,0);image.close();
    const p=ctx.getImageData(0,0,64,64).data;
    return{before,sourceAfter,alpha:[p[(30*64+30)*4+3],p[(20*64+20)*4+3],p[(5*64+5)*4+3]]};
  });
  expect(result.sourceAfter).toEqual(result.before);
  expect(result.alpha[0]).toBe(255);expect(result.alpha[2]).toBe(0);
  expect(result.alpha[1]).toBeGreaterThan(0);expect(result.alpha[1]).toBeLessThan(255);
});

for(const action of ['revoke','remove'] as const) test(`plugin ${action} during live selection preparation discards all staged edits`,async({page})=>{
  const result=await page.evaluate(async action=>{
    const e=window.luma.editor;e.newDocument({width:1800,height:1200});e.document.selectAll();
    const plugin={format:'luma-plugin',apiVersion:1,id:'test.selection-race',name:'Selection race',version:'1.0.0',permissions:['document:read','document:write'],commands:[{id:'run',title:'Modify',source:'document.name="Private staged name";await document.modifySelection({operation:"expand",radius:64});'}]};
    e.plugins.install(plugin);
    const before=e.document.toJSON(),NativeWorker=window.Worker;
    let started=false;
    window.Worker=class extends NativeWorker {
      constructor(url:string|URL,options?:WorkerOptions){
        super(url,options);
        if(String(url).includes('pixels.worker'))this.addEventListener('message',event=>{
          if(event.data.type==='progress'&&!started){started=true;if(action==='revoke')e.plugins.revokePermission(plugin.id,'document:write');else e.plugins.remove(plugin.id);}
        });
      }
    };
    let error='';
    try{await e.runPlugin(plugin.id,'run');}catch(value){error=String(value);}finally{window.Worker=NativeWorker;}
    return{started,error,before,after:e.document.toJSON()};
  },action);
  expect(result.started).toBe(true);expect(result.error).toMatch(/permission|not installed/i);
  expect(result.after).toEqual(result.before);
});
