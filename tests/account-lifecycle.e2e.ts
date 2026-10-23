import {test,expect} from '@playwright/test';
import {DatabaseSync} from 'node:sqlite';
import {readFile,writeFile} from 'node:fs/promises';
import {gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
import {accountBrowser,approveIdentity,createAccount,accountProject} from './helpers/account-browser';
import {accountLifecycleWorkflow} from './helpers/account-lifecycle-browser';

test('account export and explicit deletion preserve native artwork, project and human undo/redo',async({page},info)=>accountLifecycleWorkflow(page,info));

test('stale deletion requires verifying an existing identity of the current account',async({page})=>{
 const host=await accountBrowser(page.context());try{
  await page.goto(host.origin);let dialog=await createAccount(page);const before=await(await page.request.get(host.origin+'/auth/session')).json(),db=new DatabaseSync(host.database);try{db.prepare('UPDATE browsers SET auth_at=0 WHERE user_id=?').run(before.user.id);}finally{db.close();}
  await dialog.getByRole('button',{name:'Refresh account status',exact:true}).click();await expect(dialog).toContainText('Verify your current ChatGPT sign-in before linking');await dialog.getByRole('button',{name:'Delete Canoli account…',exact:true}).click();await expect(dialog.getByRole('textbox',{name:'Type DELETE to confirm',exact:true})).toHaveCount(0);
  host.profile={subject:'other-person',name:'Other person',email:'same@example.test'};dialog=await approveIdentity(page);await expect(dialog.getByRole('alert')).toContainText('Sign-in could not be completed.');expect((await(await page.request.get(host.origin+'/auth/session')).json()).user.id).toBe(before.user.id);await expect(dialog.getByRole('button',{name:'Create Canoli account',exact:true})).toHaveCount(0);
  host.profile={subject:'artist-one',name:'Ada Artist',email:'same@example.test'};dialog=await approveIdentity(page);const input=dialog.getByRole('textbox',{name:'Type DELETE to confirm',exact:true});await expect(input).toBeVisible();await input.fill('DELETE');await input.press('ControlOrMeta+a');await input.press('Backspace');await expect(input).toHaveValue('');await expect(dialog.getByRole('button',{name:'Permanently delete Canoli account',exact:true})).toBeDisabled();await input.fill('DELETE');await dialog.getByRole('button',{name:'Permanently delete Canoli account',exact:true}).click();await expect(dialog).toContainText('Your Canoli account was deleted.');
 }finally{await host.close();}
});

for(const corrupt of [false,true])test('account export discards '+(corrupt?'unexpected private fields':'a response after the account has changed'),async({page})=>{
 const host=await accountBrowser(page.context());try{
  await page.goto(host.origin);const dialog=await createAccount(page);let release!:()=>void,entered!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;}),ready=new Promise<void>(resolve=>{entered=resolve;}),downloads:string[]=[];page.on('download',download=>downloads.push(download.suggestedFilename()));
  await page.route(host.origin+'/auth/export',async route=>{const response=await route.fetch();entered();await gate;if(corrupt)await route.fulfill({response,json:{...await response.json(),sessionToken:'fixture-private-value'}});else await route.fulfill({response});});
  await dialog.getByRole('button',{name:'Download account data',exact:true}).click();await ready;if(!corrupt){const view=await(await page.request.get(host.origin+'/auth/session')).json();expect((await page.request.post(host.origin+'/auth/signout',{headers:{Origin:host.origin},data:{csrf:view.csrf}})).status()).toBe(200);}release();await expect(dialog.getByRole('alert')).toContainText('The account action could not be completed.');expect(downloads).toEqual([]);await expect(dialog.getByText('Account data downloaded.',{exact:false})).toHaveCount(0);
 }finally{await host.close();}
});

test('genuine 50 MP RAW originals and pixels survive account deletion and editable project reopening',async({page},info)=>{
 test.setTimeout(360000);const host=await accountBrowser(page.context());try{
  const source=gunzipSync(await readFile('tests/fixtures/raw/native-50mp.dng.gz')),path=info.outputPath('lifecycle-50mp.dng');await writeFile(path,source);await page.goto(host.origin);await page.getByTestId('import-input').setInputFiles(path);const review=page.getByRole('dialog',{name:'Import camera RAW',exact:true});await review.getByRole('checkbox',{name:'Convert RAW development to 8-bit editing precision',exact:true}).check();await review.getByRole('button',{name:'Import RAW image',exact:true}).click();await expect(review).toHaveCount(0,{timeout:180000});const before=await accountProject(page,info,'lifecycle-50mp-before.luma');expect([before.value.document.width,before.value.document.height]).toEqual([10000,5000]);
  const dialog=await createAccount(page);await dialog.getByRole('button',{name:'Delete Canoli account…',exact:true}).click();await dialog.getByRole('textbox',{name:'Type DELETE to confirm',exact:true}).fill('DELETE');await dialog.getByRole('button',{name:'Permanently delete Canoli account',exact:true}).click();await expect(dialog).toContainText('Your Canoli account was deleted.');await dialog.getByRole('button',{name:'Done',exact:true}).click();const after=await accountProject(page,info,'lifecycle-50mp-after.luma');expect(after.value.document).toEqual(before.value.document);const original=after.value.entries.find(asset=>asset.raw)!.raw!.originalBlob,originalSha256=createHash('sha256').update(Buffer.from(await original.arrayBuffer())).digest('hex');expect(original.size).toBe(100000672);expect(originalSha256).toBe('cfe25bed379735dfea685695e956838b284106e6527e6aff77e3901ef6ef9d85');
  await page.reload();await page.getByTestId('project-input').setInputFiles(after.path);await expect(page.locator('.layer-row')).toHaveCount(1,{timeout:180000});const downloading=page.waitForEvent('download',{timeout:180000});await page.getByRole('button',{name:'Export PNG',exact:true}).click();const png=info.outputPath('lifecycle-50mp.png');await(await downloading).saveAs(png);await info.attach('lifecycle-50mp.png',{body:await readFile(png),contentType:'image/png'});await info.attach('lifecycle-50mp-original.json',{body:JSON.stringify({originalBytes:original.size,originalSha256,size:[10000,5000],documentPreserved:true}),contentType:'application/json'});
 }finally{await host.close();}
});
