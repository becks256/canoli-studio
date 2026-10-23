import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {AssetStore} from '../src/core/assets';
import {Document,SmartObjectLayer,RasterLayer,LayerGroup} from '../src/dom';
import {developServerRaw} from '../server/raw';
import {prepareRawDerivation} from '../src/core/interchange/raw/derive';
import {compileEditPlan,executeRecipe} from '../src/ai/recipes/executor';
import {validateRecipe} from '../src/ai/recipes/schema';
import {RecipeRecorder} from '../src/ai/recipes/recorder';
import {rawComponentCommand} from '../src/core/interchange/raw/commands';
import type {Recipe} from '../src/ai/recipes/types';
import type {RawImageSource} from '../src/core/interchange/raw/source';

let source:RawImageSource,png:Blob;
beforeAll(async()=>{
  const original=new Blob([new Uint8Array(await readFile('tests/fixtures/raw/bayer-rggb.dng'))],{type:'image/x-adobe-dng'});
  const result=await prepareRawDerivation(original,'Original.dng',{allowPrecisionLoss:true},{},()=>{},developServerRaw);source=result.source;png=result.png;
});
const recipe=():Recipe=>({schemaVersion:1,id:'raw-recipe',name:'Develop target original',description:'No captured source IDs',version:1,
  parameters:[{name:'ev',label:'Exposure',type:'number',default:1.25,min:-2,max:3}],steps:[{id:'raw',name:'Develop RAW',target:{role:'selected'},action:{type:'raw.develop',development:{exposure:'${ev}',highlightPreservation:0.5},allowPrecisionLoss:true}}]});
function setup(){
  const assets=new AssetStore();assets.installEncoded({id:'accepted',name:'Original.dng',blob:png,width:64,height:48,raw:source});
  const document=new Document({width:64,height:48});document.assetStore=assets;
  document._dispatch({type:'component.set',definition:{id:'master',name:'RAW',source:{kind:'asset',assetId:'accepted',width:64,height:48}}});
  const layer=document.layers.add(new SmartObjectLayer({name:'Target',componentId:'master',width:64,height:48}));document.selectedLayer=layer;
  return {document,assets,layer,plan:(value=recipe())=>compileEditPlan(value,document.toJSON(),layer.id,{},new Set(assets.values().map(a=>a.id)),assets)};
}

it('dry-runs parameterized target-original development without decoding, publishing assets or changing history',()=>{
  const {document,assets,plan}=setup(),before=JSON.stringify(document.getSnapshot()),value=plan();
  expect(validateRecipe(recipe()).valid).toBe(true);expect(value.valid,value.errors.join(';')).toBe(true);
  expect(value.rawDevelopments).toHaveLength(1);expect(value.rawDevelopments![0]).toMatchObject({sourceAssetId:'accepted',options:{allowPrecisionLoss:true,development:{exposure:1.25,highlightPreservation:0.5}}});
  expect(JSON.stringify(document.getSnapshot())).toBe(before);expect(assets.values()).toHaveLength(1);assets.dispose();
});

for(const mode of ['consent','range','unknown','unknown-action','image','plain-raster','locked-dependent']as const)it(`rejects RAW recipe ${mode} before native work`,()=>{
  const {document,assets,layer,plan}=setup(),value=recipe(),action=value.steps[0].action as Extract<Recipe['steps'][number]['action'],{type:'raw.develop'}>;
  if(mode==='consent')(action as any).allowPrecisionLoss=false;
  if(mode==='range')action.development.exposure=99;
  if(mode==='unknown')(action.development as any).notASetting=true;
  if(mode==='unknown-action')(action as any).notAField=true;
  if(mode==='image')action.development.image=100;
  if(mode==='plain-raster'){const raster=document.layers.add(new RasterLayer({assetId:'accepted',width:64,height:48}));value.steps[0].target={by:'name',pattern:raster.name,literal:true};}
  if(mode==='locked-dependent'){const group=document.layers.add(new LayerGroup({name:'Locked owner'}));const other=group.layers.add(new SmartObjectLayer({name:'Shared instance',componentId:layer.componentId,width:64,height:48}));expect(other.isAttached).toBe(true);group.locked=true;}
  const before=JSON.stringify(document.getSnapshot());expect(plan(value).valid).toBe(false);expect(JSON.stringify(document.getSnapshot())).toBe(before);expect(assets.values()).toHaveLength(1);assets.dispose();
});

it('collapses shared targets to one native master operation and chains later RAW steps through private planned sources',()=>{
  const {document,assets,layer,plan}=setup();document.placeSmartObject(layer.componentId).name='Other';
  const value=recipe();value.steps[0].target={by:'kind',kind:'smart-object',allowMultiple:true};value.steps.push({...structuredClone(value.steps[0]),id:'again'});
  const result=plan(value);expect(result.valid,result.errors.join(';')).toBe(true);expect(validateRecipe(value).valid).toBe(true);expect(result.rawDevelopments).toHaveLength(2);
  expect(result.rawDevelopments![1].sourceAssetId).toBe(result.rawDevelopments![0].assetId);assets.dispose();
});

it('synchronous execution explicitly refuses a valid native recipe before applying ordinary preceding commands',()=>{
  const {document,assets}=setup(),value=recipe();value.steps.unshift({id:'name',name:'Rename',action:{type:'document.rename',name:'Must not commit'}});
  const before=JSON.stringify(document.getSnapshot()),result=executeRecipe(value,document);expect(result.success).toBe(false);expect(result.error).toMatch(/executeAsync/);expect(JSON.stringify(document.getSnapshot())).toBe(before);assets.dispose();
});

it('records RAW settings as target semantics, keeps one history boundary, and preserves undo/redo without embedding source IDs',()=>{
  const {document,assets,layer}=setup(),recorder=new RecipeRecorder(id=>assets.get(id));recorder.start(layer.id);
  const after={...source,settings:{...source.settings,development:{...source.settings.development,exposure:1.25,highlightPreservation:0.5}}};
  assets.installEncoded({id:'later-output',name:'Developed',blob:png,width:64,height:48,raw:after});
  const before=document.toJSON(),command=rawComponentCommand(before,layer.id,{id:'later-output',width:64,height:48});document._dispatch(command);recorder.recordCommand(command,before,document.toJSON());
  expect(recorder.getRecordedSteps()).toHaveLength(1);recorder.navigateHistory('undo');expect(recorder.getRecordedSteps()).toHaveLength(0);recorder.navigateHistory('redo');expect(recorder.getRecordedSteps()).toHaveLength(1);
  const saved=recorder.stop({name:'Portable development'});expect(validateRecipe(saved).valid).toBe(true);expect(saved.steps[0]).toMatchObject({target:{role:'selected'},action:{type:'raw.develop',allowPrecisionLoss:true,development:{exposure:1.25}}});
  expect(JSON.stringify(saved)).not.toContain('accepted');expect(JSON.stringify(saved)).not.toContain('later-output');expect(JSON.stringify(saved)).not.toContain(source.original.sha256);assets.dispose();
});
