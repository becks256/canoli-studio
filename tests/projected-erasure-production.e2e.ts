import {test,expect} from '@playwright/test';
import {PngRowEncoder} from '../src/core/png-stream';
import {historyProject,historyScript,historyPng} from './helpers/history-inspector';
import {readFile} from 'node:fs/promises';

test('production perspective eraser supports isolated commands, pointer cancellation, Undo and original-bearing export',async({page},info)=>{
  const encoder=new PngRowEncoder(64,48);await encoder.append(Uint8Array.from({length:64*48*4},(_,i)=>i%4===0||i%4===3?255:0),48);const blob=await encoder.finish();
  await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);
  await page.getByTestId('import-input').setInputFiles({name:'Placed eraser.png',mimeType:'image/png',buffer:Buffer.from(await blob.arrayBuffer())});await page.getByRole('button',{name:'Select Placed eraser.png',exact:true}).click();
  await historyScript(page,'document.selectedLayer.perspective=new PerspectiveTransform({corners:[{x:0,y:0},{x:1,y:0},{x:.75,y:1},{x:.25,y:1}]});','Placed eraser ready');
  await page.getByRole('button',{name:'Eraser tool (E)',exact:true}).click();await page.keyboard.press('Control+1');
  for(const[label,value]of[['Size value','10'],['Hardness value','100']]as const){const input=page.getByRole('spinbutton',{name:label,exact:true});await input.fill(value);await input.press('Enter');}
  const before=await historyProject(page,info,'placed-before.luma'),box=(await page.locator('.canvas-wrap').boundingBox())!,at={x:box.x+box.width/2,y:box.y+box.height/2+8};
  await page.mouse.move(at.x,at.y);await page.mouse.down();await page.keyboard.press('Escape');await page.mouse.up();expect((await historyProject(page,info,'placed-cancelled.luma')).value.document).toEqual(before.value.document);
  await page.mouse.move(at.x,at.y);await page.mouse.down();await page.mouse.up();const pointer=await historyProject(page,info,'placed-pointer.luma'),raster=pointer.value.document.children[0];if(raster.kind!=='raster')throw Error('Missing raster');expect(raster.erasures).toHaveLength(1);expect(raster.erasures![0].placement).toEqual({perspective:raster.perspective,bounds:{x:0,y:0,width:64,height:48}});
  await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyProject(page,info,'placed-undo.luma')).value.document).toEqual(before.value.document);
  await historyScript(page,'document.selectedLayer.erase(new EraserStroke({points:[{x:32,y:32}],size:10,hardness:1,pressureSize:false}),{space:"placed"});','Placed scripted erase complete');
  await page.getByRole('button',{name:'Reset perspective',exact:true}).click();const saved=await historyProject(page,info,'placed-reset.luma');expect(new Uint8Array(await saved.value.entries[0].blob.arrayBuffer())).toEqual(new Uint8Array(await blob.arrayBuffer()));
  const png=await historyPng(page,info,'placed-reset.png'),samples=await page.evaluate(async bytes=>{const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=new OffscreenCanvas(64,48),c=canvas.getContext('2d')!;try{c.drawImage(bitmap,0,0);return{erased:[...c.getImageData(32,24,1,1).data],retained:[...c.getImageData(2,2,1,1).data]};}finally{bitmap.close();}},[...await readFile(png.path)]);
  expect(samples).toEqual({erased:[0,0,0,0],retained:[255,0,0,255]});
});
