import{test,expect}from'@playwright/test';
import{gunzipSync}from'node:zlib';
import{readFile,writeFile,access}from'node:fs/promises';
import{resolve,dirname,relative}from'node:path';
import{createHash}from'node:crypto';
import{transform}from'esbuild';
import{floatShadowInteraction}from'./helpers/float-shadow-interaction';

for(const baseline of[true,false])test((baseline?'baseline':'candidate')+' float shadow drag frames contain each actual pointer input and retain one Undo',async({page},info)=>{
 test.setTimeout(120000);const modules:Record<string,{code:string;sourceSha256:string}>={},hits:Record<string,number>={};
 if(baseline){const manifest=JSON.parse(await readFile('tests/fixtures/float-shadow-profile/manifest.json','utf8'));for(const name of['float-scene','float-shadow']){const path='src/engine/'+name+'.ts',packed=await readFile('tests/fixtures/float-shadow-profile/'+manifest.files[name].file);expect(createHash('sha256').update(packed).digest('hex')).toBe(manifest.files[name].sha256);const source=gunzipSync(packed).toString('utf8');expect(createHash('sha256').update(source).digest('hex')).toBe(manifest.files[name].rawSha256);const compiled=(await transform(source,{loader:'ts',format:'esm',target:'esnext'})).code;let code=compiled;const imports=[...compiled.matchAll(/from\s*["'](\.\.?\/[^"']+)["']/g)];for(const row of imports){const imported=resolve(dirname(resolve(path)),row[1])+'.ts';await access(imported);code=code.replace(row[0],row[0].replace(row[1],'/'+relative(process.cwd(),imported)));}modules[name]={code,sourceSha256:createHash('sha256').update(source).digest('hex')};}
  await page.route(/\/src\/engine\/(float-scene|float-shadow)\.ts(?:\?|$)/,async route=>{const name=new URL(route.request().url()).pathname.split('/').at(-1)!.slice(0,-3);hits[name]=(hits[name]??0)+1;await route.fulfill({contentType:'application/javascript',body:modules[name].code,headers:{'cache-control':'no-store'}});});
 }
 const session=process.env.CANOLI_SHADOW_CPU_PROFILE?await page.context().newCDPSession(page):undefined;const result=await floatShadowInteraction(page,info,false,session?{start:async()=>{await session.send('Profiler.enable');await session.send('Profiler.start');},stop:async()=>{const profile=await session.send('Profiler.stop');await writeFile(info.outputPath('shadow-drag.cpuprofile'),JSON.stringify(profile.profile));await session.detach();}}:{});if(baseline){expect(hits['float-scene']).toBeGreaterThan(0);expect(hits['float-shadow']).toBeGreaterThan(0);}await writeFile(info.outputPath('shadow-input-provenance.json'),JSON.stringify({baseline,baselineCommit:baseline?'153617a':undefined,hits,modules:baseline?modules:undefined,p95:result.p95},null,2));
});
