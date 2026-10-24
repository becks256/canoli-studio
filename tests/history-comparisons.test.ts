import {it, expect} from 'vitest';
import {Document, PaintLayer, RasterLayer} from '../src/dom';
import {captureRetainedHistory, parseRetainedHistory, retainedDocuments} from '../src/core/history';
import {historyBranchTree} from '../src/core/history-inspection';
import {compareHistoryPixels} from '../src/engine/history-comparison';
import {readProject, serializeProject} from '../src/core/project';
const current = {kind:'current'} as const;

it('pins nonadjacent accepted states without changing artwork, selection, undo or canvas invalidation', () => {
 const doc=new Document({width:100,height:80});doc.layers.add(new PaintLayer({name:'Target'}));doc.selectedLayer=doc.layers.at(0);doc.name='Second';
 const before=doc.getSnapshot();let notifications=0;doc.subscribe(()=>{notifications++;});
 const id=doc.createHistoryComparison(' Candidate ',{kind:'timeline',position:0},current,{x:10,y:5,width:30,height:20});
 const after=doc.getSnapshot();expect(after.document).toBe(before.document);expect(after.past).toBe(before.past);expect(after.future).toBe(before.future);expect(after.selectedIds).toEqual(before.selectedIds);expect(after.canvasRevision).toBe(before.canvasRevision);expect(after.revision).toBe(before.revision+1);expect(notifications).toBe(1);
 const saved=after.comparisons.find(value=>value.id===id)!;expect(saved.before.children).toHaveLength(0);expect(saved.after).toBe(before.document);expect(saved.name).toBe('Candidate');expect(Reflect.set(saved.before,'name','Forbidden')).toBe(false);expect(Reflect.set(saved.region,'x',99)).toBe(false);
 expect(captureRetainedHistory(after)).toMatchObject({version:4,branches:[],activeBranchId:null});
});
it('preserves both states after pruning and branch deletion, and continues either side as an exact branch', () => {
 const doc=new Document();doc.name='Shared';const other=doc.createHistoryBranch('Alternative');doc.name='Alternative result';const original=doc.toJSON();
 const main=doc.getSnapshot().branches.find(branch=>branch.name==='Main')!;
 const id=doc.createHistoryComparison('Sides',{kind:'branch',branchId:other},{kind:'branch',branchId:main.id});
 doc.checkoutHistoryBranch(main.id);doc.deleteHistoryBranch(other);for(let i=0;i<75;i++)doc.name=`Later ${i}`;
 const final=doc.toJSON(), revision=doc.getSnapshot().revision, saved=doc.getSnapshot().comparisons[0];expect(saved.before).toEqual(original);expect(saved.after.name).toBe('Shared');
 const branch=doc.createHistoryBranchFromComparison(id,'before','Restored');expect(doc.toJSON()).toEqual(original);expect(doc.canUndo).toBe(false);expect(doc.getSnapshot().activeBranchId).toBe(branch);expect(doc.getSnapshot().revision).toBe(revision+1);
 doc.name='Edited restored';doc.undo();expect(doc.toJSON()).toEqual(original);doc.checkoutHistoryBranch(main.id);expect(doc.toJSON()).toEqual(final);
 doc.createHistoryBranchFromComparison(id,'after','Other side');expect(doc.name).toBe('Shared');expect(doc.getSnapshot().comparisons[0]).toBe(saved);
});
it('validates names, references, common-plane regions and synchronous transaction boundaries atomically', () => {
 const doc=new Document({width:100,height:80});doc.resize(200,40);
 const state=doc.getSnapshot();
 const bad=[
 ()=>doc.createHistoryComparison('',current,current),
 ()=>doc.createHistoryComparison('Bad',{kind:'timeline',position:5},current),
 ()=>doc.createHistoryComparison('Bad',{kind:'branch',branchId:crypto.randomUUID()},current),
 ()=>doc.createHistoryComparison('Bad',current,current,null as never),
 ()=>doc.createHistoryComparison('Bad',current,current,{x:190,y:0,width:11,height:1}),
 ()=>doc.createHistoryComparison('Bad',current,current,{x:0,y:0,width:0,height:1}),
 ()=>doc.createHistoryComparison('Bad',current,current,{x:0.5,y:0,width:1,height:1}),
 ()=>doc.transaction('No history metadata',()=>{doc.name='Must roll back';doc.createHistoryComparison('Bad',current,current);}),
 ];
 for(const run of bad){expect(run).toThrow();expect(doc.getSnapshot()).toBe(state);}
 const id=doc.createHistoryComparison('Common',{kind:'timeline',position:0},current,{x:150,y:50,width:50,height:30});
 expect(doc.getSnapshot().comparisons[0].region).toEqual({x:150,y:50,width:50,height:30});
 const accepted=doc.getSnapshot();expect(()=>doc.createHistoryComparison('ＣＯＭＭＯＮ',current,current)).toThrow(/already exists/);expect(()=>doc.updateHistoryComparison(id,{region:{x:200,y:0,width:1,height:1}})).toThrow(/extent/);expect(doc.getSnapshot()).toBe(accepted);
 doc.updateHistoryComparison(id,{});expect(doc.getSnapshot()).toBe(accepted);
 expect(()=>doc.createHistoryBranchFromComparison(id,'constructor' as never,'Bad')).toThrow(/before or after/);expect(doc.getSnapshot()).toBe(accepted);
});
it('updates and deletes comparison metadata independently of artwork undo and retains accepted changes after observer errors', () => {
 const doc=new Document();doc.name='Accepted';const id=doc.createHistoryComparison('First',current,current);const undo=doc.getSnapshot().past;
 doc.updateHistoryComparison(id,{name:'Reviewed',region:{x:1,y:2,width:20,height:30}});expect(doc.getSnapshot().past).toBe(undo);
 const off=doc.subscribe(()=>{throw undefined;});let notified=0;doc.subscribe(()=>{notified++;});expect(()=>doc.updateHistoryComparison(id,{name:'Accepted rename'})).toThrow(/comparison changed.*observer failed/);expect(doc.getSnapshot().comparisons[0].name).toBe('Accepted rename');expect(notified).toBe(1);off();
 doc.deleteHistoryComparison(id);expect(doc.getSnapshot().comparisons).toEqual([]);expect(captureRetainedHistory(doc.getSnapshot()).version).toBe(4);doc.undo();expect(doc.name).not.toBe('Accepted');expect(doc.getSnapshot().comparisons).toEqual([]);
});
it('notifies branch observers and rejects reentrant mutations when continuing a comparison', () => {
 const doc=new Document();doc.name='Named';const id=doc.createHistoryComparison('Previous',{kind:'timeline',position:0},current);let switches=0;
 doc.onHistoryBranchSwitch(()=>{switches++;expect(doc.name).not.toBe('Named');expect(()=>doc.createHistoryComparison('Reentrant',current,current)).toThrow(/Finish history/);});
 doc.createHistoryBranchFromComparison(id,'before','Previous artwork');expect(switches).toBe(1);
});
it('strictly admits comparison-bearing histories and migrates every pinned model', () => {
 const doc=new Document();doc.name='Latest';doc.createHistoryComparison('Pinned',{kind:'timeline',position:0},current);const captured=captureRetainedHistory(doc.getSnapshot());if(captured.version!==4)throw Error('Missing comparison');
 const corruptions=[
  (h:typeof captured)=>{h.activeBranchId=crypto.randomUUID();},
  (h:typeof captured)=>{h.comparisons[0].before.id=crypto.randomUUID();},
  (h:typeof captured)=>{h.comparisons[0].region.width=Number.MAX_SAFE_INTEGER;},
  (h:typeof captured)=>{h.comparisons.push(structuredClone(h.comparisons[0]));},
  (h:typeof captured)=>{h.comparisons.push({...structuredClone(h.comparisons[0]),id:crypto.randomUUID(),name:'ＰＩＮＮＥＤ'});},
  (h:typeof captured)=>{h.comparisons[0].after.width=-1;},
 ];
 for(const corrupt of corruptions){const h=structuredClone(captured);corrupt(h);expect(()=>parseRetainedHistory(h,doc.toJSON())).toThrow();}
 const h=structuredClone(captured), data=doc.toJSON();data.schemaVersion=12;for(const value of retainedDocuments(data,h))value.schemaVersion=12;
 const restored=Document._fromWorkspace(data,h);expect(restored.getSnapshot().comparisons.every(value=>value.before.schemaVersion===42&&value.after.schemaVersion===42)).toBe(true);
});
it('includes images retained only by saved comparisons in native source closure and round trips', async () => {
 const doc=new Document({width:10000,height:5000});doc.layers.add(new RasterLayer({assetId:'comparison-only',width:10000,height:5000}));const image=doc.toJSON();doc.layers.at(0)!.remove();
 const id=doc.createHistoryComparison('Original versus empty',{kind:'timeline',position:1},current);for(let i=0;i<65;i++)doc.name=`Prune ${i}`;
 const state=doc.getSnapshot();expect([state.document,...state.past.map(value=>value.document)].every(value=>!value.children.length)).toBe(true);expect(state.branches).toEqual([]);
 const asset={id:'comparison-only',name:'Original',width:10000,height:5000,blob:new Blob([new Uint8Array([137,80,78,71,1,2,3,4])],{type:'image/png'})};
 const result=await readProject(await serializeProject(doc.toJSON(),{get:()=>asset},captureRetainedHistory(state)));expect(result.history?.version).toBe(4);expect(result.entries).toHaveLength(1);
 const restored=Document._fromWorkspace(result.document,result.history);restored.createHistoryBranchFromComparison(id,'before','Original restored');expect(restored.toJSON()).toEqual(image);
});
it('compares displayed premultiplied color and alpha and creates exact opaque magenta differences', async () => {
 const before=new Uint8ClampedArray([255,0,0,255,255,255,255,0,0,0,0,255]),after=new Uint8ClampedArray([0,0,255,255,0,0,0,0,0,0,0,0]);
 const result=await compareHistoryPixels(before,after,3,1);expect(Array.from(result.pixels)).toEqual([255,0,255,255,0,0,0,255,255,0,255,255]);
 expect(result.statistics).toEqual({comparedPixels:3,changedPixels:2,maximumChannelDelta:255,meanAbsoluteChannelDelta:63.75});
 await expect(compareHistoryPixels(before,after,2,1)).rejects.toThrow(/Invalid/);
 let checks=0;await expect(compareHistoryPixels(new Uint8ClampedArray(32*32*4),new Uint8ClampedArray(32*32*4),32,32,()=>{if(++checks===2)throw Error('Cancelled');})).rejects.toThrow('Cancelled');
});
it('presents branch ancestry iteratively in parent order for deep graphs', () => {
 const tip={document:new Document().toJSON(),past:[]}, branches=Array.from({length:2000},(_,i)=>({id:String(i),name:`Branch ${i}`,parentId:i?String(i-1):null,forkDocument:tip.document,tip}));
 const tree=historyBranchTree(branches.reverse());expect(tree).toHaveLength(2000);expect(tree[0]).toMatchObject({id:'0',depth:0});expect(tree.at(-1)).toMatchObject({id:'1999',depth:1999,parentId:'1998'});
});
