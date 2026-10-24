import {test,expect} from '@playwright/test';
import {readFile} from 'node:fs/promises';
import {fontFilesWorkflow} from './helpers/font-files';

test('explicit font embedding survives native saving, reopening, isolated measurement and human history',async({page},info)=>fontFilesWorkflow(page,info));

test('font sources have independent native leases and workspace worker encoding matches direct bytes',async({page})=>{
  const encoded=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async encoded=>{
    const{AssetStore}=await import(/* @vite-ignore */ String('/src/core/assets.ts')),{serializeProject,readProject}=await import(/* @vite-ignore */ String('/src/core/project.ts')),{ProjectEncoder}=await import(/* @vite-ignore */ String('/src/workspace/project-encoder.ts'));
    const{Document,TextLayer,FontFile}=window.luma,a=new AssetStore(),b=new AssetStore(),one=new Document({assets:a}),two=new Document({assets:b});
    const source=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),file=await one.fonts.embed(source),text=one.layers.add(new TextLayer({text:'AAAA',fontFamily:file.family,fontSize:40}));
    const width=text.width,original=new FontFace('IndependentFontReference',await source.arrayBuffer());await original.load();document.fonts.add(original);
    const canvas=document.createElement('canvas'),context=canvas.getContext('2d')!;context.font='40px IndependentFontReference';const expected=context.measureText('AAAA').width;document.fonts.delete(original);
    a.fonts.shareTo(b.fonts,file.id);two.fonts.files.add(new FontFile(file.toJSON()));two.layers.add(new TextLayer({text:'AAAA',fontFamily:file.family,fontSize:40}));
    const state=two.getSnapshot(),history={version:1 as const,past:state.past,future:state.future},encoder=new ProjectEncoder(),direct=await serializeProject(state.document,b,history),pending=encoder.encode(state.document,b,history);
    a.dispose();const afterFirstClose=[...document.fonts].filter(face=>face.family===file.family).length;context.font=`40px ${file.family}`;const retainedAdvance=context.measureText('AAAA').width;b.dispose();const worker=await pending;encoder.dispose();
    const digest=async(blob:Blob)=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))].join(',');
    return{width,expected,afterFirstClose,retainedAdvance,workerFonts:(await readProject(worker)).fonts.length,same:await digest(worker)===await digest(direct),remaining:[...document.fonts].filter(face=>face.family===file.family).length};
  },encoded);
  // Authored model bounds round native floating-point advances to 0.001px.
  expect(Math.abs(result.width-result.expected)).toBeLessThan(.001);expect(result.afterFirstClose).toBe(1);expect(result.retainedAdvance).toBeCloseTo(result.expected,4);expect(result.workerFonts).toBe(1);expect(result.same).toBe(true);expect(result.remaining).toBe(0);
});

test('standalone SVG carries whole selected native font bytes with usable browser metrics',async({page})=>{
  const inputs={encoded:(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64'),unused:(await readFile('tests/fixtures/fonts/Bold.ttf')).toString('base64')};await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async({encoded,unused})=>{
    const{editor,TextLayer,Document}=window.luma,font=await editor.document.fonts.embed(new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))])),hidden=await editor.document.fonts.embed(new Blob([Uint8Array.from(atob(unused),v=>v.charCodeAt(0))]));editor.document.resize(300,120);
    editor.document.layers.add(new TextLayer({text:'Hidden',fontFamily:hidden.family,visible:false}));const master=new Document({width:100,height:100});master.layers.add(new TextLayer({text:'Unused master',fontFamily:hidden.family}));editor.document.defineComponent(master,{name:'Unused font master'});
    const text=editor.document.layers.add(new TextLayer({text:'AAAA',fontFamily:font.family,fontSize:40,x:20,y:20})),expected=text.width,output=await editor.export({format:'svg'}),xml=await output.blob.text();
    const frame=document.createElement('iframe');frame.srcdoc=xml;const ready=new Promise<void>(resolve=>frame.onload=()=>resolve());document.body.append(frame);await ready;
    try{const doc=frame.contentDocument!;await doc.fonts.load(`40px ${font.family}`,'AAAA');await doc.fonts.ready;return{embedded:xml.includes('data:font/ttf;base64,'),unusedExcluded:!xml.includes(hidden.family),faces:[...doc.fonts].length,loaded:[...doc.fonts].every(value=>value.status==='loaded'),advance:(doc.querySelector('text')as SVGTextElement).getComputedTextLength(),expected,preserved:output.report.featuresPreserved};}
    finally{frame.remove();}
  },inputs);
  expect(result.embedded).toBe(true);expect(result.unusedExcluded).toBe(true);expect(result.faces).toBe(1);expect(result.loaded).toBe(true);expect(result.advance).toBeCloseTo(result.expected,2);expect(result.preserved).toContain('Complete selected embedded font faces as inline SVG font resources');
});

test('embedding an already requested fixed-width face invalidates cached glyph pixels',async({page})=>{
  const encoded=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async encoded=>{
    const{editor,TextLayer}=window.luma,source=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),report=await editor.inspectFont(source),family=report.faces[0].cssFamily;
    editor.document.resize(300,120);const text=editor.document.layers.add(new TextLayer({text:'AAAA',fontFamily:family,fontSize:40,wrapWidth:200,x:20,y:20})),before=text.toJSON();
    const hash=async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await editor.exportPng()).arrayBuffer()))].join(',');
    const fallback=await hash();await hash();await editor.document.fonts.embed(source);const embedded=await hash(),after=text.toJSON();
    const reference=new FontFace('IndependentCachedReference',await source.arrayBuffer());await reference.load();document.fonts.add(reference);
    try{text.fontFamily='IndependentCachedReference';return{fallback,embedded,reference:await hash(),sameModel:JSON.stringify(before)===JSON.stringify(after)};}finally{document.fonts.delete(reference);}
  },encoded);
  expect(result.sameModel).toBe(true);expect(result.embedded).not.toBe(result.fallback);expect(result.embedded).toBe(result.reference);
});

test('copied text and library artwork keep native fonts after the source tab closes',async({page})=>{
  const encoded=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async encoded=>{
    const{editor,TextLayer}=window.luma,source=editor.document,font=await source.fonts.embed(new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]));source.resize(300,120);
    const text=source.layers.add(new TextLayer({name:'Copied native font',text:'AAAA',fontFamily:font.family,fontSize:40,x:20,y:20}));source.selectedLayer=text;
    const digest=async()=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await(await editor.exportPng()).arrayBuffer()))].join(',');
    const expected=await digest(),saved=await editor.saveArtworkToLibrary({name:'Embedded font artwork',description:'',tags:[]}),target=editor.newDocument({name:'Font destination',width:300,height:120});editor.activateDocument(source);await editor.copySelectedLayersTo(target);editor.activateDocument(target);
    const copied=await digest();await editor.closeDocument(source,{discardChanges:true});const afterClose=await digest(),family=font.family;
    const library=editor.newDocument({name:'Library font destination',width:300,height:120});await editor.placeLibraryArtwork(saved.entry.id);const placed=await digest();await editor.closeDocument(target,{discardChanges:true});
    return{expected,copied,afterClose,placed,files:library.fonts.files.items.map(value=>value.name),native:[...document.fonts].filter(value=>value.family===family).length};
  },encoded);
  expect(result.copied).toBe(result.expected);expect(result.afterClose).toBe(result.expected);expect(result.placed).toBe(result.expected);expect(result.files).toEqual(['Canoli Source Regular']);expect(result.native).toBe(1);
});

test('native export rejects lost owned font bytes even while another document retains the native face',async({page})=>{
  const encoded=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const result=await page.evaluate(async encoded=>{
    const{AssetStore}=await import(/* @vite-ignore */ String('/src/core/assets.ts')),{editor,TextLayer}=window.luma,font=await editor.document.fonts.embed(new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))])),other=new AssetStore();
    editor.document.layers.add(new TextLayer({text:'AAAA',fontFamily:font.family,fontSize:40}));editor.assetStore.fonts.shareTo(other.fonts,font.id);other.fonts.activate(font.id);
    const errors:string[]=[];
    for(const format of ['png','jpeg','webp','svg']as const)for(const phase of ['rendering','encoding']){
      if(!editor.assetStore.fonts.has(font.id)){other.fonts.shareTo(editor.assetStore.fonts,font.id);editor.assetStore.fonts.activate(font.id);}
      try{await editor.export({format},{onProgress(progress){if(progress.phase===phase)editor.assetStore.fonts.remove(font.id);}});errors.push('unexpected success');}catch(cause){errors.push(String(cause));}
    }
    const native=[...document.fonts].filter(value=>value.family===font.family).length;other.dispose();return{errors,native};
  },encoded);
  expect(result.native).toBe(1);expect(result.errors).toHaveLength(8);expect(result.errors.every(error=>error.includes('owned font source changed'))).toBe(true);
});

test('owned activation refreshes unchanged font requests and friendly typography labels',async({page})=>{
  const encoded=(await readFile('tests/fixtures/fonts/Regular.ttf')).toString('base64');await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(async encoded=>{
    const{editor,TextLayer}=window.luma,source=new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]),report=await editor.inspectFont(source);
    editor.document.selectedLayer=editor.document.layers.add(new TextLayer({text:'AAAA',fontFamily:report.faces[0].cssFamily,fontSize:40}));
  },encoded);
  await expect(page.locator('.font-fallback-warning')).toBeVisible();
  await page.evaluate(async encoded=>{await window.luma.editor.document.fonts.embed(new Blob([Uint8Array.from(atob(encoded),v=>v.charCodeAt(0))]));},encoded);
  await expect(page.locator('.font-fallback-warning')).toHaveCount(0);await expect(page.getByLabel('Font',{exact:true})).toHaveValue(await page.evaluate(()=>window.luma.editor.document.fonts.files.items[0].family));
  await expect(page.getByText('Embedded font: Canoli Source Regular',{exact:true})).toBeVisible();await expect(page.getByLabel('Font family',{exact:true})).toHaveCount(0);
});
