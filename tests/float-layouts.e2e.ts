import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
import{gunzipSync}from'node:zlib';
import{createHash}from'node:crypto';
const hash=(data:Uint8Array)=>createHash('sha256').update(data).digest('hex');
test('float document admission and composition preserve every independent native sample across all twelve original layouts',async({page},info)=>{
 test.setTimeout(180000);await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const manifest=JSON.parse(await readFile('tests/fixtures/float-source/manifest.json','utf8')),results=[];
 for(const row of manifest.cases.filter((row:{width:number})=>row.width<10000)){
  const raw=gunzipSync(await readFile('tests/fixtures/float-source/'+row.reference)),expected=new Float32Array(new Uint8Array(raw).buffer);for(let i=0;i<expected.length;i+=4)if(expected[i+3]===0)expected.fill(0,i,i+3);
  const actual=await page.evaluate(async({bytes,row})=>{const{editor}=window.luma;await editor.openTiff(new File([new Uint8Array(bytes)],row.file,{type:'image/tiff'}),{editingPrecision:'float32',...(row.assumption?{floatColorSpace:row.assumption}:{})});const scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);try{const samples=await scene.read({x:0,y:0,width:131,height:79});return{hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',samples.buffer))].map(v=>v.toString(16).padStart(2,'0')).join(''),dimensions:[editor.document.width,editor.document.height],precision:editor.document.precision};}finally{scene.dispose();}},{bytes:[...await readFile('tests/fixtures/tiff-float/'+row.file)],row});expect(actual).toMatchObject({hash:hash(new Uint8Array(expected.buffer)),dimensions:[131,79],precision:'float32'});results.push({file:row.file,...actual});
 }
 await writeFile(info.outputPath('float-document-layouts.json'),JSON.stringify(results,null,2));
});
test('all eight native TIFF orientations preserve float colors and authored original geometry through actual document transforms',async({page},info)=>{
 await page.goto('/');await page.waitForFunction(()=>!!window.luma?.editor);const original=new Uint8Array(await readFile('tests/fixtures/tiff-float/rgba-raw-le.tif')),raw=gunzipSync(await readFile('tests/fixtures/float-source/rgba-raw-le-linear.f32le.gz')),source=new Float32Array(new Uint8Array(raw).buffer),results=[];
 for(let orientation=1;orientation<=8;orientation++){
  const input=original.slice(),view=new DataView(input.buffer),little=view.getUint16(0)===0x4949;expect(view.getUint16(2,little)).toBe(42);const ifd=view.getUint32(4,little);let patched=false;for(let i=0;i<view.getUint16(ifd,little);i++){const at=ifd+2+i*12;if(view.getUint16(at,little)===274){view.setUint16(at+8,orientation,little);patched=true;break;}}expect(patched).toBe(true);
  const width=orientation>=5?79:131,height=orientation>=5?131:79,expected=new Float32Array(width*height*4);
  for(let y=0;y<79;y++)for(let x=0;x<131;x++){const dx=orientation===1||orientation===4?x:orientation===2||orientation===3?130-x:orientation===5||orientation===8?y:78-y,dy=orientation===1||orientation===2?y:orientation===3||orientation===4?78-y:orientation===5||orientation===6?x:130-x,at=(y*131+x)*4,out=(dy*width+dx)*4;if(source[at+3])expected.set(source.subarray(at,at+4),out);}
  const actual=await page.evaluate(async({input,orientation,width,height})=>{const{editor}=window.luma;await editor.openTiff(new File([new Uint8Array(input)],'Orientation '+orientation+'.tif',{type:'image/tiff'}),{editingPrecision:'float32'});const scene=await editor.renderer.captureFloatScene(editor.document.toJSON(),editor.assetStore);try{const pixels=await scene.read({x:0,y:0,width,height});return{hash:[...new Uint8Array(await crypto.subtle.digest('SHA-256',pixels.buffer))].map(v=>v.toString(16).padStart(2,'0')).join(''),dimensions:[editor.document.width,editor.document.height],native:[editor.assetStore.values()[0].width,editor.assetStore.values()[0].height]};}finally{scene.dispose();}},{input:[...input],orientation,width,height});expect(actual).toMatchObject({hash:hash(new Uint8Array(expected.buffer)),dimensions:[width,height],native:[131,79]});results.push({orientation,...actual});
 }
 await writeFile(info.outputPath('float-document-orientations.json'),JSON.stringify(results,null,2));
});
