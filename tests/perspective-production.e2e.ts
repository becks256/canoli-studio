import {test,expect} from '@playwright/test';
import {PngRowEncoder} from '../src/core/png-stream';
import {historyProject,historyScript,historyPng} from './helpers/history-inspector';
import {readFile} from 'node:fs/promises';

test('production perspective constructors, Inspector reset and Undo preserve original-bearing projects without developer globals',async({page},info)=>{
 const encoder=new PngRowEncoder(4,4);await encoder.append(Uint8Array.from({length:64},(_,i)=>i%4===0||i%4===3?255:0),4);const blob=await encoder.finish();
 await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(false);await page.getByTestId('import-input').setInputFiles({name:'Production original.png',mimeType:'image/png',buffer:Buffer.from(await blob.arrayBuffer())});await page.getByRole('button',{name:'Select Production original.png',exact:true}).click();
 await historyScript(page,'document.resize(48,32);document.selectedLayer.perspective=PerspectiveTransform.fromPixels(4,4,[{x:4,y:4},{x:40,y:4},{x:30,y:28},{x:12,y:28}]);','Production perspective ready');
 const authored=await historyProject(page,info,'perspective-production.luma');expect(authored.value.document.children[0].perspective?.corners[0]).toEqual({x:1,y:1});expect(new Uint8Array(await authored.value.entries[0].blob.arrayBuffer())).toEqual(new Uint8Array(await blob.arrayBuffer()));
 const png=await historyPng(page,info,'perspective-production.png'),samples=await page.evaluate(async bytes=>{const bitmap=await createImageBitmap(new Blob([new Uint8Array(bytes)],{type:'image/png'})),canvas=document.createElement('canvas');canvas.width=48;canvas.height=32;const ctx=canvas.getContext('2d')!;try{ctx.drawImage(bitmap,0,0);return{inside:[...ctx.getImageData(20,16,1,1).data],outside:[...ctx.getImageData(0,0,1,1).data]};}finally{bitmap.close();canvas.width=canvas.height=0;}},[...await readFile(png.path)]);expect(samples).toEqual({inside:[255,0,0,255],outside:[0,0,0,0]});
 await page.getByRole('button',{name:'Reset perspective',exact:true}).click();expect((await historyProject(page,info,'perspective-reset.luma')).value.document.children[0].perspective).toBeNull();await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyProject(page,info,'perspective-reset-undo.luma')).value.document).toEqual(authored.value.document);
});
