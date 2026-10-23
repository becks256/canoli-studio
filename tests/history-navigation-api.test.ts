import {beforeAll, afterAll, it, expect} from 'vitest';
import type {AddressInfo} from 'node:net';
import {createApiServer} from '../server/app';
import {Document} from '../src/dom';

const server = createApiServer(); let base: string;
beforeAll(async () => {await new Promise<void>((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);}); base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1`;});
afterAll(async () => {if (server.listening) await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));});
async function request(path: string, data?: unknown) {
  const response = await fetch(base + path, {method: data === undefined ? 'GET' : 'POST', headers: {'Content-Type': 'application/json'}, ...(data === undefined ? {} : {body: JSON.stringify(data)})});
  return {status: response.status, body: await response.json()};
}
it('lists and inspects retained history and navigates atomically with expected revisions', async () => {
  const created = await request('/documents', {name: 'Initial', width: 100, height: 80}), path = '/documents/' + created.body.document.id;
  let current = created;
  for (const name of ['First', 'Second', 'Third']) current = await request(path + '/commands', {expectedRevision: current.body.revision, commands: [{type: 'document.rename', name}]});
  const timeline = await request(path + '/history'); expect(timeline.status).toBe(200);
  expect(timeline.body).toMatchObject({position: 3, length: 4, revision: current.body.revision});
  const inspected = await request(path + '/history?position=2'); expect(inspected.body.change.documentFields).toEqual(['name']);
  const moved = await request(path + '/history', {expectedRevision: current.body.revision, position: 0});
  expect(moved.status).toBe(200); expect(moved.body.document.name).toBe('Initial'); expect(moved.body.revision).toBe(current.body.revision + 1); expect(moved.body.canRedo).toBe(true);
  const stale = await request(path + '/history', {expectedRevision: current.body.revision, position: 3}); expect(stale.status).toBe(409);
  const restored = await request(path + '/history', {expectedRevision: moved.body.revision, position: 3});
  expect(restored.body.document).toEqual(current.body.document); expect(restored.body.canUndo).toBe(true);
  const noop = await request(path + '/history', {expectedRevision: restored.body.revision, position: 3}); expect(noop.body.revision).toBe(restored.body.revision);
  for (const position of [-1, 4, 0.5, '0', null]) {
    const invalid = await request(path + '/history', {expectedRevision: restored.body.revision, position}); expect(invalid.status).toBe(400);
    expect((await request(path)).body).toEqual(restored.body);
  }
  expect((await request(path + '/history?position=999')).status).toBe(400);
  expect((await request(path + '/history/unknown')).status).not.toBe(200);
});

it('reports accepted navigation with a warning when an observer fails after publication', async () => {
  const created = await request('/documents', {name: 'Before'}), path = '/documents/' + created.body.document.id;
  const changed = await request(path + '/commands', {expectedRevision: 0, commands: [{type: 'document.rename', name: 'After'}]});
  const original = Document.prototype.navigateHistory;
  Document.prototype.navigateHistory = function(position) {
    const stop = this.subscribe(() => {throw undefined;});
    try {original.call(this, position);} finally {stop();}
  };
  try {
    const moved = await request(path + '/history', {expectedRevision: changed.body.revision, position: 0});
    expect(moved.status).toBe(200); expect(moved.body.warning).toMatch(/History moved/);
    expect(moved.body.document.name).toBe('Before'); expect(moved.body.revision).toBe(changed.body.revision + 1);
    const redone = await request(path + '/redo', {expectedRevision: moved.body.revision});
    expect(redone.status).toBe(200); expect(redone.body.warning).toMatch(/History moved/); expect(redone.body.document.name).toBe('After');
  } finally {Document.prototype.navigateHistory = original;}
});

it('creates, checks out, renames and deletes independent revision-checked history branches', async () => {
  const created = await request('/documents', {name:'Main artwork'}), path = '/documents/' + created.body.document.id;
  const fork = await request(path + '/history-branches', {expectedRevision:0, action:'create', name:'Candidate'});
  expect(fork.status).toBe(200); expect(fork.body.branches).toHaveLength(2);
  const candidate = fork.body.activeBranchId, main = fork.body.branches.find((branch:{name:string}) => branch.name === 'Main').id;
  const changed = await request(path + '/commands', {expectedRevision:fork.body.revision, commands:[{type:'document.rename', name:'Candidate artwork'}]});
  const stale = await request(path + '/history-branches', {expectedRevision:fork.body.revision, action:'checkout', branchId:main}); expect(stale.status).toBe(409);
  const switched = await request(path + '/history-branches', {expectedRevision:changed.body.revision, action:'checkout', branchId:main});
  expect(switched.body.document.name).toBe('Main artwork'); expect(switched.body.activeBranchId).toBe(main);
  const renamed = await request(path + '/history-branches', {expectedRevision:switched.body.revision, action:'rename', branchId:candidate, name:'Approved'});
  expect(renamed.body.branches.some((branch:{name:string}) => branch.name === 'Approved')).toBe(true);
  const rejected = await request(path + '/history-branches', {expectedRevision:renamed.body.revision, action:'delete', branchId:main}); expect(rejected.status).toBe(400);
  const restored = await request(path + '/history-branches', {expectedRevision:renamed.body.revision, action:'checkout', branchId:candidate}); expect(restored.body.document.name).toBe('Candidate artwork');
  const undo = await request(path + '/undo', {expectedRevision:restored.body.revision}); expect(undo.body.document.name).toBe('Main artwork');
  const latest = await request(path + '/history-branches', {expectedRevision:undo.body.revision, action:'checkout', branchId:candidate}); expect(latest.body.document.name).toBe('Candidate artwork');
  const back = await request(path + '/history-branches', {expectedRevision:latest.body.revision, action:'checkout', branchId:main});
  const removed = await request(path + '/history-branches', {expectedRevision:back.body.revision, action:'delete', branchId:candidate}); expect(removed.body.branches).toHaveLength(1);
  expect((await request(path + '/history-branches')).body.branches).toHaveLength(1);
  for (const payload of [
    {action:'create', name:'Bad', extra:1}, {action:'rename', branchId:main, name:''}, {action:'checkout', branchId:'invalid'}, {action:'execute', branchId:main},
  ]) expect((await request(path + '/history-branches', {expectedRevision:removed.body.revision, ...payload})).status).toBe(400);
});

it('creates, inspects, updates and restores saved comparison states with independent revision checks', async()=>{
 const created=await request('/documents',{name:'Before',width:100,height:80}),path='/documents/'+created.body.document.id;
 const changed=await request(path+'/commands',{expectedRevision:0,commands:[{type:'document.rename',name:'After'}]});
 const saved=await request(path+'/history-comparisons',{expectedRevision:changed.body.revision,action:'create',name:'Saved sides',before:{kind:'timeline',position:0},after:{kind:'current'},region:{x:10,y:5,width:20,height:30}});
 expect(saved.status).toBe(200);const id=saved.body.comparisons[0].id;expect(saved.body.document.name).toBe('After');expect(saved.body.activeBranchId).toBeNull();
 const inspected=await request(path+'/history-comparisons/'+id);expect(inspected.body.change.documentFields).toEqual(['name']);expect(inspected.body.comparison.region).toEqual({x:10,y:5,width:20,height:30});
 const stale=await request(path+'/history-comparisons',{expectedRevision:changed.body.revision,action:'delete',comparisonId:id});expect(stale.status).toBe(409);
 const updated=await request(path+'/history-comparisons',{expectedRevision:saved.body.revision,action:'update',comparisonId:id,changes:{name:'Reviewed'}});expect(updated.body.comparisons[0].name).toBe('Reviewed');
 const restored=await request(path+'/history-comparisons',{expectedRevision:updated.body.revision,action:'branch',comparisonId:id,side:'before',name:'Restored before'});expect(restored.body.document.name).toBe('Before');expect(restored.body.canUndo).toBe(false);expect(restored.body.activeBranchId).toMatch(/.+/);
 const removed=await request(path+'/history-comparisons',{expectedRevision:restored.body.revision,action:'delete',comparisonId:id});expect(removed.body.comparisons).toEqual([]);
 expect((await request(path+'/history-comparisons')).body.comparisons).toEqual([]);expect((await request(path+'/history-comparisons/'+id)).status).toBe(400);
 for(const payload of [{action:'create',name:'Bad',before:{kind:'current',extra:1},after:{kind:'current'}},{action:'update',comparisonId:id,changes:{extra:1}},{action:'branch',comparisonId:id,side:'constructor',name:'Bad'}])expect((await request(path+'/history-comparisons',{expectedRevision:removed.body.revision,...payload})).status).toBe(400);
});
