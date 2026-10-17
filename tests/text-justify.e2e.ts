import {test,expect} from '@playwright/test';

for(const scenario of ['ltr','rtl','signed','spaces','cjk','affine','combining','spaces-normal','repeat'] as const)test(`native inter-word justification keeps whole lines, source and editable SVG: ${scenario}`,async({page},info)=>{
 await page.goto('/');await page.evaluate(()=>document.fonts.ready);
 const result=await page.evaluate(async scenario=>{
  const {editor,TextLayer,LayerGroup,AffineTransform}=window.luma;
  editor.newDocument({width:480,height:300});const doc=editor.document;
  const direction=scenario==='rtl'?'rtl':'ltr',align=scenario==='rtl'||scenario==='affine'?'right':scenario==='signed'?'center':'left',base=scenario==='signed'?-3:0,tracking=scenario==='signed'?-.4:0;
  const first=scenario==='rtl'?'مرحبا بكم هنا':(scenario==='spaces'||scenario==='spaces-normal')?'  alpha\u00a0beta gamma':scenario==='cjk'?'你好':scenario==='combining'?'alpha j́ beta':'alpha beta gamma',second=scenario==='cjk'?'世界':'longer',source=scenario==='cjk'?'你好世界\nend':scenario==='repeat'?first+'\n'+first+' '+second:first+' '+second+'\nend';
  const reference=document.createElement('canvas');reference.width=480;reference.height=300;const c=reference.getContext('2d')!;c.font='normal normal 24px monospace';c.letterSpacing=tracking+'px';c.fontKerning=(scenario==='combining'||scenario==='spaces-normal')?'normal':'auto';c.direction=direction;c.textBaseline='top';c.textAlign=align;c.wordSpacing='8px';
  const indent=12,width=c.measureText(first).width+indent;let parent=doc.layers;
  if(scenario==='affine'){const group=doc.layers.add(new LayerGroup());group.transform=new AffineTransform(.9,.12,-.16,1.03,64.5,36.25);parent=group.layers;}
  const layer=parent.add(new TextLayer({text:source,fontFamily:'monospace',fontSize:24,lineHeight:1.25,color:'#2050a0',wrapWidth:width,paragraphJustify:'inter-word',paragraphSpacing:14,firstLineIndent:indent,wordSpacing:base,letterSpacing:tracking,fontKerning:(scenario==='combining'||scenario==='spaces-normal')?'normal':'auto',align,direction,x:24,y:24}));
  if(scenario==='affine')layer.transform=new AffineTransform(1.05,-.08,.13,.96,10.25,5.75);
  const model=JSON.stringify(doc.toJSON()),revision=doc.getSnapshot().revision;
  if(scenario==='affine')c.setTransform(.9*1.05-.16*-.08,.12*1.05+1.03*-.08,.9*.13-.16*.96,.12*.13+1.03*.96,.9*10.25-.16*5.75+64.5,.12*10.25+1.03*5.75+36.25);else c.translate(24,24);
  c.fillStyle='#2050a0';
  for(const [i,text] of (scenario==='repeat'?[first,first,second]:[first,second,'end']).entries()){
   const firstLine=scenario==='repeat'?i!==2:i!==1,left=direction==='ltr'&&firstLine?indent:0,right=width-(direction==='rtl'&&firstLine?indent:0),x=align==='left'?left:align==='right'?right:(left+right)/2;
   c.wordSpacing=(i===(scenario==='repeat'?1:0)&&scenario!=='cjk'?8:base)+'px';c.fillText(text,x,i*30+(scenario==='repeat'?(i>0?14:0):(i===2?14:0)));
  }
  const expected=c.getImageData(0,0,480,300).data;
  async function pixels(blob:Blob){const b=await createImageBitmap(blob),surface=document.createElement('canvas');surface.width=480;surface.height=300;const context=surface.getContext('2d')!;context.drawImage(b,0,0);b.close();try{return context.getImageData(0,0,480,300).data;}finally{surface.width=surface.height=0;}}
  const actual=await pixels(await editor.exportPng());let cachedMax=0;for(let pass=0;pass<2;pass++){const cached=await editor.renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:true,readback:true});try{const data=cached.getContext('2d')!.getImageData(0,0,480,300).data;for(let i=0;i<data.length;i++)cachedMax=Math.max(cachedMax,Math.abs(data[i]-actual[i]));}finally{cached.width=cached.height=0;}}let alpha=0,premult=0,coverage=0;for(let i=0;i<actual.length;i+=4){alpha=Math.max(alpha,Math.abs(actual[i+3]-expected[i+3]));coverage+=actual[i+3];for(let k=0;k<3;k++)premult=Math.max(premult,Math.abs(actual[i+k]*actual[i+3]/255-expected[i+k]*expected[i+3]/255));}
  const svg=await editor.export({format:'svg'});const image=new Image(),url=URL.createObjectURL(svg.blob);let svgAlpha=0,svgPremult=0,svgArea=0;const bands:{native:{area:number;x:number;y:number};svg:{area:number;x:number;y:number}}[]=[];try{image.src=url;await image.decode();const surface=document.createElement('canvas');surface.width=480;surface.height=300;const context=surface.getContext('2d')!;context.drawImage(image,0,0);const data=context.getImageData(0,0,480,300).data;for(let i=0;i<data.length;i+=4){svgAlpha=Math.max(svgAlpha,Math.abs(data[i+3]-actual[i+3]));svgArea+=Math.abs(data[i+3]-actual[i+3])/(255*480*300);for(let k=0;k<3;k++)svgPremult=Math.max(svgPremult,Math.abs(data[i+k]*data[i+3]/255-actual[i+k]*actual[i+3]/255));}for(let row=0;row<3;row++){const start=24+row*30+(scenario==='repeat'?(row>0?14:0):(row===2?14:0));const band=(values:Uint8ClampedArray)=>{let area=0,xsum=0,ysum=0;for(let y=start;y<Math.min(300,start+30);y++)for(let x=0;x<480;x++){const alpha=values[(y*480+x)*4+3];area+=alpha;xsum+=alpha*x;ysum+=alpha*y;}return{area,x:xsum/area,y:ysum/area};};bands.push({native:band(actual),svg:band(data)});}surface.width=surface.height=0;}finally{URL.revokeObjectURL(url);}const xml=new DOMParser().parseFromString(await svg.blob.text(),'image/svg+xml'),texts=[...xml.querySelectorAll('text')].map(t=>({text:t.textContent,spacing:Number(t.getAttribute('word-spacing'))})),readonly=JSON.stringify(doc.toJSON())===model&&doc.getSnapshot().revision===revision;
  layer.paragraphJustify='none';const changed=await pixels(await editor.exportPng());doc.undo();const undoPixels=await pixels(await editor.exportPng()),undoExact=actual.every((v,i)=>v===undoPixels[i])&&JSON.stringify(doc.toJSON())===model;
  const project=await editor.saveProject();await editor.openProject(new File([project],'justify.luma'));const reopen=await pixels(await editor.exportPng());
  const host=document.createElement('div');host.style.cssText='position:fixed;visibility:hidden;pointer-events:none';host.setAttribute('inert','');host.innerHTML=await svg.blob.text();document.body.append(host);const advances=[...host.querySelectorAll('text')].map(t=>{c.wordSpacing=t.getAttribute('word-spacing')+'px';return{native:c.measureText(t.textContent!).width,svg:t.getComputedTextLength(),x:t.getAttribute('x'),y:t.getAttribute('y')};});host.remove();
  reference.width=reference.height=0;return{scenario,alpha,premult,cachedMax,svgAlpha,svgPremult,svgArea,bands,advances,coverage,texts,width,height:layer.height,readonly,sourceExact:JSON.stringify(editor.document.toJSON())===model,projectPixels:actual.every((v,i)=>v===reopen[i]),undoExact,changed:changed.some((v,i)=>v!==actual[i]),report:svg.report};
 },scenario);
 await info.attach('inter-word-reference',{body:JSON.stringify(result),contentType:'application/json'});
 expect(result.cachedMax).toBe(0);expect(result.alpha).toBe(0);expect(result.premult).toBe(0);expect(result.coverage).toBeGreaterThan(10000);expect(result.height).toBe(104);expect(result.readonly).toBe(true);expect(result.sourceExact).toBe(true);expect(result.projectPixels).toBe(true);expect(result.undoExact).toBe(true);
 if(!['affine','rtl','signed'].includes(scenario)){expect(result.svgAlpha).toBe(0);expect(result.svgPremult).toBe(0);}
 if(['rtl','signed'].includes(scenario)){expect(result.svgArea).toBeLessThan(.0003);for(const b of result.bands){expect(Math.abs(b.native.x-b.svg.x)).toBeLessThan(.25);expect(Math.abs(b.native.y-b.svg.y)).toBeLessThan(.01);}}
 if(scenario==='affine')expect(result.svgArea).toBeLessThan(.001);
 if(scenario==='spaces'||scenario==='spaces-normal'){expect(result.report.warnings.join(' ')).toContain('whitespace boundaries');expect(result.svgArea).toBe(0);for(const band of result.bands)expect(band.svg).toEqual(band.native);}
 expect(result.texts).toHaveLength(3);expect(result.texts[scenario==='repeat'?1:0].spacing).toBeCloseTo(scenario==='cjk'?0:8,3);expect(result.texts[scenario==='repeat'?0:1].spacing).toBe(scenario==='signed'?-3:0);expect(result.changed).toBe(scenario!=='cjk');
});

test('justification inspector and isolated scripting share one undo, rollback and reset',async({page},info)=>{
 await page.goto('/');await page.evaluate(()=>{const {editor,TextLayer}=window.luma;editor.newDocument({width:400,height:240});editor.document.selectedLayer=editor.document.layers.add(new TextLayer({name:'Paragraph',text:'alpha beta gamma delta epsilon',wrapWidth:150,fontSize:24,x:10,y:10}));});
 const before=await page.evaluate(()=>({model:JSON.stringify(window.luma.editor.document.toJSON()),past:window.luma.editor.document.getSnapshot().past.length}));
 await page.getByLabel('Justification',{exact:true}).selectOption('inter-word');expect(await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length)).toBe(before.past+1);await page.keyboard.press('Control+z');await expect(page.getByLabel('Justification',{exact:true})).toHaveValue('none');expect(await page.evaluate(()=>JSON.stringify(window.luma.editor.document.toJSON()))).toBe(before.model);
 const guide=await(await import('node:fs/promises')).readFile('docs/SCRIPTING_API.md','utf8'),source=guide.match(/<!-- example: justified-paragraph -->\s*```js\n([\s\S]*?)```/)?.[1];if(!source)throw new Error('Missing justification guide');
 const scripted=await page.evaluate(async source=>{const {editor}=window.luma;const before=JSON.stringify(editor.document.toJSON()),past=editor.document.getSnapshot().past.length;const result=await editor.runScript(source);const model=JSON.stringify(editor.document.toJSON()),history=editor.document.getSnapshot().past.length-past;let failure='';try{await editor.runScript('document.name="Must roll back";document.selectedLayer.paragraphJustify="all";');}catch(error){failure=String(error);}const unchanged=JSON.stringify(editor.document.toJSON())===model;editor.document.undo();return{result,failure,unchanged,history,undoExact:JSON.stringify(editor.document.toJSON())===before};},source);
 expect(scripted.result.join(' ')).toContain('Justification ready inter-word');expect(scripted.failure).toContain('justification');expect(scripted.unchanged).toBe(true);expect(scripted.history).toBe(1);expect(scripted.undoExact).toBe(true);
 await page.getByRole('button',{name:'Select Paragraph',exact:true}).click();await page.getByLabel('Justification',{exact:true}).selectOption('inter-word');await page.getByRole('button',{name:'Reset paragraph',exact:true}).click();await expect(page.getByLabel('Justification',{exact:true})).toHaveValue('none');await expect(page.getByLabel('Text layout',{exact:true})).toHaveValue('point');
 await info.attach('justification-script-ui',{body:JSON.stringify(scripted),contentType:'application/json'});
});

test('justification preserves masked affine shadow pixels across caches, regions and undo',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {Document,TextLayer,LayerGroup,LayerStyle,LayerMask,MarqueeSelection,AffineTransform,editor}=window.luma;
    const {CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')) as typeof import('../src/engine/renderer');
    const renderer=new CanvasRenderer(),doc=new Document({width:640,height:420});
    const group=doc.layers.add(new LayerGroup({opacity:.71}));group.transform=new AffineTransform(.9,.17,-.12,1.1,260.25,70.75);
    const layer=group.layers.add(new TextLayer({text:'  fj Ág j\u0301 alpha beta gamma\nمرحبا שלום 🙂',fontSize:27,fontFamily:'serif',fontStyle:'italic',wrapWidth:180,fontKerning:'normal',paragraphJustify:'inter-word',paragraphSpacing:12,firstLineIndent:-8,wordSpacing:-.6,letterSpacing:-.4,opacity:.63,color:'#e7814b'}));
    layer.transform=new AffineTransform(-.91,.22,.15,1.07,40.3,-.4);
    layer.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#3355e0',opacity:.4},dropShadow:{enabled:true,color:'#443366',opacity:.65,blur:7.7,x:-29.25,y:17.75}});
    layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:-50,y:-10,width:240,height:300}),feather:3,density:.7});
    const original=JSON.stringify(doc.toJSON()),reports=[];let initial:Uint8ClampedArray|undefined;
    try{
      for(const stage of ['initial','changed','repeat','undo'] as const){
        if(stage==='changed')doc.transaction('Justification',()=>{layer.paragraphJustify='none';});
        if(stage==='undo')doc.undo();
        for(const region of [false,true]){
          const options=region?{region:{x:123.25,y:30.75,width:380,height:280},outputSize:{width:475,height:224}}:{};
          const read=async(cache:boolean)=>{const canvas=await renderer.render(doc.getSnapshot().document,editor.assetStore,{...options,cache});try{return canvas.getContext('2d')!.getImageData(0,0,canvas.width,canvas.height).data;}finally{canvas.width=canvas.height=0;}};
          const fresh=await read(false);if(stage==='initial'&&!region)initial=new Uint8ClampedArray(fresh);
          for(const phase of ['cold','warm']){const actual=await read(true);let max=0,coverage=0;for(let i=0;i<actual.length;i++){max=Math.max(max,Math.abs(actual[i]-fresh[i]));if(i%4===3)coverage+=actual[i];}reports.push({stage,region,phase,max,coverage,initialExact:region?null:actual.every((v,i)=>v===initial![i])});}
        }
      }
      return{reports,exactModel:JSON.stringify(doc.toJSON())===original};
    }finally{renderer.dispose();}
  });
  expect(result.exactModel).toBe(true);expect(result.reports).toHaveLength(16);
  for(const r of result.reports){expect(r.max,JSON.stringify(r)).toBe(0);expect(r.coverage).toBeGreaterThan(10000);if(r.stage==='undo'&&!r.region)expect(r.initialExact).toBe(true);if(r.stage==='changed'&&!r.region)expect(r.initialExact).toBe(false);}
  await info.attach('justification-cache-mask',{body:JSON.stringify(result),contentType:'application/json'});
});


test('unsupported native word spacing disables justification and reset recovers the document',async({page})=>{
 await page.goto('/');await page.evaluate(()=>{const{editor,TextLayer}=window.luma;editor.newDocument({width:400,height:240});editor.document.selectedLayer=editor.document.layers.add(new TextLayer({text:'one two three four',wrapWidth:120,paragraphJustify:'inter-word'}));});
 await page.evaluate(()=>{for(const proto of [CanvasRenderingContext2D.prototype,OffscreenCanvasRenderingContext2D.prototype]){if(!delete (proto as unknown as Record<string,unknown>).wordSpacing)throw new Error('Cannot emulate missing word spacing');}window.luma.editor.document.name='Unsupported native spacing';});
 await expect(page.getByLabel('Justification',{exact:true})).toBeDisabled();await page.getByRole('button',{name:'Reset paragraph',exact:true}).click();await expect(page.getByLabel('Text layout',{exact:true})).toHaveValue('point');
 expect(await page.evaluate(()=>{const layer=window.luma.editor.document.selectedLayer;if(!(layer instanceof window.luma.TextLayer))throw new Error('Expected text');return{mode:layer.paragraphJustify,width:layer.wrapWidth};})).toEqual({mode:'none',width:undefined});
 const rejected=await page.evaluate(()=>{const{TextLayer}=window.luma;try{new TextLayer({text:'one two',wrapWidth:90,paragraphJustify:'inter-word'});return false;}catch(error){return String(error).includes('native paragraph justification');}});expect(rejected).toBe(true);
});

test('ignored native complex-text spacing rejects atomically and Normal kerning recovers without rewriting source',async({page},info)=>{
 await page.goto('/');const result=await page.evaluate(async()=>{
  const{Document,TextLayer,editor}=window.luma,doc=new Document({width:400,height:240}),layer=doc.layers.add(new TextLayer({text:'  fj Ág j́ alpha beta gamma',fontFamily:'serif',fontStyle:'italic',fontSize:27,letterSpacing:-.4,wrapWidth:180})),source=layer.text,failures=[];
  for(const kerning of ['auto','none'] as const){layer.fontKerning=kerning;const before=JSON.stringify(doc.toJSON()),past=doc.getSnapshot().past.length;let message='';try{layer.paragraphJustify='inter-word';}catch(error){message=String(error);}failures.push({kerning,message,unchanged:JSON.stringify(doc.toJSON())===before,history:doc.getSnapshot().past.length===past});}
  const past=doc.getSnapshot().past.length;doc.transaction('Enable native justification',()=>{layer.fontKerning='normal';layer.paragraphJustify='inter-word';});const model=JSON.stringify(doc.toJSON());let failedNone='';try{layer.fontKerning='none';}catch(error){failedNone=String(error);}
  const c=await editor.renderer.render(doc.getSnapshot().document,editor.assetStore,{cache:false,readback:true}),coverage=c.getContext('2d')!.getImageData(0,0,400,240).data.some((v,i)=>i%4===3&&v>0);c.width=c.height=0;
  return{failures,recovered:layer.fontKerning==='normal'&&layer.paragraphJustify==='inter-word',oneEntry:doc.getSnapshot().past.length===past+1,sourceExact:layer.text===source,failedNone,unchanged:JSON.stringify(doc.toJSON())===model,coverage};
 });for(const r of result.failures){expect(r.message).toContain('Choose Kerning Normal');expect(r.unchanged).toBe(true);expect(r.history).toBe(true);}expect(result.failedNone).toContain('Choose Kerning Normal');expect(result.recovered).toBe(true);expect(result.oneEntry).toBe(true);expect(result.sourceExact).toBe(true);expect(result.unchanged).toBe(true);expect(result.coverage).toBe(true);
 await info.attach('native-spacing-capability',{body:JSON.stringify(result),contentType:'application/json'});
});
