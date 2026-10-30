import {test,expect} from '@playwright/test';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';

test('production mask box filtering retains independent six-pass float coverage and validates its worker contract',async({page},info)=>{
  const files=(await readdir('dist/assets')).filter(name=>name.startsWith('pixels.worker-')&&name.endsWith('.js'));expect(files).toHaveLength(1);
  const folder='tests/fixtures/mask-feather/',manifest=JSON.parse(await readFile(folder+'manifest.json','utf8'));
  const bytes=[...new Uint8Array(gunzipSync(await readFile(folder+'source.f32le.gz')))];
  await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
  const result=await page.evaluate(async({url,manifest,bytes})=>{
    const worker=new Worker(url,{type:'module'}),source=new Float32Array(new Uint8Array(bytes).buffer);let sequence=0;
    try{
      await new Promise<void>((resolve,reject)=>{worker.onerror=event=>reject(new Error(event.message));worker.onmessage=event=>event.data.type==='ready'?resolve():event.data.type==='fatal'?reject(new Error(event.data.error)):null;});
      const request=(alpha:Float32Array,settings:Record<string,unknown>)=>new Promise<Float32Array<ArrayBuffer>>((resolve,reject)=>{
        const id=++sequence;worker.onmessage=event=>{const data=event.data;if(data.id!==id)return;if(data.error){reject(new Error(data.error));return;}
          if(!(data.pixels instanceof Float32Array)||!(data.pixels.buffer instanceof ArrayBuffer)||data.pixels.byteOffset!==0||data.pixels.byteLength!==data.pixels.buffer.byteLength){reject(new Error('Mask feather returned invalid owned coverage.'));return;}resolve(data.pixels);};
        worker.postMessage({id,pixels:new Uint8ClampedArray(0),floatConvolveAlpha:{alpha,settings}});
      });
      const records=[];
      for(const row of manifest.cases){
        const b=manifest.output,s=manifest.source,radius=row.feather/3,support=Math.ceil(radius),halo=3*support;
        let width=b.width+2*halo,height=b.height+2*halo,alpha=new Float32Array(width*height);
        for(let y=0;y<height;y++)alpha.set(source.subarray((b.y-halo-s.y+y)*s.width+b.x-halo-s.x,(b.y-halo-s.y+y)*s.width+b.x-halo-s.x+width),y*width);
        const before=alpha.slice();
        for(let pass=0;pass<3;pass++)for(const axis of ['horizontal','vertical']){
          const input=alpha;alpha=await request(input,{width,height,kernel:'box',radius,axis});
          if(axis==='horizontal')width-=2*support;else height-=2*support;
          if(alpha.length!==width*height)throw new Error('Mask feather output geometry differs.');
          if(pass===0&&axis==='horizontal'&&!input.every((v,i)=>v===before[i]))throw new Error('Worker changed caller-owned coverage.');
        }
        records.push({feather:row.feather,actual:[...alpha]});
      }
      const failures=[];
      for(const settings of [{width:2,height:1,kernel:'box',radius:1,axis:'horizontal'},{width:9,height:1,kernel:'box',radius:1,sigma:1,axis:'horizontal'}]){
        let error='';try{await request(new Float32Array(9).fill(.375),settings);}catch(value){error=String(value);}failures.push(error);
      }
      const retry=await request(new Float32Array(9).fill(.375),{width:9,height:1,kernel:'box',radius:1.25,axis:'horizontal'});
      return{records,failures,retry:[...retry]};
    }finally{worker.terminate();}
  },{url:'/assets/'+files[0],manifest,bytes});
  const records=[];
  for(const [index,row] of result.records.entries()){
    const expected=new Float32Array(new Uint8Array(gunzipSync(await readFile(folder+manifest.cases[index].reference))).buffer);
    expect(row.actual.length).toBe(expected.length);let maximum=0;for(let i=0;i<expected.length;i++)maximum=Math.max(maximum,Math.abs(row.actual[i]-expected[i]));
    expect(maximum).toBeLessThanOrEqual(manifest.absoluteError);records.push({feather:row.feather,samples:expected.length,maximum});
  }
  expect(result.failures.every(Boolean)).toBe(true);expect(result.retry).toEqual(Array(5).fill(.375));
  await writeFile(info.outputPath('mask-feather-production.json'),JSON.stringify({records,failures:result.failures,retry:result.retry},null,2));
});
