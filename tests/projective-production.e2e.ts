import {test,expect} from '@playwright/test';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';

test('production perspective WASM worker matches all independent corner and alpha references without developer globals',async({page},info)=>{
  const files=(await readdir('dist/assets')).filter(name=>name.startsWith('pixels.worker-')&&name.endsWith('.js'));expect(files).toHaveLength(1);
  const manifest=JSON.parse(await readFile('tests/fixtures/projective/manifest.json','utf8')),source=[...new Uint8Array(gunzipSync(await readFile('tests/fixtures/projective/source.f32le.gz')))];
  await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
  const records=[];
  for(const row of manifest.cases){
    const actual=await page.evaluate(async({url,row,source})=>{
      const worker=new Worker(url,{type:'module'});
      try{return await new Promise<number[]>((resolve,reject)=>{
        worker.onerror=event=>reject(new Error(event.message));worker.onmessage=event=>{
          const data=event.data;if(data.type==='fatal'||data.error){reject(new Error(data.error));return;}
          if(data.type==='ready'){worker.postMessage({id:1,pixels:new Uint8ClampedArray(0),floatProjective:{pixels:new Float32Array(new Uint8Array(source).buffer),options:{sourceWidth:row.width,sourceHeight:row.height,source:{x:0,y:0,width:row.width,height:row.height},output:row.output,corners:row.corners}}});return;}
          if(data.id!==1||!(data.pixels instanceof Float32Array)||data.pixels.length!==row.output.width*row.output.height*4||data.pixels.byteOffset!==0||data.pixels.byteLength!==data.pixels.buffer.byteLength){reject(new Error('Invalid production perspective worker reply.'));return;}resolve([...data.pixels]);
        };
      });}finally{worker.terminate();}
    },{url:'/assets/'+files[0],row,source});
    const expected=new Float32Array(new Uint8Array(gunzipSync(await readFile('tests/fixtures/projective/'+row.reference))).buffer);expect(actual.length).toBe(expected.length);let maximum=0;for(let i=0;i<expected.length;i++)maximum=Math.max(maximum,Math.abs(actual[i]-expected[i])/Math.max(1,Math.abs(expected[i])));expect(maximum).toBeLessThanOrEqual(manifest.colorErrorScale);records.push({name:row.name,maximum,samples:expected.length});
  }
  await writeFile(info.outputPath('projective-production-worker.json'),JSON.stringify(records,null,2));
});

test('perspective dependency guide keeps its pending application boundary readable at 390 px without JavaScript',async({browser,baseURL},info)=>{
  const context=await browser.newContext({javaScriptEnabled:false,viewport:{width:390,height:844}});
  try{const page=await context.newPage();await page.goto(`${baseURL}/developer/api.html`);await page.getByRole('link',{name:'Implemented dependency and required public integration',exact:true}).click();await expect(page.getByRole('heading',{name:'Native perspective engine — application integration in progress',exact:true})).toBeVisible();await expect(page.locator('main')).toContainText('This connected placement increment does not complete F03');expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:info.outputPath('projective-guide-390.png'),fullPage:true});}finally{await context.close();}
});
