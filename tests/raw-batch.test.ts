import {beforeAll,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {inspectServerRaw} from '../server/raw';
import {rawDecodeOptionsSchema} from '../src/core/interchange/raw/types';
import {batchRawSourceSchema,prepareRawBatchSource} from '../src/ai/batch/raw';
import {BatchStorage} from '../src/ai/batch/storage';
import {BatchRunnerService} from '../src/ai/batch/service';
import {BatchRunner} from '../src/ai/batch/runner';
import {BudgetLedger} from '../src/ai/jobs/ledger';
import {rawBlobHash} from '../src/core/interchange/raw/source';
import {preparationInputs} from '../src/ai/batch/preparation';
import {validateBatchItem} from '../src/ai/batch/schema';
import type {BatchRawSource} from '../src/ai/batch/raw';
import type {BatchRun} from '../src/ai/batch/types';
const metadataRenderer={render:async()=>{throw new Error('Metadata fixtures do not render pixels.');}}as unknown as import('../src/engine/renderer').DocumentRenderer;
let blob:Blob,raw:BatchRawSource;
beforeAll(async()=>{blob=new Blob([new Uint8Array(await readFile('tests/fixtures/raw/bayer-rggb.dng'))],{type:'image/x-adobe-dng'});raw={version:1,originalName:'Original.dng',options:rawDecodeOptionsSchema.parse({allowPrecisionLoss:true}),report:await inspectServerRaw(blob)};});
function run():BatchRun{return {id:'raw-unit',config:{id:'raw-unit',name:'RAW',budgetId:'local',variants:[{id:'png',name:'PNG',format:'png',targetWidth:64,targetHeight:48,fit:'fill'}],concurrency:1,budgetCeilingCents:0,stopOnFirstFailure:false,outputNamingTemplate:'{name}'},items:[{id:'item',name:'Original',source:{id:'src',name:'Original.dng',mimeType:blob.type,byteLength:blob.size,blob,width:64,height:48,raw},status:'running',reviewState:'unreviewed',estimatedCostCents:0,actualCostCents:0,deliverables:[],retryCount:0}],status:'running',summary:{total:1,pending:0,running:1,succeeded:0,failed:0,skipped:0,cancelled:0,totalActualCostCents:0,totalEstimatedCostCents:0,approvedCount:0,rejectedCount:0,flaggedCount:0},createdAt:'2026-10-22',updatedAt:'2026-10-22'};}
async function scene(){const blob=new Blob(['A prepared scene for the storage contract']),sha256=await rawBlobHash(blob);return {blob,metadata:{version:1 as const,sha256,byteLength:blob.size,inputsSha256:'a'.repeat(64)}};}
it('validates reviewed RAW settings without claiming accepted pixels or a browser surface',()=>{
  expect(batchRawSourceSchema.parse(raw)).toEqual(raw);const value=run();expect(validateBatchItem(value.items[0]).valid).toBe(true);
  for(const changed of [{...raw,options:{...raw.options,allowPrecisionLoss:false}},{...raw,options:{...raw.options,development:{...raw.options.development,exposure:99}}},{...raw,options:{...raw.options,development:{...raw.options.development,image:1}}}])expect(batchRawSourceSchema.safeParse(changed).success).toBe(false);
  expect('bitmap'in raw).toBe(false);expect('outputSha256'in raw).toBe(false);
});
it('requires explicit RAW consent before inspection and rejects unreviewed RAW batch inputs before publication',async()=>{
  await expect(prepareRawBatchSource(new File([blob],'Source.dng'))).rejects.toThrow(/consent/);
  const storage=new BatchStorage(),service=new BatchRunnerService({storage,budgetLedger:new BudgetLedger(),recipes:{}as any,renderer:metadataRenderer});
  const value=run(),source={...value.items[0].source};delete source.raw;
  await expect(service.createBatch({name:'Missing review',budgetId:'local',variants:value.config.variants},[source])).rejects.toThrow(/Review RAW/);
  expect(await storage.listRuns()).toEqual([]);service.dispose();
});
it('preflights semantic RAW recipes against native metadata and permits zero-provider-cost local processing without budget approval',async()=>{
  const value=run();value.config.recipeId='develop';value.config.recipeSnapshot={schemaVersion:1,id:'develop',name:'RAW',description:'Local',version:1,parameters:[],steps:[{id:'raw',name:'Develop',target:{role:'selected'},action:{type:'raw.develop',allowPrecisionLoss:true,development:{exposure:1.25}}}]};
  const runner=new BatchRunner({storage:new BatchStorage(),budgetLedger:new BudgetLedger(),recipes:{}as any,renderer:metadataRenderer});
  expect(await runner.estimateBatch(value.config,value.items)).toMatchObject({approved:true,totalEstimatedCostCents:0});
  value.items[0].estimatedCostCents=1;expect(await runner.estimateBatch(value.config,value.items)).toMatchObject({approved:false});runner.dispose();
});
it('publishes prepared project bytes and metadata together, guards cancellation, and never replaces an accepted scene',async()=>{
  const storage=new BatchStorage(),value=run(),prepared=await scene();await storage.createRun(value);
  await expect(storage.commitPreparation(value.id,'item',new Blob(['wrong']),prepared.metadata)).rejects.toThrow(/integrity/);expect((await storage.getRun(value.id))!.items[0].preparation).toBeUndefined();expect(await storage.getDeliverableBlob('prepared-item')).toBeNull();
  await storage.commitPreparation(value.id,'item',prepared.blob,prepared.metadata);expect((await storage.getRun(value.id))!.items[0].preparation).toEqual(prepared.metadata);expect(await(await storage.getDeliverableBlob('prepared-item'))!.text()).toBe(await prepared.blob.text());
  await expect(storage.commitPreparation(value.id,'item',prepared.blob,prepared.metadata)).rejects.toThrow(/already/);
  await storage.deleteRun(value.id);expect(await storage.getDeliverableBlob('prepared-item')).toBeNull();
  value.status='cancelled';await storage.createRun(value);await expect(storage.commitPreparation(value.id,'item',prepared.blob,prepared.metadata)).rejects.toThrow(/no longer/);expect(await storage.getDeliverableBlob('prepared-item')).toBeNull();
});
it('reclamation retains referenced prepared scenes and refuses malformed preparation metadata before deleting any bytes',async()=>{
  const storage=new BatchStorage(),value=run(),prepared=await scene();await storage.createRun(value);await storage.commitPreparation(value.id,'item',prepared.blob,prepared.metadata);await storage.saveDeliverableBlob('orphan',new Blob(['unused']));
  expect((await storage.reclaimUnusedBlobs()).removedCount).toBe(1);expect(await storage.getDeliverableBlob('prepared-item')).not.toBeNull();
  const stored=(await storage.getRun(value.id))!;stored.items[0].preparation={...prepared.metadata,sha256:'invalid'};await storage.saveRun(stored);await storage.saveDeliverableBlob('leave-untouched',new Blob(['Important']));
  await expect(storage.reclaimUnusedBlobs()).rejects.toThrow();expect(await storage.getDeliverableBlob('leave-untouched')).not.toBeNull();
});
it('binds accepted scene identity to source/settings/recipe/parameters while allowing additional output variants',async()=>{
  const value=run();value.items[0].source.sha256=await rawBlobHash(blob);const expected=await preparationInputs(value.config,value.items[0]);
  value.config.variants.push({...value.config.variants[0],id:'other'});expect(await preparationInputs(value.config,value.items[0])).toBe(expected);
  value.items[0].parameters={exposure:1};expect(await preparationInputs(value.config,value.items[0])).not.toBe(expected);
  delete value.items[0].parameters;value.items[0].source.raw={...raw,options:rawDecodeOptionsSchema.parse({allowPrecisionLoss:true,development:{exposure:1}})};expect(await preparationInputs(value.config,value.items[0])).not.toBe(expected);
});
