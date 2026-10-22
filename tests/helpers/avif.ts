import {expect,type Page,type TestInfo} from '@playwright/test';
import {spawnSync} from 'node:child_process';

export async function saveAvifBlob(page:Page,info:TestInfo,key:string,extension:string){
 const pending=page.waitForEvent('download');
 await page.evaluate(({key,extension})=>{const blob=(window as unknown as {avifOutputs:Record<string,Blob>}).avifOutputs[key],a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=key+'.'+extension;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000);},{key,extension});
 const path=info.outputPath(key+'.'+extension);await(await pending).saveAs(path);return path;
}
export function checkAvif(path:string,reference:string,options:{lossy?:boolean;width?:number;height?:number}={}){
 const args=['scripts/check-avif-interoperability.py',path,reference,...(options.lossy?['--lossy']:[]),...(options.width?['--width',String(options.width),'--height',String(options.height)]:[])];
 const checked=spawnSync(process.env.CANOLI_AVIF_PYTHON||'python3',args,{encoding:'utf8',timeout:180000});
 expect(checked.status,checked.stderr||checked.stdout).toBe(0);return JSON.parse(checked.stdout);
}
