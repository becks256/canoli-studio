import {expect,it} from 'vitest';
import {Document,LayerGroup,TextLayer} from '../src/dom';
import {createDocument,createGroup,createText,findLayer,isLocked} from '../src/core/model';
import {freeze} from '../src/core/immutable';

it('keeps retained snapshots and live handles current through locks, moves, removal and history',()=>{
  const document=new Document(),group=document.layers.add(new LayerGroup({name:'Parent'}));
  const child=group.layers.add(new TextLayer({name:'Child',text:'Before'}));
  group.locked=true;
  const locked=document.getSnapshot().document;
  expect(findLayer(locked,child.id)?.name).toBe('Child');expect(isLocked(locked,child.id)).toBe(true);
  group.locked=false;child.moveTo(document);group.locked=true;
  const moved=document.getSnapshot().document;
  expect(findLayer(moved,child.id)?.name).toBe('Child');expect(isLocked(moved,child.id)).toBe(false);
  child.text='After';expect(child.text).toBe('After');document.undo();expect(child.text).toBe('Before');document.redo();expect(child.text).toBe('After');
  child.remove();expect(document.getLayer(child.id)).toBeNull();expect(findLayer(document.getSnapshot().document,child.id)).toBeUndefined();
  document.undo();expect(document.getLayer(child.id)?.name).toBe('Child');expect(child.text).toBe('After');
  expect(isLocked(locked,child.id)).toBe(true);expect(isLocked(moved,child.id)).toBe(false);
  expect(findLayer(locked,child.id)).toMatchObject({text:'Before'});
});

it('isolates inherited locks by root even when frozen documents share a child subtree and IDs',()=>{
  const child=freeze(createText('Shared child','Original')),group=createGroup('Parent');
  group.children=[child];group.locked=true;
  const base=createDocument();base.children=[group];
  const first=freeze(base),second=freeze({...first,children:[{...group,locked:false}]});
  expect(first.id).toBe(second.id);expect(first.children[0].id).toBe(second.children[0].id);
  expect(findLayer(first,child.id)).toBe(child);expect(findLayer(second,child.id)).toBe(child);
  expect(isLocked(first,child.id)).toBe(true);expect(isLocked(second,child.id)).toBe(false);
  expect(isLocked(first,child.id)).toBe(true);
  expect(findLayer(first,null)).toBeUndefined();expect(findLayer(first,'missing')).toBeUndefined();expect(isLocked(first,'missing')).toBe(false);
});

for(const shallowFrozen of [false,true])it(`refreshes ${shallowFrozen?'shallow-frozen':'mutable'} caller roots after nested changes`,()=>{
  const root=createDocument(),group=createGroup('Parent'),child=createText('Child','One');
  group.children=[child];root.children=[group];if(shallowFrozen)Object.freeze(root);
  expect(findLayer(root,child.id)).toBe(child);expect(isLocked(root,child.id)).toBe(false);
  group.locked=true;child.text='Two';
  expect(isLocked(root,child.id)).toBe(true);expect(findLayer(root,child.id)).toMatchObject({text:'Two'});
  group.children=[];expect(findLayer(root,child.id)).toBeUndefined();expect(isLocked(root,child.id)).toBe(false);
  const replacement={...child,text:'Replacement',locked:true};root.children.push(replacement);
  expect(findLayer(root,child.id)).toBe(replacement);expect(isLocked(root,child.id)).toBe(true);
});

it('preserves fresh reads inside a transaction and discards failed draft locks without poisoning accepted snapshots',()=>{
  const document=new Document(),group=document.layers.add(new LayerGroup()),child=group.layers.add(new TextLayer({text:'Original'}));
  const accepted=document.getSnapshot().document;
  expect(isLocked(accepted,child.id)).toBe(false);expect(findLayer(accepted,child.id)).toMatchObject({text:'Original'});
  expect(()=>document.transaction('Rejected draft',()=>{
    child.text='Draft';expect(child.text).toBe('Draft');group.locked=true;
    expect(()=>{child.text='Forbidden';}).toThrow(/Unlock this layer/i);
    throw new Error('Discard draft');
  })).toThrow('Discard draft');
  expect(document.getSnapshot().document).toBe(accepted);expect(child.text).toBe('Original');expect(group.locked).toBe(false);
  child.text='Accepted';expect(child.text).toBe('Accepted');expect(findLayer(accepted,child.id)).toMatchObject({text:'Original'});
});
