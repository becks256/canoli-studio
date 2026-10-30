import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {createHash} from 'node:crypto';

test('upscaled wet-mask sampling support survives finite field capture at the native image scale',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async()=>{
    const {editor,LayerMask,PencilStroke,WetPaintStroke,AffineTransform}=window.luma,{encodeRgbaPng}=await import(/* @vite-ignore */String('/src/engine/png.ts'));
    const add=async(alpha:number)=>(await editor.assetStore.add(await encodeRgbaPng(new Uint8Array([255,255,255,alpha]),1,1),'Wet support',undefined,false)).id;
    const output=await add(128),coverage=await add(255);
    const wet=new WetPaintStroke({brush:new PencilStroke({points:[{x:2.5,y:1.5}],size:1,pressureSize:false}),tiles:[{x:2,y:1,width:1,height:1,assetId:output,coverage:{assetId:coverage}}]});
    const mask=new LayerMask({base:.37}).applyWetPaint(wet).toJSON(),area={x:0,y:0,width:40,height:32};
    const captured=editor.renderer.capturePerspectiveMask(mask,{sourceWidth:32,sourceHeight:24,layerWidth:4,layerHeight:3,corners:[{x:0,y:0},{x:32,y:0},{x:32,y:24},{x:0,y:24}]},editor.assetStore);
    const canvas=await editor.renderer.renderMaskCoverage(mask,{...area,sx:1,sy:1},0,0,'wet-reference',false,AffineTransform.scale(8),editor.assetStore);
    try{
      const bytes=canvas.getContext('2d')!.getImageData(0,0,40,32).data,expected=Float32Array.from({length:40*32},(_,i)=>bytes[i*4+3]/255),actual=await captured.read(area);
      let different=0,maximum=0;for(let i=0;i<actual.length;i++){if(actual[i]!==expected[i])different++;maximum=Math.max(maximum,Math.abs(actual[i]-expected[i]));}
      return{bounds:captured.bounds,different,maximum,samples:actual.length};
    }finally{captured.dispose();canvas.width=canvas.height=0;}
  });
  await writeFile(info.outputPath('upscaled-wet-support.json'),JSON.stringify(result,null,2));expect(result.different).toBe(0);
});

test('perspective mask capture rejects genuine float display thumbnails as coverage sources',async({page})=>{
  const original=[...await readFile('tests/fixtures/uint16-float/u16-all-levels.tif')];
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async original=>{
    const {editor,LayerMask}=window.luma;
    await editor.openTiff(new File([new Uint8Array(original)],'Float original.tif',{type:'image/tiff'}),{editingPrecision:'float32'});
    const asset=editor.assetStore.values()[0],before=JSON.stringify(editor.document.toJSON());let error='';
    try{editor.renderer.capturePerspectiveMask(LayerMask.fromBitmap(asset.id).toJSON(),{sourceWidth:asset.width,sourceHeight:asset.height,layerWidth:asset.width,layerHeight:asset.height,
      corners:[{x:0,y:0},{x:asset.width,y:0},{x:asset.width,y:asset.height},{x:0,y:asset.height}]},editor.assetStore);}catch(value){error=String(value);}
    return{error,native:[asset.width,asset.height],preview:[asset.bitmap.width,asset.bitmap.height],unchanged:before===JSON.stringify(editor.document.toJSON())};
  },original);
  expect(result.error).toMatch(/thumbnail is display-only/);expect(Math.max(...result.native)).toBeGreaterThan(Math.max(...result.preview));expect(result.unchanged).toBe(true);
});

test('renderer mask capture projects all mask geometries, refinements and settings with independent document-pixel feather',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const records=await page.evaluate(async()=>{
    const {editor,LayerMask,MarqueeSelection,VectorPath,PencilStroke,BrushStroke,EraserStroke,WetPaintStroke,AffineTransform}=window.luma;
    const {encodeRgbaPng}=await import(/* @vite-ignore */String('/src/engine/png.ts'));
    const pixels=Uint8Array.from({length:37*29*4},(_,i)=>i%4===3?(Math.floor(i/4)*17%256):255);
    const bitmap=await editor.assetStore.add(await encodeRgbaPng(pixels,37,29),'Mask source',undefined,false);
    const wetOutput=await editor.assetStore.add(await encodeRgbaPng(new Uint8Array([255,255,255,128]),1,1),'Wet coverage',undefined,false);
    const wetSupport=await editor.assetStore.add(await encodeRgbaPng(new Uint8Array([255,255,255,255]),1,1),'Wet support',undefined,false);
    const pencil=new PencilStroke({points:[{x:-4.5,y:7.5},{x:22.5,y:7.5}],size:5,pressureSize:false});
    const selection=new MarqueeSelection({x:-9,y:4,width:48,height:31,shape:'rectangle'});
    const path=new VectorPath({points:[{x:-7,y:0,out:{x:40,y:-15}},{x:65,y:8,in:{x:38,y:-9}},{x:48,y:44},{x:4,y:36}],closed:true});
    const wet=new WetPaintStroke({brush:new PencilStroke({points:[{x:20.5,y:15.5}],size:1,pressureSize:false}),tiles:[{x:20,y:15,width:1,height:1,assetId:wetOutput.id,coverage:{assetId:wetSupport.id}}]});
    const masks=[
      new LayerMask({selection,x:4,y:-3,basis:new AffineTransform(1,.1,.2,.9),feather:3.5,density:.73}),
      new LayerMask({assetId:bitmap.id,x:-7,y:6,basis:AffineTransform.rotation(.17),feather:2.5,inverted:true,density:.63}),
      new LayerMask({paths:[path],feather:4.25,x:3,y:-2}),
      new LayerMask({base:.37,feather:2.5,density:.81}).paint(pencil,'hide').paint(new BrushStroke({points:[{x:30,y:19}],size:13,hardness:.4,pressureSize:false}),'reveal'),
      new LayerMask({rasterErasures:{width:64,height:48,operations:[{width:32,height:24,stroke:new EraserStroke({points:[{x:8,y:7}],size:6,pressureSize:false})}]},feather:3.25,inverted:true,density:.9}),
      new LayerMask({base:.37,feather:2.25}).paint(pencil,'hide').applyWetPaint(wet).paint(new PencilStroke({points:[{x:20.5,y:15.5}],size:1,pressureSize:false}),'reveal'),
      new LayerMask({assetId:bitmap.id,linked:false,x:11,y:7,feather:4.5,density:.77}),
      new LayerMask({base:.37}),
      new LayerMask({selection,enabled:false,feather:9}),
    ];
    const options={sourceWidth:32,sourceHeight:24,layerWidth:64,layerHeight:48,corners:[{x:8.25,y:5.5},{x:91.75,y:11},{x:77,y:66},{x:2.5,y:51}] as const},output={x:-13,y:-11,width:113,height:89};
    const before=JSON.stringify(editor.document.toJSON()),records=[];
    for(const value of masks){
      const dto=value.toJSON(),captured=editor.renderer.capturePerspectiveMask(dto,options,editor.assetStore);
      try{
        const mask=structuredClone(captured.mask),mapping=(mask.linked===false?new AffineTransform():AffineTransform.scale(.5)).multiply(AffineTransform.translation(mask.x??0,mask.y??0)).multiply(mask.basis?AffineTransform.fromJSON(mask.basis):new AffineTransform());
        const field={...captured.bounds},raw={...mask,feather:0,inverted:false,density:1};
        const canvas=await editor.renderer.renderMaskCoverage(raw,{...field,sx:1,sy:1},mapping.e,mapping.f,'independent-input',false,mapping,editor.assetStore);
        let source:number[];
        try{const bytes=canvas.getContext('2d')!.getImageData(0,0,field.width,field.height).data;source=Array.from({length:field.width*field.height},(_,i)=>Math.fround(bytes[i*4+3]/255));}finally{canvas.width=canvas.height=0;}
        dto.inverted=!dto.inverted;dto.density=.01;
        const actual=await captured.read(output),split=new Float32Array(actual.length);
        for(let y=0;y<output.height;y+=31){const part=await captured.read({...output,y:output.y+y,height:Math.min(31,output.height-y)});split.set(part,y*output.width);}
        const words=new Uint32Array(actual.buffer),parts=new Uint32Array(split.buffer);
        let unlinkedExact=true;
        if(mask.linked===false){const changed=editor.renderer.capturePerspectiveMask(mask,{...options,corners:options.corners.map(p=>({x:p.x+100,y:p.y+200})) as unknown as typeof options.corners},editor.assetStore);try{const other=new Uint32Array((await changed.read(output)).buffer);unlinkedExact=words.every((v,i)=>v===other[i]);}finally{changed.dispose();}}
        records.push({mask,source,field,background:captured.background,...options,output,actual:[...actual],partitionExact:words.every((v,i)=>v===parts[i]),unlinkedExact});
      }finally{captured.dispose();}
    }
    return{records,unchanged:before===JSON.stringify(editor.document.toJSON())};
  });
  expect(records.unchanged).toBe(true);const reports=[];
  for(const [index,row] of records.records.entries()){
    expect(row.partitionExact&&row.unlinkedExact).toBe(true);
    const actual=info.outputPath(`mask-${index}.f32le`),source=info.outputPath(`source-${index}.f32le`),data=info.outputPath(`case-${index}.json`);
    await writeFile(actual,new Uint8Array(new Float32Array(row.actual).buffer));await writeFile(source,new Uint8Array(new Float32Array(row.source).buffer));
    await writeFile(data,JSON.stringify({...row,actual:undefined,source:undefined}));
    const result=spawnSync(process.env.CANOLI_PDF_PYTHON??'python3',['scripts/check-projective-mask.py',actual,'--case',data,'--source',source],{encoding:'utf8',timeout:120000});
    expect(result.status,result.stderr||result.stdout).toBe(0);reports.push({index,kind:row.mask.kind,partitionExact:true,unlinkedExact:row.unlinkedExact,independent:JSON.parse(result.stdout)});
  }
  await writeFile(info.outputPath('projective-mask-geometries.json'),JSON.stringify(reports,null,2));
});

test('mask capture rejects source loss, renderer retirement and cancellation after native work without changing the document',async({page},info)=>{
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async()=>{
    const {editor,LayerMask,MarqueeSelection}=window.luma,{encodeRgbaPng}=await import(/* @vite-ignore */String('/src/engine/png.ts'));
    const before=JSON.stringify(editor.document.toJSON()),options={sourceWidth:32,sourceHeight:24,layerWidth:32,layerHeight:24,corners:[{x:0,y:0},{x:40,y:2},{x:35,y:30},{x:2,y:27}] as const},area={x:0,y:0,width:51,height:39};
    const blob=await encodeRgbaPng(new Uint8Array([255,255,255,128]),1,1),asset=await editor.assetStore.add(blob,'Owned mask',undefined,false);
    const bitmap=editor.renderer.capturePerspectiveMask(LayerMask.fromBitmap(asset.id).toJSON(),options,editor.assetStore);editor.assetStore.remove(asset.id);
    let lost='',retired='',cancelled='',disposed='';try{await bitmap.read(area);}catch(error){lost=String(error);}finally{bitmap.dispose();}
    const mask=new LayerMask({selection:new MarqueeSelection({x:2,y:3,width:17,height:11,shape:'rectangle'}),feather:3.25}).toJSON();
    const old=editor.renderer.capturePerspectiveMask(mask,options,editor.assetStore);editor.renderer.clearCache();try{await old.read(area);}catch(error){retired=String(error);}finally{old.dispose();}
    const abort=new AbortController(),captured=editor.renderer.capturePerspectiveMask(mask,options,editor.assetStore,{signal:abort.signal});
    const processor=editor.renderer.processor,native=processor.floatConvolveAlpha.bind(processor);let calls=0;
    processor.floatConvolveAlpha=async(...args)=>{const result=await native(...args);calls++;abort.abort();return result;};
    try{await captured.read(area);}catch(error){cancelled=String(error);}finally{processor.floatConvolveAlpha=native;captured.dispose();}
    const closed=editor.renderer.capturePerspectiveMask(mask,options,editor.assetStore);closed.dispose();try{await closed.read(area);}catch(error){disposed=String(error);}
    const fresh=editor.renderer.capturePerspectiveMask(mask,options,editor.assetStore);try{const actual=await fresh.read(area);return{lost,retired,cancelled,disposed,calls,freshCoverage:actual.some(v=>v>0),unchanged:before===JSON.stringify(editor.document.toJSON())};}finally{fresh.dispose();}
  });
  expect(result.lost).toMatch(/changed|source|disposed/i);expect(result.retired).toMatch(/cleared/);expect(result.cancelled).toMatch(/abort/i);expect(result.disposed).toMatch(/closed/);
  expect(result).toMatchObject({calls:1,freshCoverage:true,unchanged:true});await writeFile(info.outputPath('projective-mask-lifetimes.json'),JSON.stringify(result,null,2));
});

test('genuine 50 MP bitmap mask retains native distant alpha, bounded working canvases and original bytes through perspective feathering',async({page},info)=>{
  test.setTimeout(600000);const original=new Uint8Array(await readFile('tests/fixtures/matting/native-50mp.png'));
  await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
  const result=await page.evaluate(async original=>{
    const {editor,LayerMask}=window.luma,blob=new Blob([new Uint8Array(original)],{type:'image/png'}),asset=await editor.assetStore.add(blob,'Native 50 MP mask',undefined,false);
    const before=JSON.stringify(editor.document.toJSON()),options={sourceWidth:10000,sourceHeight:5000,layerWidth:10000,layerHeight:5000,corners:[{x:0,y:0},{x:10000,y:0},{x:10000,y:5004},{x:0,y:5000}] as const};
    const identity=editor.renderer.capturePerspectiveMask(LayerMask.fromBitmap(asset.id).toJSON(),{...options,corners:[{x:0,y:0},{x:10000,y:0},{x:10000,y:5000},{x:0,y:5000}]},editor.assetStore);
    let distant:number[];try{distant=[...await identity.read({x:9000,y:4000,width:2,height:1})];}finally{identity.dispose();}
    const value=LayerMask.fromBitmap(asset.id).with({feather:2.5,density:.8}),mask=value.toJSON(),output={x:8997,y:3997,width:12,height:12};
    const field={x:8950,y:3950,width:100,height:100},created=new WeakSet<HTMLCanvasElement>(),working:{width:number;height:number}[]=[],create=document.createElement;
    const width=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'width')!,height=Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype,'height')!;
    const record=(c:HTMLCanvasElement)=>{if(created.has(c))working.push({width:c.width,height:c.height});};
    document.createElement=function(this:Document,...args:any[]){const el=(create as any).apply(this,args);if(args[0]==='canvas')created.add(el);return el;} as typeof create;
    Object.defineProperty(HTMLCanvasElement.prototype,'width',{...width,set(value:number){width.set!.call(this,value);record(this);}});
    Object.defineProperty(HTMLCanvasElement.prototype,'height',{...height,set(value:number){height.set!.call(this,value);record(this);}});
    let captured:ReturnType<typeof editor.renderer.capturePerspectiveMask>|undefined;
    try{
      captured=editor.renderer.capturePerspectiveMask(mask,options,editor.assetStore);const actual=await captured.read(output);
      const hash=[...new Uint8Array(await crypto.subtle.digest('SHA-256',await asset.blob.arrayBuffer()))].map(v=>v.toString(16).padStart(2,'0')).join('');
      return{...options,field,output,mask,background:0,actual:[...actual],distant,working,sourceDimensions:[asset.width,asset.height],bitmapDimensions:[asset.bitmap.width,asset.bitmap.height],sourceSha256:hash,sourceIdentity:asset.blob===blob,unchanged:before===JSON.stringify(editor.document.toJSON())};
    }finally{captured?.dispose();document.createElement=create;Object.defineProperty(HTMLCanvasElement.prototype,'width',width);Object.defineProperty(HTMLCanvasElement.prototype,'height',height);}
  },[...original]);
  expect(result).toMatchObject({sourceDimensions:[10000,5000],bitmapDimensions:[10000,5000],sourceSha256:createHash('sha256').update(original).digest('hex'),sourceIdentity:true,unchanged:true});
  expect(result.distant).toEqual([Math.fround(128/255),0]);expect(result.working.length).toBeGreaterThan(0);
  expect(Math.max(...result.working.map(b=>b.width*b.height))).toBeLessThanOrEqual(262144);
  const actual=info.outputPath('projective-mask-50mp.f32le'),data=info.outputPath('projective-mask-50mp-case.json');
  await writeFile(actual,new Uint8Array(new Float32Array(result.actual).buffer));await writeFile(data,JSON.stringify({...result,actual:undefined,working:undefined}));
  const checked=spawnSync(process.env.CANOLI_PDF_PYTHON??'python3',['scripts/check-projective-mask.py',actual,'--case',data,'--source','tests/fixtures/matting/native-50mp.png','--png-source'],{encoding:'utf8',timeout:180000});
  expect(checked.status,checked.stderr||checked.stdout).toBe(0);await writeFile(info.outputPath('projective-mask-50mp.json'),JSON.stringify({...result,actual:undefined,independent:JSON.parse(checked.stdout)},null,2));
});
