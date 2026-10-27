import {test,expect}from '@playwright/test';
import {readFile,writeFile}from 'node:fs/promises';
import {iccApplicationWorkflow}from './helpers/icc-application';
test('ICC settings, actual canvas gamut alarm, independent RGB delivery and complete workspace restoration',async({page},info)=>{test.setTimeout(240000);await iccApplicationWorkflow(page,info);});

test('ICC source mismatch rejects workspace restoration atomically and disables legacy unclipped proof visibly',async({page},info)=>{
 await page.goto('/');const bytes=[...await readFile('tests/fixtures/icc-native/narrow-rgb.icc')];
 const result=await page.evaluate(async bytes=>{
  const editor=window.luma.editor,profile=await editor.inspectColorProfile(new Blob([new Uint8Array(bytes)]),'Source.icc'),before=editor.document.getSnapshot();
  await editor.setColorSettings({output:{profile,intent:'perceptual',blackPointCompensation:true},proof:null});await editor.saveWorkspace();
  const workspace=(await editor.workspaceRepository.load())!;const original=structuredClone(workspace),record=workspace.documents[0].colorSettings!.output.profile;if(record.kind!=='icc')throw new Error('Fixture');record.sha256='0'.repeat(64);await editor.workspaceRepository.save(workspace);
  const settings=editor.colorSettings,documents=[...editor.openDocuments],active=editor.document;let rejected=false;try{await editor.restoreWorkspace();}catch{rejected=true;}
  const sameTabs=editor.openDocuments.every((doc,i)=>doc===documents[i]),sameSettings=editor.colorSettings===settings&&editor.document===active;
  const legacy={...original,version:2 as const,documents:original.documents.map(entry=>{const{colorSettings:_,...old}=entry;return{...old,softProof:{proofSpace:'srgb' as const,intent:'unclipped' as const,gamutWarning:true}};})};await editor.workspaceRepository.save(legacy);await editor.restoreWorkspace();
  return{rejected,sameTabs,sameSettings,sourceUntouched:active.getSnapshot()===before,proofDisabled:editor.colorSettings.proof===null,warnings:editor.colorWarnings};
 },bytes);
 expect(result).toMatchObject({rejected:true,sameTabs:true,sameSettings:true,sourceUntouched:true,proofDisabled:true});expect(result.warnings.join(' ')).toContain('unclipped');await writeFile(info.outputPath('icc-restore-atomicity.json'),JSON.stringify(result,null,2));
});

test('genuine 50 MP ICC delivery keeps native geometry, exact alpha and original project sources across reopening',async({page},info)=>{
 test.setTimeout(480000);await page.goto('/');
 await page.getByTestId('import-input').setInputFiles('tests/fixtures/raw/native-50mp.png');await expect(page.locator('.layer-row')).toHaveCount(1,{timeout:120000});
 const result=await page.evaluate(async()=>{
  const editor=window.luma.editor,original=editor.document.toJSON(),asset=editor.assetStore.get(original.children[0].kind==='raster'?original.children[0].assetId:''),source=new Uint8Array(await asset.blob.arrayBuffer()),project=await editor.saveProject();await editor.openProject(new File([project],'ICC original.luma'));
  const before=editor.document.getSnapshot(),outputs:Record<string,Blob>={};outputs.source=await editor.exportPng();for(const format of ['png','tiff','pdf']as const)outputs[format]=(await editor.export({format,color:{profile:'display-p3'}})).blob;
  (window as unknown as {iccFiles:Record<string,Blob>}).iccFiles=outputs;
  const reopenedSource=await editor.assetStore.get(asset.id).blob.arrayBuffer();
  return{width:editor.document.width,height:editor.document.height,unchanged:before===editor.document.getSnapshot(),sameModel:JSON.stringify(editor.document.toJSON())===JSON.stringify(original),sameAssets:(await editor.assetStore.get(asset.id).blob.arrayBuffer()).byteLength===source.length&&source.every((value,index)=>value===new Uint8Array(reopenedSource)[index]),sizes:Object.fromEntries(Object.entries(outputs).map(([key,blob])=>[key,blob.size]))};
 });
 expect(result).toMatchObject({width:10000,height:5000,unchanged:true,sameModel:true,sameAssets:true});
 const paths:Record<string,string>={};for(const key of ['source','png','tiff','pdf']){const pending=page.waitForEvent('download');await page.evaluate(key=>{const blob=(window as unknown as {iccFiles:Record<string,Blob>}).iccFiles[key],link=document.createElement('a');link.href=URL.createObjectURL(blob);link.download=key;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);},key);paths[key]=info.outputPath(key+(key==='pdf'?'.pdf':key==='tiff'?'.tif':'.png'));await(await pending).saveAs(paths[key]);}
 const{spawnSync}=await import('node:child_process');const check=spawnSync(process.env.CANOLI_PDF_PYTHON||'python3',['scripts/check-icc-delivery.py',paths.source,'tests/fixtures/icc-native/display-p3.icc',paths.png,paths.tiff,paths.pdf],{encoding:'utf8',timeout:180000});expect(check.status,check.stderr||check.stdout).toBe(0);await writeFile(info.outputPath('icc-native-50mp.json'),JSON.stringify({...result,independent:JSON.parse(check.stdout)},null,2));
});
