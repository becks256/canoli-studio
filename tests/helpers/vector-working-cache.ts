import {expect,type Page,type TestInfo} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
import {Document,VectorLayer,VectorPath} from '../../src/dom';
import {serializeProject} from '../../src/core/project';
import {historyScript,historyProject,historyPng} from './history-inspector';
import {alignmentReference,exactAlignmentPixels} from './layer-alignment';

export async function vectorWorkingWorkflow(page:Page,info:TestInfo,production=false){
 const scene=new Document({name:'Vector cache composition',width:800,height:600}),rectangles:{x:number;y:number;width:number;height:number;color:string}[]=[];
 for(let i=0;i<64;i++){
  const selected=i===27,x=40+i%8*70,y=30+Math.floor(i/8)*65,color=selected?'#ef3a2c':'#2468ac',layer=new VectorLayer({name:selected?'Measured target':'Reference '+i,x,y});
  for(let j=0;j<(selected?200:32);j++){const r=j===0&&selected?{x:0,y:0,width:20,height:20}:{x:j%8*2,y:Math.floor(j/8)%8*2,width:3,height:3};layer.paths.add(VectorPath.rectangle(r,0,{fill:color,stroke:null,strokeWidth:0}));rectangles.push({...r,x:r.x+x,y:r.y+y,color});}
  scene.layers.add(layer);
 }
 const original=scene.toJSON(),file=info.outputPath('vector-cache-source.luma');await writeFile(file,Buffer.from(await(await serializeProject(original,{get(){throw new Error('No raster source');}})).arrayBuffer()));
 await page.setViewportSize({width:1440,height:1000});await page.goto('/');expect(await page.evaluate(()=>'luma'in window)).toBe(!production);await page.getByTestId('project-input').setInputFiles(file);await expect(page.getByLabel('Document name',{exact:true})).toHaveValue(scene.name);await historyScript(page,"for(const layer of document.layers)if(layer.name==='Measured target')document.selectedLayer=layer;",'Vector target selected');await page.keyboard.press('Control+1');
 const before=await historyProject(page,info,'vector-cache-before.luma'),beforePng=await historyPng(page,info,'vector-cache-before.png');expect(before.value.document).toEqual(original);
 const box=(await page.locator('.canvas-wrap').boundingBox())!;await page.mouse.move(box.x+260,box.y+235);await page.mouse.down();await page.mouse.move(box.x+276,box.y+241,{steps:4});await expect(page.locator('.selection-outline').first()).toHaveCSS('left','266px');await page.screenshot({path:info.outputPath('vector-cache-drag.png')});await page.mouse.up();
 const after=await historyProject(page,info,'vector-cache-after.luma'),afterPng=await historyPng(page,info,'vector-cache-after.png');expect(after.value.document).toEqual({...original,children:original.children.map(layer=>layer.name==='Measured target'?{...layer,x:266,y:231}:layer)});
 const references=rectangles.map(r=>r.color==='#ef3a2c'?{...r,x:r.x+16,y:r.y+6}:r),reference=await alignmentReference(page,info,'vector-cache-reference.png',800,600,references);await exactAlignmentPixels(page,reference,afterPng.bytes);
 await page.getByRole('button',{name:'Undo (Mod+Z)',exact:true}).click();expect((await historyProject(page,info,'vector-cache-undo.luma')).value.document).toEqual(original);expect((await historyPng(page,info,'vector-cache-undo.png')).bytes).toEqual(beforePng.bytes);await page.getByRole('button',{name:'Redo (Mod+Shift+Z)',exact:true}).click();expect((await historyPng(page,info,'vector-cache-redo.png')).bytes).toEqual(afterPng.bytes);await page.reload();await page.getByTestId('project-input').setInputFiles(after.path);expect((await historyPng(page,info,'vector-cache-reopened.png')).bytes).toEqual(afterPng.bytes);await writeFile(info.outputPath('vector-cache-workflow.json'),JSON.stringify({production,layers:64,paths:2216,originalGeometryRetained:true,oneUndo:true,pixelsExact:true,reopened:true},null,2));
}
