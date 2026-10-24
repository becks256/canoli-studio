import {expect,test} from '@playwright/test';

test('discarded indexed documents remain collectible while retained documents keep live queries',async({page},info)=>{
  await page.goto('/');
  await page.getByRole('button',{name:'Move tool (V)',exact:true}).click();
  const created=await page.evaluate(()=>{
    const {Document:DocumentModel,TextLayer}=window.luma;
    const roots:WeakRef<object>[]=[];
    for(let i=0;i<12;i++){
      const model=new DocumentModel({name:`Collectible ${i}`});
      for(let j=0;j<32;j++)model.layers.add(new TextLayer({name:`Layer ${j}`,text:`${i}/${j}`}));
      const last=model.layers.at(31)!;
      if(model.getLayer(last.id)?.name!=='Layer 31')throw new Error('Query fixture failed.');
      roots.push(new WeakRef(model.getSnapshot().document));
    }
    const retained=new DocumentModel(),layer=retained.layers.add(new TextLayer({text:'Retained'}));
    const retainedRoot=new WeakRef(retained.getSnapshot().document);
    if(retained.getLayer(layer.id)?.name!==layer.name)throw new Error('Retained query fixture failed.');
    (window as any).lookupCollection={roots,retained,retainedRoot,layerId:layer.id};
    return {total:roots.length,alive:roots.filter(root=>root.deref()).length};
  });
  expect(created).toEqual({total:12,alive:12});
  const cdp=await page.context().newCDPSession(page);
  try {
    await cdp.send('HeapProfiler.collectGarbage');
    await cdp.send('HeapProfiler.collectGarbage');
    const result=await page.evaluate(()=>{
      const {roots,retained,retainedRoot,layerId}=(window as any).lookupCollection;
      const alive=roots.filter((root:WeakRef<object>)=>root.deref()).length;
      const kept=!!retainedRoot.deref(),layer=retained.getLayer(layerId);
      layer.text='After collection';retained.undo();
      return {alive,kept,text:retained.getLayer(layerId).text};
    });
    expect(result).toEqual({alive:0,kept:true,text:'Retained'});
    await info.attach('indexed-document-collection',{body:JSON.stringify({created,result}),contentType:'application/json'});
  } finally {await cdp.detach();}
});
