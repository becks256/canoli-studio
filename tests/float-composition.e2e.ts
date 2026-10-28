import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{createHash}from'node:crypto';

for(const fullTone of[false,true])test('masked isolated and pass-through groups retain independently evaluated linear float colors and partition-invariant alpha; full tone='+fullTone,async({page},info)=>{
 // Declare the numerical bound before running the actual editor. Independent
 // straight-alpha formulas can associate f64 sums differently than the kernel.
 const colorTolerance=2**-20,alphaTolerance=2**-22,width=131,height=79;
 const bytes=gunzipSync(await readFile('tests/fixtures/float-source/rgba-raw-le-linear.f32le.gz')),source=new Float32Array(new Uint8Array(bytes).buffer),f=Math.fround;
 const over=(s:number[],b:number[],opacity:number)=>{const sa=s[3]*opacity,ba=b[3],a=sa+ba*(1-sa);if(sa===0)return b.slice();return[...s.slice(0,3).map((v,c)=>f((v*sa+b[c]*ba*(1-sa))/a)),f(a)];};
 const mix=(before:number[],after:number[],amount:number)=>{if(!amount)return before.slice();const ba=before[3]*(1-amount),aa=after[3]*amount,a=ba+aa;return[...before.slice(0,3).map((v,c)=>a?f((v*ba+after[c]*aa)/a):0),f(a)];};
 const expose=(pixel:number[],ev:number)=>{let rgb=pixel.slice(0,3).map(v=>v*2**ev);if(fullTone&&ev!==0){const contrast=ev>0?37:-61,saturation=ev>0?-43:79;rgb=rgb.map(v=>(v-.5)*2**(contrast/100)+.5);const lum=rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;rgb=rgb.map(v=>lum+(v-lum)*(1+saturation/100));}return[...rgb.map(f),pixel[3]];};
 const raster=(x:number,y:number,dx=0,dy=0,ev=0)=>{x-=dx;y-=dy;if(x<0||x>=width||y<0||y>=height)return[0,0,0,0];const at=(y*width+x)*4,p=[...source.subarray(at,at+4)];return p[3]?expose(p,ev):[0,0,0,0];};
 const expected=new Float32Array(width*height*4);
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  let pixel=over(raster(x,y,0,0,1),[0,0,0,0],.8125);
  let isolated=over(raster(x,y,3,2,-1),[0,0,0,0],.75);isolated=over(raster(x,y,-5,-2,0),isolated,.25);
  pixel=over(isolated,pixel,x>=10&&x<110&&y>=5&&y<65?.625:0);
  let after=mix(pixel,expose(pixel,-1),.5);after=over(raster(x,y,7,-3,0),after,.125);
  pixel=mix(pixel,after,x>=35&&x<100&&y>=10&&y<45?.375:0);
  pixel=mix(pixel,expose(pixel,1),x>=20&&x<60&&y>=15&&y<40?.5:0);
  expected.set(pixel,(y*width+x)*4);
 }
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);
 const result=await page.evaluate(async({bytes,fullTone})=>{
  const{editor,RasterLayer,LayerGroup,LayerMask,MarqueeSelection,AdjustmentLayer,ToneAdjustment}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],'Float groups.tif',{type:'image/tiff'}),{editingPrecision:'float32'});
  const options=(exposure:number)=>({exposure,contrast:fullTone?(exposure>0?37:-61):0,saturation:fullTone?(exposure>0?-43:79):0});
  const document=editor.document,base=document.layers.at(0)!;if(!(base instanceof RasterLayer))throw new Error('Expected raster');
  const rect=(x:number,y:number,width:number,height:number)=>new LayerMask({linked:false,selection:new MarqueeSelection({shape:'rectangle',x,y,width,height})});
  document.transaction('Compose original float groups',()=>{
   base.opacity=.8125;base.adjustments.add(new ToneAdjustment(options(1)));
   const isolated=new LayerGroup({name:'Isolated',opacity:.625,blendMode:'normal'});isolated.mask=rect(10,5,100,60);
   const a=new RasterLayer({assetId:base.assetId,width:131,height:79,x:3,y:2,opacity:.75});a.adjustments.add(new ToneAdjustment(options(-1)));isolated.layers.add(a);isolated.layers.add(new RasterLayer({assetId:base.assetId,width:131,height:79,x:-5,y:-2,opacity:.25}));document.layers.add(isolated);
   const pass=new LayerGroup({name:'Pass through',blendMode:'pass-through',opacity:.375});pass.mask=rect(35,10,65,35);pass.layers.add(new AdjustmentLayer({adjustment:{kind:'tone',...options(-1)},opacity:.5}));pass.layers.add(new RasterLayer({assetId:base.assetId,width:131,height:79,x:7,y:-3,opacity:.125}));document.layers.add(pass);
   const adjustment=new AdjustmentLayer({adjustment:{kind:'tone',...options(1)},opacity:.5});adjustment.mask=rect(20,15,40,25);document.layers.add(adjustment);
  });
  const saved=document.toJSON(),scene=await editor.renderer.captureFloatScene(saved,editor.assetStore);try{
   const full=await scene.read({x:0,y:0,width:131,height:79});let differences=0;for(let y=0;y<79;y+=13){const height=Math.min(13,79-y),part=await scene.read({x:0,y,width:131,height});for(let i=0;i<part.length;i++)if(new Uint32Array(part.buffer)[i]!==new Uint32Array(full.buffer)[y*131*4+i])differences++;}
   document.undo();document.redo();return{pixels:[...full],partitionDifferentWords:differences,undoRedoExact:JSON.stringify(document.toJSON())===JSON.stringify(saved)};
  }finally{scene.dispose();}
 },{bytes:[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')],fullTone});
 let maxColor=0,maxAlpha=0,different=0;const actual=new Float32Array(result.pixels);for(let i=0;i<actual.length;i++){const error=Math.abs(actual[i]-expected[i]);if(i%4===3)maxAlpha=Math.max(maxAlpha,error);else maxColor=Math.max(maxColor,error);if(actual[i]!==expected[i])different++;}
 expect(result.partitionDifferentWords).toBe(0);expect(result.undoRedoExact).toBe(true);expect(maxColor).toBeLessThanOrEqual(colorTolerance);expect(maxAlpha).toBeLessThanOrEqual(alphaTolerance);
 const hash=(value:Float32Array)=>createHash('sha256').update(new Uint8Array(value.buffer)).digest('hex');await writeFile(info.outputPath('float-group-reference.json'),JSON.stringify({width,height,samples:actual.length,maxColor,maxAlpha,colorTolerance,alphaTolerance,different,partitionDifferentWords:result.partitionDifferentWords,undoRedoExact:result.undoRedoExact,actualSha256:hash(actual),referenceSha256:hash(expected),reference:'Independent native source references; separately evaluated f64 source-over and premultiplied interpolation with explicit f32 stage boundaries.'},null,2));
});

test('isolated scripts and inert plugins use shared precision/history and reject byte-source substitutions atomically',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const result=await page.evaluate(async bytes=>{
  const{editor,RasterLayer,PaintLayer,LayerMask}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],'Script float.tif',{type:'image/tiff'}),{allowPrecisionLoss:true});await editor.setColorSettings({output:{profile:'srgb',intent:'relative-colorimetric',blackPointCompensation:false},proof:{profile:'srgb',intent:'relative-colorimetric',proofIntent:'relative-colorimetric',blackPointCompensation:false,gamutWarning:false,warningColor:'#00ffff'}});const before=editor.document.toJSON();
  await editor.runScript('document.convertToFloat(); const original=document.layers.at(0); original.opacity=.625; original.adjustments.add(new ToneAdjustment({exposure:1})); print(document.precision);');const edited=editor.document.toJSON(),proofCleared=editor.softProof===null&&editor.getSnapshot().softProof===null&&editor.colorSettings.proof===null;editor.document.undo();const oneUndo=JSON.stringify(editor.document.toJSON())===JSON.stringify(before);editor.document.redo();
  const manifest={format:'luma-plugin',apiVersion:1,id:'float-script-test',name:'Float command',version:'1.0.0',description:'Float host validation',permissions:['document:read','document:write']as const,commands:[{id:'exposure',title:'Exposure',source:'document.convertToFloat(); document.layers.at(0).opacity=.5;'}]};
  editor.plugins.install({...manifest,permissions:[...manifest.permissions]});const inert=JSON.stringify(editor.document.toJSON())===JSON.stringify(edited);await editor.runPlugin(manifest.id,'exposure');const changed=editor.document.layers.at(0)!.opacity===.5;editor.document.undo();const pluginUndo=JSON.stringify(editor.document.toJSON())===JSON.stringify(edited);
  const errors:string[]=[];for(const code of['document.layers.at(0).opacity=.25; document.layers.add(new PaintLayer());','document.layers.at(0).blendMode="multiply"; document.layers.add(new PaintLayer());']){try{await editor.runScript(code);}catch(error){errors.push(String(error));}}
  const atomic=JSON.stringify(editor.document.toJSON())===JSON.stringify(edited);editor.plugins.install({...manifest,version:'1.0.1',permissions:['document:read']});let readonly='';try{await editor.runPlugin(manifest.id,'exposure');}catch(error){readonly=String(error);}
  // A genuine float original's display bitmap cannot become byte artwork or coverage.
  const project=await editor.saveProject();await editor.openTiff(new File([new Uint8Array(bytes)],'Thumbnail only.tif',{type:'image/tiff'}),{editingPrecision:'float32'});const asset=editor.assetStore.values()[0];let byteRole='',maskRole='';try{const{Document}=window.luma;const byte=new Document({assets:editor.assetStore});byte.layers.add(new RasterLayer({assetId:asset.id,width:131,height:79}));}catch(error){byteRole=String(error);}try{editor.document.layers.at(0)!.mask=LayerMask.fromBitmap(asset.id);}catch(error){maskRole=String(error);}await editor.openProject(new File([project],'float-script.luma'));
  return{proofCleared,oneUndo,inert,changed,pluginUndo,errors,atomic,readonly,byteRole,maskRole,restored:JSON.stringify(editor.document.toJSON())===JSON.stringify(edited),precision:editor.document.precision,unusedPaintConstructor:!!PaintLayer};
 },[...await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')]);expect(result).toMatchObject({proofCleared:true,oneUndo:true,inert:true,changed:true,pluginUndo:true,atomic:true,restored:true,precision:'float32'});expect(result.errors).toHaveLength(2);expect(result.readonly).toMatch(/read.only|write|permission/i);expect(result.byteRole).toMatch(/display.only|thumbnail/);expect(result.maskRole).toMatch(/display.only|thumbnail/);await writeFile(info.outputPath('float-isolated-host.json'),JSON.stringify(result,null,2));
});
