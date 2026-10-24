import {expect,test} from '@playwright/test';
import {layerRowEventsWorkflow} from './helpers/layer-row-events';

test('ordinary thumbnail modifiers, SVG controls and text undo preserve native output',async({page},info)=>{
  await layerRowEventsWorkflow(page,info);
});

async function setup(page:import('@playwright/test').Page){
  await page.goto('/');await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  await page.evaluate(async()=>{const {createLayerRowsHarness}=await import(/* @vite-ignore */ String('/tests/fixtures/layer-rows.tsx'));(window as any).rowsHarness=await createLayerRowsHarness(window.luma.editor);});
  return page.getByTestId('layer-rows-harness');
}

test('retained rows use current callbacks, modifiers and transparency eligibility',async({page})=>{
  const host=await setup(page);
  await page.evaluate(()=>(window as any).rowsHarness.show({version:2}));
  await host.getByRole('button',{name:'Hide Harness image',exact:true}).click();
  expect(await page.evaluate(()=>(window as any).rowsHarness.events.filter((entry:any)=>entry.action==='attempt'))).toMatchObject([{version:2}]);
  await page.evaluate(()=>{window.luma.editor.document.undo();(window as any).rowsHarness.show({version:3});});
  await host.getByRole('button',{name:'Select Harness image',exact:true}).focus();await page.keyboard.press('Enter');
  expect(await page.evaluate(()=>(window as any).rowsHarness.events.filter((entry:any)=>['cancel','clear','select'].includes(entry.action)))).toMatchObject([{version:3},{version:3},{version:3}]);
  await page.evaluate(()=>{const state=(window as any).rowsHarness;window.luma.editor.document.selectedLayer=window.luma.editor.document.getLayer(state.textId);state.show({version:4,transparency:false});});
  await host.getByRole('img',{name:'Harness image thumbnail',exact:true}).click({modifiers:['Control']});
  expect(await page.evaluate(()=>(window as any).rowsHarness.events.filter((entry:any)=>entry.action==='transparency'))).toHaveLength(0);
  expect(await page.evaluate(()=>(window as any).rowsHarness.events.filter((entry:any)=>entry.action==='select').at(-1).version)).toBe(4);
  await page.evaluate(()=>{const state=(window as any).rowsHarness;window.luma.editor.document.selectedLayer=window.luma.editor.document.getLayer(state.textId);state.show({version:5,transparency:true});});
  await host.getByRole('img',{name:'Harness image thumbnail',exact:true}).click({modifiers:['Control']});
  await page.evaluate(async()=>{await(window as any).rowsHarness.wait();});
  expect(await page.evaluate(()=>{const state=(window as any).rowsHarness;return{event:state.events.filter((entry:any)=>entry.action==='transparency').at(-1),selected:window.luma.editor.document.selectedLayer!.id===state.textId,selection:!!window.luma.editor.document.selection};})).toMatchObject({event:{version:5},selected:true,selection:true});
  await page.evaluate(()=>(window as any).rowsHarness.show({version:6}));
  const drag=await host.getByRole('button',{name:'Select Harness image',exact:true}).locator('..').evaluate(row=>{
    const transfer=new DataTransfer();row.dispatchEvent(new DragEvent('dragstart',{bubbles:true,dataTransfer:transfer}));const id=transfer.getData('application/x-luma-layer');row.dispatchEvent(new DragEvent('dragend',{bubbles:true,dataTransfer:transfer}));return id;
  });
  expect(drag).toBe(await page.evaluate(()=>(window as any).rowsHarness.imageId));
  expect(await page.evaluate(()=>(window as any).rowsHarness.events.filter((entry:any)=>entry.action==='cancel').at(-1).version)).toBe(6);
});

test('shallow-frozen preview roots retain fresh mutable row labels',async({page})=>{
  const host=await setup(page);
  await page.evaluate(()=>(window as any).rowsHarness.draftName('First preview label'));
  await expect(host.getByRole('button',{name:'Select First preview label',exact:true})).toBeVisible();
  await page.evaluate(()=>(window as any).rowsHarness.draftName('Second preview label'));
  await expect(host.getByRole('button',{name:'Select Second preview label',exact:true})).toBeVisible();
  expect(await page.evaluate(()=>{const state=(window as any).rowsHarness;return window.luma.editor.document.getLayer(state.textId)!.name;})).toBe('Harness text');
});

test('unchanged shared rows route edits to the current document owner',async({page})=>{
  const host=await setup(page);
  expect(await page.evaluate(()=>(window as any).rowsHarness.switchOwner())).toBe(true);
  await host.getByRole('button',{name:'Hide Harness text',exact:true}).click();
  expect(await page.evaluate(()=>{const state=(window as any).rowsHarness;return{current:state.ownerVisible(),original:window.luma.editor.document.getLayer(state.textId)!.visible,event:state.events.at(-1)};})).toMatchObject({current:false,original:true,event:{version:10,action:'attempt'}});
});
