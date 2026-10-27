import{test,expect}from'@playwright/test';
import{readFile,writeFile}from'node:fs/promises';
test('failed proof removal keeps its badge and previous pixels, and reapplying disabled proof actually retries',async({page},info)=>{
 await page.goto('/');const bytes=[...await readFile('tests/fixtures/icc-native/narrow-rgb.icc')];
 await page.evaluate(async bytes=>{
  const{editor,PaintLayer,PaintFill}=window.luma;editor.newDocument({width:64,height:64});const layer=editor.document.layers.add(new PaintLayer());layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:64},color:'#ff0000'}));
  const profile=await editor.inspectColorProfile(new Blob([new Uint8Array(bytes)]),'Proof.icc');await editor.setColorSettings({output:editor.colorSettings.output,proof:{profile,intent:'relative-colorimetric',proofIntent:'relative-colorimetric',blackPointCompensation:false,gamutWarning:true,warningColor:'#ff00ff'}});
 },bytes);await expect(page.getByTestId('proof-status')).toContainText('applied');
 const sample=()=>page.getByTestId('artwork').evaluate(canvas=>[...(canvas as HTMLCanvasElement).getContext('2d')!.getImageData(1,1,1,1).data]);expect(await sample()).toEqual([255,0,255,255]);
 await page.evaluate(()=>{
  const editor=window.luma.editor,original=editor.renderer.prepareViewport.bind(editor.renderer);
  (window as unknown as{iccRetry:()=>void}).iccRetry=()=>{editor.renderer.prepareViewport=original;editor.setSoftProof(null);};
  editor.renderer.prepareViewport=async()=>{throw new Error('ICC proof removal failure fixture');};editor.setSoftProof(null);
 });await expect(page.getByTestId('proof-status')).toContainText('failed');expect(await sample()).toEqual([255,0,255,255]);await page.screenshot({path:info.outputPath('proof-removal-failed.png')});
 await page.evaluate(()=>(window as unknown as{iccRetry:()=>void}).iccRetry());await expect(page.getByTestId('proof-status')).toHaveCount(0);expect(await sample()).toEqual([255,0,0,255]);await writeFile(info.outputPath('icc-proof-retry.json'),JSON.stringify({failedRemovalLabeled:true,previousPixel:[255,0,255,255],sameDisabledSettingRetried:true,unproofedPixel:[255,0,0,255]},null,2));
});
