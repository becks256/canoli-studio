import {expect,type Page,type TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {historyScript,historyPng,historyProject} from './history-inspector';

export async function tiffPagesWorkflow(page:Page,info:TestInfo,production=false){
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(!production);
 await historyScript(page,"document.name='TIFF Red';document.resize(400,300);const paint=document.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({bounds:{x:30,y:20,width:120,height:90},color:'#ff0000'}))",'TIFF first page ready');
 const first=await historyProject(page,info,'tiff-pages-first.luma'),red=await historyPng(page,info,'tiff-pages-red.png');
 await page.getByRole('button',{name:'New document tab',exact:true}).click();
 await historyScript(page,"document.name='TIFF Blue';document.resize(2311,137);const paint=document.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({bounds:{x:2040,y:50,width:35,height:77},color:'#0000ff',opacity:.5}));paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:20,height:20},color:'#010203'}))",'TIFF second page ready');
 const second=await historyProject(page,info,'tiff-pages-second.luma'),blue=await historyPng(page,info,'tiff-pages-blue.png'),cases=[];
 for(const variant of ['auto','classic','big']){
  await page.getByRole('button',{name:'Export…',exact:true}).click();const dialog=page.getByRole('dialog',{name:'Export Document',exact:true});
  await dialog.getByLabel('Format',{exact:true}).selectOption('tiff');await dialog.getByLabel('TIFF compatibility',{exact:true}).selectOption(variant);
  await expect(dialog.getByLabel('TIFF pages',{exact:true})).toHaveValue('current');
  await dialog.getByLabel('TIFF pages',{exact:true}).selectOption('pages');
  const order=dialog.getByRole('region',{name:'TIFF page order',exact:true});
  await expect(order).toContainText('400 × 300 px');await expect(order).toContainText('2311 × 137 px');
  if(variant==='auto'){
   await order.getByRole('button',{name:'Remove TIFF page 1',exact:true}).click();await order.getByRole('button',{name:'Remove TIFF page 1',exact:true}).click();
   await expect(dialog.getByRole('button',{name:'Export .tif',exact:true})).toBeDisabled();await expect(order.getByRole('alert')).toContainText('Choose at least one page');
   await order.getByRole('checkbox',{name:'Include TIFF Red (open document 1) as TIFF page',exact:true}).check();await order.getByRole('checkbox',{name:'Include TIFF Blue (open document 2) as TIFF page',exact:true}).check();
  }
  await order.getByRole('button',{name:'Move TIFF page 2 up',exact:true}).click();
  await expect(order.getByRole('listitem').nth(0)).toContainText('Page 1: TIFF Blue');await expect(order.getByRole('listitem').nth(1)).toContainText('Page 2: TIFF Red');
  await expect(dialog).toContainText('Exports 2 TIFF pages');
  const footer=dialog.locator('.export-dialog-footer'),body=dialog.locator('.export-dialog-body');
  await expect(dialog.getByRole('button',{name:'Export .tif',exact:true})).toBeInViewport({ratio:1});
  await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeInViewport({ratio:1});
  const footerBefore=await footer.boundingBox();await body.evaluate(element=>{element.scrollTop=element.scrollHeight;});
  expect(await footer.boundingBox()).toEqual(footerBefore);
  await body.evaluate(element=>{element.scrollTop=0;});
  if(variant==='auto')await info.attach('tiff-pages-ui.png',{body:await dialog.screenshot(),contentType:'image/png'});
  const pending=page.waitForEvent('download'),path=info.outputPath(`tiff-pages-${variant}.tif`);await dialog.getByRole('button',{name:'Export .tif',exact:true}).click();await(await pending).saveAs(path);await expect(dialog).toHaveCount(0);
  cases.push({path,bigTiff:variant==='big',pages:[{referencePng:blue.path},{referencePng:red.path}]});
 }
 const manifest=info.outputPath('tiff-pages-cases.json');await writeFile(manifest,JSON.stringify(cases));
 const checked=spawnSync('python3',['scripts/check-tiff-pages.py',manifest],{encoding:'utf8',timeout:120000});expect(checked.status,checked.stdout+checked.stderr).toBe(0);await info.attach('tiff-pages-independent.json',{body:checked.stdout,contentType:'application/json'});
 expect((await historyProject(page,info,'tiff-pages-second-after.luma')).value.document).toEqual(second.value.document);
 await page.getByRole('tab',{name:/TIFF Red/}).click();const after=await historyProject(page,info,'tiff-pages-first-after.luma');expect(after.value.document).toEqual(first.value.document);expect(after.value.history).toEqual(first.value.history);
 expect((await historyPng(page,info,'tiff-pages-red-after.png')).bytes).toEqual(red.bytes);
 await page.getByTestId('import-input').setInputFiles(cases[2].path);const imported=page.getByRole('dialog',{name:'Import TIFF',exact:true});
 await expect(imported.getByLabel('TIFF page',{exact:true}).getByRole('option')).toHaveCount(2);
 await imported.getByLabel('TIFF page',{exact:true}).selectOption('0');await imported.getByRole('button',{name:'Import TIFF page',exact:true}).click();await expect(imported).toHaveCount(0);
 expect((await historyPng(page,info,'tiff-pages-reimported-blue.png')).bytes).toEqual(blue.bytes);
 return cases;
}
