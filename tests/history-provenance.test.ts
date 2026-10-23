import {it,expect,vi} from 'vitest';
import {Document,PaintLayer} from '../src/dom';
import {captureRetainedHistory,captureProjectHistory,parseRetainedHistory} from '../src/core/history';
import {historyTimeline} from '../src/core/history-inspection';
import {serializeProject,readProject} from '../src/core/project';

it('records only accepted changed commands with actual context, identity, local time and submitted leaf types',()=>{
 const time=vi.spyOn(Date,'now').mockReturnValue(1700000000123);
 try{
  const doc=new Document(),start=doc.getSnapshot();expect(start.provenance.current).toBeNull();
  doc._withHistoryOrigin({surface:'script',executionId:'73573912-61ac-45cd-bd38-1c8c7f3d77c9'},()=>doc.transaction('Actual batch',()=>{doc.name='Accepted';doc.resize(240,120);}));
  const state=doc.getSnapshot(),operation=state.provenance.current!;
  expect(operation).toMatchObject({documentId:doc.id,acceptedRevision:1,recordedAt:1700000000123,label:'Actual batch',commandCount:2,commandTypes:['document.rename','document.resize'],origin:{surface:'script'}});
  expect(operation.id).toMatch(/^[0-9a-f-]{36}$/);expect(operation.sessionId).toMatch(/^[0-9a-f-]{36}$/);expect(doc._isHistoryOperationObserved(operation)).toBe(true);
  expect(Reflect.set(operation.origin,'surface','rest')).toBe(false);expect(Reflect.set(operation,'recordedAt',0)).toBe(false);
  doc.name='Accepted';expect(doc.getSnapshot()).toBe(state);
  expect(()=>doc.transaction('Failed',()=>{doc.name='Must roll back';throw Error('Stop');})).toThrow('Stop');expect(doc.getSnapshot()).toBe(state);
  doc.name='Later';expect(doc.getSnapshot().provenance.current!.origin.surface).toBe('host');
 }finally{time.mockRestore();}
});
it('preserves exact operation references through every retained navigation pair without rerecording time',()=>{
 const doc=new Document();const points=[null];for(const name of ['First','Second','Third']){doc.name=name;points.push(doc.getSnapshot().provenance.current as never);}
 const clock=vi.spyOn(Date,'now');try{for(const position of [0,3,1,2,0,2,3]){doc.navigateHistory(position);expect(doc.getSnapshot().provenance.current).toBe(points[position]);expect(historyTimeline(doc.getSnapshot()).map(value=>value.operation)).toEqual(points);}expect(clock).not.toHaveBeenCalled();}finally{clock.mockRestore();}
});
it('retains provenance independently in branches and pinned comparisons after pruning and continuation',()=>{
 const doc=new Document();doc.name='Original';const first=doc.getSnapshot().provenance.current!;const branch=doc.createHistoryBranch('Alternative');doc.name='Alternative result';const second=doc.getSnapshot().provenance.current!;
 const id=doc.createHistoryComparison('Pinned',{kind:'timeline',position:1},{kind:'current'});const main=doc.getSnapshot().branches.find(value=>value.name==='Main')!;
 doc.checkoutHistoryBranch(main.id);doc.deleteHistoryBranch(branch);for(let i=0;i<70;i++)doc.name=`Later ${i}`;
 const captured=doc.getSnapshot().comparisons[0];expect(captured.beforeProvenance).toBe(first);expect(captured.afterProvenance).toBe(second);expect(doc._isHistoryOperationObserved(second)).toBe(true);
 doc.createHistoryBranchFromComparison(id,'after','Continued');expect(doc.name).toBe('Alternative result');expect(doc.canUndo).toBe(false);expect(doc.getSnapshot().provenance.current).toBe(second);
 const history=captureRetainedHistory(doc.getSnapshot());expect(history.version).toBe(4);expect(()=>parseRetainedHistory(history,doc.toJSON())).not.toThrow();
});
it('keeps legacy origins unknown and never derives provenance from labels',()=>{
 const doc=new Document();doc.name='Current';const state=doc.getSnapshot();
 const restored=Document._fromWorkspace(doc.toJSON(),{version:1,past:state.past.map(entry=>({...entry,label:'Alice / AI / 2001-01-01'})),future:[]});
 expect(historyTimeline(restored.getSnapshot()).every(value=>value.operation===null)).toBe(true);expect(captureRetainedHistory(restored.getSnapshot()).version).toBe(1);
 restored.undo();expect(restored.getSnapshot().provenance.current).toBeNull();restored.name='New accepted edit';expect(restored.getSnapshot().provenance.current!.origin.surface).toBe('host');
});
it('preserves current-result attribution in ordinary files without adding an undo path and distrusts imported records',async()=>{
 const doc=new Document();doc.name='First';doc.name='Saved';const original=doc.getSnapshot().provenance.current!,history=captureProjectHistory(doc.getSnapshot());
 expect(history).toMatchObject({version:4,past:[],future:[],provenance:{current:{id:original.id}}});
 const loaded=await readProject(await serializeProject(doc.toJSON(),{get(){throw Error('No images');}},history)),restored=Document._fromWorkspace(loaded.document,loaded.history);
 expect(restored.canUndo).toBe(false);expect(restored.getSnapshot().provenance.current).toEqual(original);expect(restored._isHistoryOperationObserved(restored.getSnapshot().provenance.current!)).toBe(false);
 restored.name='New session';expect(restored.getSnapshot().provenance.current!.sessionId).not.toBe(original.sessionId);expect(restored._isHistoryOperationObserved(restored.getSnapshot().provenance.current!)).toBe(true);restored.undo();expect(restored.getSnapshot().provenance.current!.id).toBe(original.id);expect(restored._isHistoryOperationObserved(restored.getSnapshot().provenance.current!)).toBe(false);
});
it('strictly validates provenance alignment, identity consistency, owners and unsupported trust claims before restoration',()=>{
 const doc=new Document();doc.name='First';doc.name='Second';doc.createHistoryComparison('Duplicate result',{kind:'current'},{kind:'current'});const history=captureRetainedHistory(doc.getSnapshot());if(history.version!==4)throw Error('Expected provenance');
 const bad=[
  (h:typeof history)=>{h.provenance.past.pop();},
  (h:typeof history)=>{h.provenance.current!.documentId=crypto.randomUUID();},
  (h:typeof history)=>{h.provenance.current!.recordedAt=Infinity;},
  (h:typeof history)=>{h.provenance.current!.origin.surface='human' as never;},
  (h:typeof history)=>{Object.assign(h.provenance.current!,{authenticated:true});},
  (h:typeof history)=>{h.provenance.current!.commandCount=0;},
  (h:typeof history)=>{h.provenance.current!.id=h.provenance.past[1]!.id;},
  (h:typeof history)=>{h.comparisons[0].after.name='Forged result';},
 ];for(const corrupt of bad){const h=structuredClone(history);corrupt(h);expect(()=>Document._fromWorkspace(doc.toJSON(),h)).toThrow();}
});
it('keeps accepted command provenance and every observer notification after failures and rejects model reentrancy',()=>{
 const doc=new Document();let recorded=0,subscribed=0;
 doc.subscribe(()=>{doc.name='Forbidden nested edit';});doc.subscribe(()=>{subscribed++;});doc.onCommand(()=>{throw undefined;});doc.onCommand((_command,_before,after)=>{recorded++;expect(after.name).toBe('Accepted');});
 expect(()=>doc._withHistoryOrigin({surface:'rest'},()=>{doc.name='Accepted';})).toThrow(/Command accepted.*observer failed/);
 expect(doc.name).toBe('Accepted');expect(doc.getSnapshot().revision).toBe(1);expect(doc.getSnapshot().provenance.current).toMatchObject({origin:{surface:'rest'},commandCount:1});expect(recorded).toBe(1);expect(subscribed).toBe(1);
});
it('gives command subscribers independent owned snapshots without changing live state or attribution',()=>{
 const doc=new Document();doc.onCommand((command,before,after)=>{Object.assign(command,{type:'forged'});before.name='Before forged';after.name='After forged';});let observed='';doc.onCommand((command,before,after)=>{observed=after.name;expect(command.type).toBe('document.rename');expect(before.name).not.toBe('Before forged');});doc.name='Genuine';expect(observed).toBe('Genuine');expect(doc.name).toBe('Genuine');expect(doc.getSnapshot().provenance.current!.commandTypes).toEqual(['document.rename']);
});
it('does not let asynchronous scope misuse leak a claimed origin into later edits',()=>{
 const doc=new Document();expect(()=>doc._withHistoryOrigin({surface:'script'},()=>Promise.resolve())).toThrow(/synchronous/);doc.layers.add(new PaintLayer());expect(doc.getSnapshot().provenance.current!.origin.surface).toBe('host');
});

it('reports an accepted recipe honestly when a subscriber throws and keeps the executed recipe identity',async()=>{
 const {executeRecipe}=await import('../src/ai/recipes/executor');const doc=new Document();doc._setDefaultHistoryOrigin({surface:'editor'});doc.subscribe(()=>{throw Error('Observer failure');});
 const result=executeRecipe({schemaVersion:1,id:'executed-recipe',version:7,name:'Observed recipe',description:'Test actual compiler',parameters:[],steps:[{id:'add',name:'Add',action:{type:'layer.add',layerTemplate:{kind:'paint',name:'Recipe layer'}}}]},doc);
 expect(result.success).toBe(true);expect(result.warning).toMatch(/Recipe accepted/);expect(result.error).toBeUndefined();expect(doc.layers.length).toBe(1);expect(doc.getSnapshot().provenance.current).toMatchObject({origin:{surface:'editor',recipe:{id:'executed-recipe',version:7}},commandCount:1,commandTypes:['layer.add']});
});

it('records secure UUIDs in opaque-origin runtimes without crypto.randomUUID',()=>{
 const nativeCrypto=globalThis.crypto;
 vi.stubGlobal('crypto',{getRandomValues:nativeCrypto.getRandomValues.bind(nativeCrypto)});
 try{const doc=new Document();doc.name='Opaque-origin edit';const operation=doc.getSnapshot().provenance.current!;
  expect(operation.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(operation.sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  expect(operation.id).not.toBe(operation.sessionId);
 }finally{vi.unstubAllGlobals();}
});
