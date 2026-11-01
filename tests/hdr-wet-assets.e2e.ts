import {test,expect} from '@playwright/test';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';

test('real browser HDR asset capture reads all original words despite altered display thumbnails and guards source lifetime',async({page},info)=>{
  await page.goto('/');
  const result=await page.evaluate(async(raw)=>{
    const {AssetStore}=await import(/* @vite-ignore */ String('/src/core/assets.ts')) as typeof import('../src/core/assets');
    const {encodeFloatWetTile}=await import(/* @vite-ignore */ String('/src/core/float-wet-tile.ts')) as typeof import('../src/core/float-wet-tile');
    const {captureHdrWetAssetField}=await import(/* @vite-ignore */ String('/src/engine/hdr-wet-field.ts')) as typeof import('../src/engine/hdr-wet-field');
    const {wetBrowserAssets}=await import(/* @vite-ignore */ String('/src/engine/wet-composite.ts')) as typeof import('../src/engine/wet-composite');
    const pixels=new Float32Array(Uint8Array.from(raw).buffer),coverage=new Float32Array(pixels.length),width=131,height=79,region={x:-3,y:7,width,height},store=new AssetStore();
    for(let at=3;at<coverage.length;at+=4)coverage[at]=Math.min(1,pixels[at]+.125);
    const colorFile=await encodeFloatWetTile(pixels,width,height),coverageFile=await encodeFloatWetTile(coverage,width,height);
    const color=await store.add(colorFile,'prepared-color.tif','color',false,{tiff:{editingPrecision:'float32'}}),mask=await store.add(coverageFile,'prepared-coverage.tif','coverage',false,{tiff:{editingPrecision:'float32'}});
    const dimensions=[color.width,color.height,color.bitmap.width,color.bitmap.height],originalThumbnail=color.bitmap,canvas=document.createElement('canvas');canvas.width=color.bitmap.width;canvas.height=color.bitmap.height;canvas.getContext('2d')!.fillStyle='#ffffff';canvas.getContext('2d')!.fillRect(0,0,canvas.width,canvas.height);const white=await createImageBitmap(canvas);color.bitmap=white;
    const provider=wetBrowserAssets(store);provider.alpha=async function*(){throw new Error('A display alpha decoder was used for HDR originals');};
    const tile={...region,assetId:'color',coverage:{assetId:'coverage'}},pending=captureHdrWetAssetField([tile],provider);tile.x=999;tile.coverage.assetId='foreign';const field=await pending;
    try{
      const first=await field.readWindow(region),expected=new Float64Array(width*height*5);
      for(let pixel=0;pixel<width*height;pixel++){const at=pixel*4,to=pixel*5,a=pixels[at+3],c=coverage[at+3];if(c===0)continue;for(let channel=0;channel<3;channel++)expected[to+channel]=a===0?0:pixels[at+channel]*a;expected[to+3]=a;expected[to+4]=c;}
      const same=(a:Float64Array,b:Float64Array)=>new BigUint64Array(a.buffer).every((word,i)=>word===new BigUint64Array(b.buffer)[i]);
      let stale='';color.bitmap=originalThumbnail;try{await field.readWindow({x:99999,y:99999,width:1,height:1});}catch(error){stale=String(error);}color.bitmap=white;
      const abort=new AbortController(),stopped=captureHdrWetAssetField([{...region,assetId:'color',coverage:{assetId:'coverage'}}],provider,{signal:abort.signal}).then(()=>'',error=>String(error));abort.abort(new Error('Cancelled native HDR validation'));const cancelled=await stopped;
      const fresh=await captureHdrWetAssetField([{...region,assetId:'color',coverage:{assetId:'coverage'}}],provider),second=await fresh.readWindow(region);fresh.dispose();
      const bytes=(value:Float64Array)=>[...new Uint8Array(value.buffer)];color.bitmap=originalThumbnail;white.close();store.dispose();let closed='';try{await field.readWindow(region);}catch(error){closed=String(error);}
      return {dimensions,maskDimensions:[mask.width,mask.height],region,exact:same(first,expected),retryExact:same(second,expected),stale,cancelled,closed,color:[...new Uint8Array(await colorFile.arrayBuffer())],coverage:[...new Uint8Array(await coverageFile.arrayBuffer())],field:bytes(first),expected:bytes(expected),retry:bytes(second)};
    }finally{field.dispose();color.bitmap=originalThumbnail;white.close();store.dispose();}
  },[...gunzipSync(await readFile('tests/fixtures/hdr-wet-field/codec.bin.gz'))]);
  expect(result.dimensions).toEqual([131,79,96,58]);expect(result.maskDimensions).toEqual([131,79]);expect(result.exact).toBe(true);expect(result.retryExact).toBe(true);expect(result.stale).toMatch(/changed/);expect(result.cancelled).toMatch(/Cancelled/);expect(result.closed).toMatch(/disposed/);
  for(const name of ['color','coverage','field','expected','retry'] as const)await writeFile(info.outputPath(name+(name==='color'||name==='coverage'?'.tif':'.f64le')),Buffer.from(result[name]));
  await writeFile(info.outputPath('hdr-host-assets.json'),JSON.stringify({...result,color:undefined,coverage:undefined,field:undefined,expected:undefined,retry:undefined},null,2));
  const reference=spawnSync('python3',['scripts/check-hdr-wet-host-assets.py',info.outputDir],{encoding:'utf8',timeout:120000});expect(reference.status,reference.stderr||reference.stdout).toBe(0);await writeFile(info.outputPath('independent-native-host.json'),reference.stdout);
});

test('browser host rejects complete offscreen HDR pairs and preserves the byte-PNG validation contract',async({page})=>{
  await page.goto('/');const result=await page.evaluate(async()=>{
    const {AssetStore}=await import(/* @vite-ignore */ String('/src/core/assets.ts')) as typeof import('../src/core/assets');
    const {encodeFloatWetTile}=await import(/* @vite-ignore */ String('/src/core/float-wet-tile.ts')) as typeof import('../src/core/float-wet-tile');
    const {captureHdrWetAssetField}=await import(/* @vite-ignore */ String('/src/engine/hdr-wet-field.ts')) as typeof import('../src/engine/hdr-wet-field');
    const {validateWetPaintTile}=await import(/* @vite-ignore */ String('/src/core/wet-assets.ts')) as typeof import('../src/core/wet-assets');
    const {wetBrowserAssets}=await import(/* @vite-ignore */ String('/src/engine/wet-composite.ts')) as typeof import('../src/engine/wet-composite');
    const store=new AssetStore(),color=await encodeFloatWetTile(new Float32Array([4,-8,16,.5]),1,1),coverage=await encodeFloatWetTile(new Float32Array([0,0,0,.25]),1,1);let hdr='',byte='';
    try{for(const [id,blob]of [['color',color],['coverage',coverage]] as const)await store.add(blob,id+'.tif',id,false,{tiff:{editingPrecision:'float32'}});
      const tile={x:1000000,y:1000000,width:1,height:1,assetId:'color',coverage:{assetId:'coverage'}},provider=wetBrowserAssets(store);
      try{await captureHdrWetAssetField([tile],provider);}catch(error){hdr=String(error);}try{await validateWetPaintTile(tile,provider);}catch(error){byte=String(error);}return {hdr,byte};
    }finally{store.dispose();}
  });expect(result.hdr).toMatch(/already be masked/);expect(result.byte).toMatch(/RGB8\/RGBA8 PNG/);
});
