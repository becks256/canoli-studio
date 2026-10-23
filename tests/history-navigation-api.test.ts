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
