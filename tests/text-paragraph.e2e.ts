import {test, expect} from '@playwright/test';

for (const scenario of ['latin','rtl','cjk','emoji','hyphen','spaces','affine'] as const) test(`paragraph native pixels, editable SVG lines and project source: ${scenario}`, async ({page}, info) => {
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready);
  const result = await page.evaluate(async scenario => {
    const {editor, TextLayer, LayerGroup, AffineTransform} = window.luma;
    const fixtures = {
      latin: {source:'alpha beta gamma delta\none two three', lines:['alpha beta','gamma delta','one two','three'], starts:[0,2], ends:[1], direction:'ltr', align:'left', indent:12},
      rtl: {source:'سلام عالم جميل\nمرحبا بك', lines:['سلام عالم','جميل','مرحبا بك'], starts:[0,2], ends:[1], direction:'rtl', align:'right', indent:0},
      cjk: {source:'你好，世界。', lines:['你好，','世界。'], starts:[0], ends:[], direction:'ltr', align:'center', indent:0},
      emoji: {source:'👩‍👩‍👧‍👦 cafe\u0301 e\u0301clair', lines:['👩‍👩‍👧‍👦 cafe\u0301','e\u0301clair'], starts:[0], ends:[], direction:'ltr', align:'left', indent:0},
      hyphen: {source:'co\u00adoperate', lines:['co-','operate'], starts:[0], ends:[], direction:'ltr', align:'left', indent:0},
      spaces: {source:'  alpha beta gamma  \n  end  ', lines:['  alpha beta','gamma  ','  end  '], starts:[0,2], ends:[1], direction:'ltr', align:'center', indent:0},
      affine: {source:'alpha beta gamma delta\none two three', lines:['alpha beta','gamma delta','one two','three'], starts:[0,2], ends:[1], direction:'ltr', align:'left', indent:12},
    };
    const f=fixtures[scenario], direction=f.direction as 'ltr'|'rtl', align=f.align as 'left'|'center'|'right', paragraphEnds:readonly number[]=f.ends;
    editor.newDocument({width:480,height:320});
    const reference=document.createElement('canvas');reference.width=480;reference.height=320;
    const context=reference.getContext('2d')!;
    context.font=`${scenario==='affine'?'italic':'normal'} normal 20px monospace`;
    context.direction=direction;context.letterSpacing='.5px';context.wordSpacing='3px';context.fontKerning='normal';
    const wrapWidth=(scenario==='hyphen'?context.measureText('co-').width:Math.max(...f.lines.map(line=>context.measureText(line).width)))+.25;
    const group=editor.document.layers.add(new LayerGroup());
    group.transform=scenario==='affine'?new AffineTransform(1,.12,.18,1,20,20):new AffineTransform(1,0,0,1,20,20);
    const layer=group.layers.add(new TextLayer({name:'Paragraph',text:f.source,fontSize:20,fontFamily:'monospace',fontStyle:scenario==='affine'?'italic':'normal',color:'#2050a0',lineHeight:1.3,letterSpacing:.5,wordSpacing:3,fontKerning:'normal',direction,align,wrapWidth,paragraphSpacing:9,firstLineIndent:f.indent,x:10,y:12}));
    editor.document.selectedLayer=layer;
    context.transform(1,scenario==='affine'?.12:0,scenario==='affine'?.18:0,1,20,20);context.translate(10,12);
    context.fillStyle='#2050a0';context.textAlign=align;context.textBaseline='top';
    const positions:{x:number;y:number;baseline:number}[]=[];
    let y=0;
    for(let i=0;i<f.lines.length;i++){
      const indent=f.starts.includes(i)?f.indent:0,left=direction==='rtl'?0:indent,right=direction==='rtl'?wrapWidth-indent:wrapWidth;
      const x=align==='center'?(left+right)/2:align==='right'?right:left;
      context.fillText(f.lines[i],x,y);
      context.textBaseline='alphabetic';const alphabetic=context.measureText(f.lines[i]||'M').actualBoundingBoxAscent;
      context.textBaseline='top';const top=context.measureText(f.lines[i]||'M').actualBoundingBoxAscent;
      positions.push({x,y,baseline:y+alphabetic-top});
      y+=26+(paragraphEnds.includes(i)?9:0);
    }
    const pixels=async(blob:Blob)=>{
      const url=URL.createObjectURL(blob),image=new Image(),canvas=document.createElement('canvas');canvas.width=480;canvas.height=320;
      try{image.src=url;await image.decode();const c=canvas.getContext('2d')!;c.drawImage(image,0,0);return c.getImageData(0,0,480,320).data;}
      finally{URL.revokeObjectURL(url);canvas.width=canvas.height=0;}
    };
    const compare=(a:Uint8ClampedArray,b:Uint8ClampedArray)=>{
      let alpha=0,premult=0,coverage=0,areaA=0,areaB=0;
      for(let i=0;i<a.length;i+=4){alpha=Math.max(alpha,Math.abs(a[i+3]-b[i+3]));coverage+=b[i+3];areaA+=a[i+3];areaB+=b[i+3];for(let k=0;k<3;k++)premult=Math.max(premult,Math.abs(a[i+k]*a[i+3]/255-b[i+k]*b[i+3]/255));}
      return {alpha,premult,coverage,relativeArea:Math.abs(areaA-areaB)/Math.max(1,areaB)};
    };
    const model=JSON.stringify(editor.document.toJSON()),revision=editor.document.getSnapshot().revision;
    const native=await pixels(await editor.exportPng()),expected=context.getImageData(0,0,480,320).data,independent=compare(native,expected);
    const exported=await editor.export({format:'svg'}),svg=await pixels(exported.blob),svgComparison=compare(svg,native);
    const bands=positions.map(position=>{
      const metric=(data:Uint8ClampedArray)=>{let sum=0,x=0,y=0;const columns=new Array<number>(480).fill(0);for(let yy=Math.max(0,Math.floor(32+position.y));yy<Math.min(320,Math.ceil(32+position.y+26));yy++)for(let xx=0;xx<480;xx++){const a=data[(yy*480+xx)*4+3];sum+=a;x+=xx*a;y+=yy*a;columns[xx]+=a;}const runs:{start:number;end:number;sum:number}[]=[];for(let i=0;i<480;i++)if(columns[i]){const last=runs.at(-1);if(last&&last.end===i){last.end++;last.sum+=columns[i];}else runs.push({start:i,end:i+1,sum:columns[i]});}return{sum,x:x/Math.max(1,sum),y:y/Math.max(1,sum),runs};};
      const a=metric(svg),b=metric(native);return{svg:a,native:b,dx:a.x-b.x,dy:a.y-b.y};
    });
    const xml=new DOMParser().parseFromString(await exported.blob.text(),'image/svg+xml');
    const texts=[...xml.querySelectorAll('text')].map(node=>({text:node.textContent,x:Number(node.getAttribute('x')),y:Number(node.getAttribute('y'))}));
    const unchanged=JSON.stringify(editor.document.toJSON())===model&&editor.document.getSnapshot().revision===revision;
    const project=await editor.saveProject();await editor.openProject(new File([project],'paragraph.luma'));
    const exactProject=JSON.stringify(editor.document.toJSON())===model,reopened=compare(await pixels(await editor.exportPng()),native);
    reference.width=reference.height=0;
    return {scenario,source:f.source,expectedLines:f.lines,texts,positions,bands,wrapWidth,height:layer.height,expectedHeight:y,independent,svgComparison,report:exported.report,unchanged,exactProject,reopened};
  }, scenario);
  await info.attach('paragraph-independent', {body:JSON.stringify(result),contentType:'application/json'});
  expect(result.independent.alpha).toBeLessThanOrEqual(1);expect(result.independent.premult).toBeLessThanOrEqual(1);expect(result.independent.coverage).toBeGreaterThan(10000);
  expect(result.texts.map(node=>node.text)).toEqual(result.expectedLines);
  for(let i=0;i<result.positions.length;i++)expect(result.texts[i].y).toBeCloseTo(result.positions[i].baseline,6);
  if(scenario==='spaces'){
    expect(result.svgComparison.relativeArea).toBeLessThan(.001);
    for(const band of result.bands){
      expect(Math.abs(band.dx)).toBeLessThan(.25);expect(Math.abs(band.dy)).toBeLessThan(.01);
      expect(band.svg.runs).toHaveLength(band.native.runs.length);
      for(let i=0;i<band.native.runs.length;i++){
        expect(Math.abs(band.svg.runs[i].start-band.native.runs[i].start)).toBeLessThanOrEqual(2);
        expect(Math.abs(band.svg.runs[i].end-band.native.runs[i].end)).toBeLessThanOrEqual(2);
      }
    }
    expect(result.report.warnings.join(' ')).toContain('whitespace boundaries');
  }
  else if(scenario!=='affine'){expect(result.svgComparison.alpha).toBeLessThanOrEqual(1);expect(result.svgComparison.premult).toBeLessThanOrEqual(1);}
  else expect(result.svgComparison.relativeArea).toBeLessThan(.02);
  expect(result.height).toBe(result.expectedHeight);expect(result.unchanged).toBe(true);expect(result.exactProject).toBe(true);expect(result.reopened.alpha).toBe(0);expect(result.reopened.premult).toBe(0);
  expect(result.report.warnings.join(' ')).toContain('Paragraph text');
});

test('nearly full paragraph width records native measurement work without changing source', async ({page},info)=>{
 await page.goto('/');const result=await page.evaluate(()=>{
  const {TextLayer}=window.luma,text=Array.from({length:1800},()=> 'word').join(' '),point=new TextLayer({text,fontFamily:'monospace',fontSize:16}),width=point.width-1;
  const prototypes=[CanvasRenderingContext2D.prototype,typeof OffscreenCanvasRenderingContext2D==='undefined'?null:OffscreenCanvasRenderingContext2D.prototype].filter(Boolean) as {measureText(text:string):TextMetrics}[];
  const originals=prototypes.map(p=>p.measureText);let calls=0,characters=0;
  prototypes.forEach((prototype,i)=>{prototype.measureText=function(text:string){calls++;characters+=text.length;return originals[i].call(this,text);};});
  try{const start=performance.now(),paragraph=new TextLayer({text,fontFamily:'monospace',fontSize:16,wrapWidth:width}),elapsed=performance.now()-start;return{calls,characters,sourceLength:text.length,width,storedWidth:paragraph.width,height:paragraph.height,elapsed,sourceExact:paragraph.text===text};}
  finally{prototypes.forEach((prototype,i)=>{prototype.measureText=originals[i];});}
 });await info.attach('paragraph-measurement-work',{body:JSON.stringify(result),contentType:'application/json'});expect(result.sourceExact).toBe(true);expect(result.storedWidth).toBe(result.width);expect(result.calls).toBeGreaterThan(0);
});

test('paragraph reflow preserves masked affine shadow pixels across caches, regions and undo',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {Document,TextLayer,LayerGroup,LayerStyle,LayerMask,MarqueeSelection,AffineTransform,editor}=window.luma;
    const {CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')) as typeof import('../src/engine/renderer');
    const renderer=new CanvasRenderer(),doc=new Document({width:640,height:420});
    const group=doc.layers.add(new LayerGroup({opacity:.71}));group.transform=new AffineTransform(.9,.17,-.12,1.1,260.25,70.75);
    const layer=group.layers.add(new TextLayer({text:'  fj Ág j\u0301 alpha beta gamma\nمرحبا שלום 🙂',fontSize:27,fontFamily:'serif',fontStyle:'italic',wrapWidth:180,paragraphSpacing:12,firstLineIndent:-8,wordSpacing:-.6,letterSpacing:-.4,opacity:.63,color:'#e7814b'}));
    layer.transform=new AffineTransform(-.91,.22,.15,1.07,40.3,-.4);
    layer.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#3355e0',opacity:.4},dropShadow:{enabled:true,color:'#443366',opacity:.65,blur:7.7,x:-29.25,y:17.75}});
    layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:-50,y:-10,width:240,height:300}),feather:3,density:.7});
    const original=JSON.stringify(doc.toJSON()),reports=[];let initial:Uint8ClampedArray|undefined;
    try{
      for(const stage of ['initial','changed','repeat','undo'] as const){
        if(stage==='changed')doc.transaction('Reflow paragraph',()=>{layer.wrapWidth=125;layer.paragraphSpacing=20;layer.firstLineIndent=9;});
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
  await info.attach('paragraph-cache-mask',{body:JSON.stringify(result),contentType:'application/json'});
});

test('late local fonts refresh paragraph line layout without a hidden document edit',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {Document,TextLayer,editor}=window.luma,{CanvasRenderer}=await import(/* @vite-ignore */String('/src/engine/renderer.ts')) as typeof import('../src/engine/renderer');
    const renderer=new CanvasRenderer(),doc=new Document({width:400,height:300}),layer=doc.layers.add(new TextLayer({text:'iiii WWWW iii WWW iii WWW\nMore editable text',fontFamily:'Canoli Paragraph Late Font',fontSize:28,wrapWidth:170,paragraphSpacing:10,firstLineIndent:8,x:20,y:20}));
    const original=JSON.stringify(doc.toJSON()),history=doc.getSnapshot().past.length;
    const read=async(cache:boolean)=>{const c=await renderer.render(doc.getSnapshot().document,editor.assetStore,{cache});try{return c.getContext('2d')!.getImageData(0,0,400,300).data;}finally{c.width=c.height=0;}};
    const face=new FontFace('Canoli Paragraph Late Font','url(/node_modules/@fontsource/dm-mono/files/dm-mono-latin-400-normal.woff2)');
    try{
      const fallback=await read(true);await read(true);
      const loaded=new Promise<void>(resolve=>document.fonts.addEventListener('loadingdone',()=>resolve(),{once:true}));document.fonts.add(face);await document.fonts.load('28px "Canoli Paragraph Late Font"');await loaded;
      const refreshed=await read(true),fresh=await read(false),unchanged=JSON.stringify(doc.toJSON())===original&&doc.getSnapshot().past.length===history;
      layer.reflow();const reflowWidth=layer.width,reflowHeight=layer.height,reflowHistory=doc.getSnapshot().past.length-history;doc.undo();
      return{changed:refreshed.some((v,i)=>v!==fallback[i]),exact:refreshed.every((v,i)=>v===fresh[i]),unchanged,reflowWidth,reflowHeight,reflowHistory,undoExact:JSON.stringify(doc.toJSON())===original};
    }finally{renderer.dispose();document.fonts.delete(face);}
  });
  expect(result).toMatchObject({changed:true,exact:true,unchanged:true,reflowWidth:170,reflowHistory:1,undoExact:true});expect(result.reflowHeight).toBeGreaterThan(28);
  await info.attach('paragraph-font-refresh',{body:JSON.stringify(result),contentType:'application/json'});
});
