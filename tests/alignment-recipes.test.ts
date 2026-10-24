import {expect,it} from 'vitest';
import {Document,PaintLayer,PaintFill} from '../src/dom';
import {RecipeRecorder,compileEditPlan,executeRecipe,validateRecipe} from '../src/ai/recipes';
import {serializeRecipePackage,readRecipePackage} from '../src/ai/recipes/package';
function scene(width=300){const document=new Document({width,height:200});const layers=['One','Key'].map((name,index)=>{const layer=document.layers.add(new PaintLayer({name,x:20+index*150,y:30+index*50}));layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:30+index*20,height:20},color:'#2468ac'}));return layer;});document.selectLayers(layers);return{document,layers};}
function record(document:Document,action:()=>void){const recorder=new RecipeRecorder();recorder.start();const unhook=document.onCommand((command,before,after)=>recorder.recordCommand(command,before,after));action();unhook();return recorder.stop();}
it('records semantic canvas alignment and replays relative to a different canvas with fresh identities and one undo',async()=>{
 const a=scene(),workflow=record(a.document,()=>a.document.layerSelection.align('center','canvas'));expect(validateRecipe(workflow).errors).toEqual([]);expect(workflow.steps[0].action.type).toBe('layer.align');for(const layer of a.layers)expect(JSON.stringify(workflow)).not.toContain(layer.id);
 const b=scene(500),before=b.document.toJSON(),plan=compileEditPlan(workflow,b.document.toJSON(),null);expect(plan.valid,JSON.stringify(plan.errors)).toBe(true);expect(plan.summary.layersModified).toBe(2);expect(b.document.toJSON()).toEqual(before);expect(executeRecipe(JSON.parse(JSON.stringify(workflow)),b.document).success).toBe(true);expect(b.layers.map(layer=>layer.x)).toEqual([235,225]);b.document.undo();expect(b.document.toJSON()).toEqual(before);
 const packaged=await readRecipePackage(await serializeRecipePackage(workflow,{get(){throw new Error('No source images expected.');}}));expect(executeRecipe(packaged.recipe,b.document).success).toBe(true);expect(b.layers.map(layer=>layer.x)).toEqual([235,225]);
});
it('keeps a locked semantic key stationary and rejects ambiguous or changed target sets',()=>{
 const a=scene();a.layers[1].locked=true;const workflow=record(a.document,()=>a.document.layerSelection.align('right',a.layers[1])),b=scene();b.layers[1].locked=true;const key=b.layers[1].toJSON();expect(executeRecipe(workflow,b.document).success).toBe(true);expect(b.layers[0].x).toBe(190);expect(b.layers[1].toJSON()).toEqual(key);
 b.document.layers.add(new PaintLayer({name:'Key'}));const before=b.document.toJSON();expect(executeRecipe(workflow,b.document).success).toBe(false);expect(b.document.toJSON()).toEqual(before);
});
it('rejects duplicate semantic moving targets and step targets instead of aligning another selection',()=>{
 const a=scene(),workflow=record(a.document,()=>a.document.layerSelection.align('top','canvas'));const action=workflow.steps[0].action;if(action.type!=='layer.align')throw new Error('Missing alignment');action.targets.push(action.targets[0]);const before=a.document.toJSON();expect(executeRecipe(workflow,a.document).success).toBe(false);expect(a.document.toJSON()).toEqual(before);action.targets.pop();workflow.steps[0].target={role:'all'};expect(executeRecipe(workflow,a.document).success).toBe(false);expect(a.document.toJSON()).toEqual(before);
});
it('uses step-result references for newly created artwork instead of recording temporary IDs',()=>{
 const source=new Document({width:300,height:200});let id='';const workflow=record(source,()=>{const layer=new PaintLayer({name:'New artwork'});layer.strokes.add(new PaintFill({bounds:{x:0,y:0,width:30,height:20},color:'#2468ac'}));source.layers.add(layer);source.selectedLayer=layer;id=layer.id;source.layerSelection.align('center','canvas');});const action=workflow.steps.at(-1)!.action;expect(action.type).toBe('layer.align');if(action.type!=='layer.align')throw new Error('Missing alignment');expect(action.targets[0].by).toBe('stepResult');expect(JSON.stringify(workflow)).not.toContain(id);const next=new Document({width:500,height:200});const result=executeRecipe(workflow,next);expect(result.error).toBeUndefined();expect(next.layers.at(0)!.x).toBe(235);
});
it('runs the documented key-object recipe with an unchanged locked key',async()=>{
 const guide=(await import('node:fs/promises')).readFile('docs/LAYER_ALIGNMENT.md','utf8'),example=(await guide).match(/<!-- example: alignment-key-recipe -->\s*```json\n([\s\S]*?)\n```/)?.[1];if(!example)throw new Error('Missing documented alignment recipe');const a=scene();a.layers[0].name='Artwork';a.layers[1].locked=true;const key=a.layers[1].toJSON();expect(executeRecipe(JSON.parse(example),a.document).success).toBe(true);expect(a.layers[0].x).toBe(190);expect(a.layers[1].toJSON()).toEqual(key);
});
