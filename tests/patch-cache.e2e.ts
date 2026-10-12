import {test,expect} from '@playwright/test';

test('completed patch cache respects backdrop changes, transforms and history',async({page})=>{
 await page.goto('/');
 const results=await page.evaluate(async()=>{
  const {editor:e,PaintLayer,PaintFill,AdjustmentLayer,PatchAdjustment,AffineTransform}=window.luma;
  e.newDocument({width:160,height:100});
  const background=e.document.layers.add(new PaintLayer());
  background.strokes.add(new PaintFill({bounds:{x:0,y:0,width:160,height:100},color:'#446688'}));background.opacity=.6;
  const c=new OffscreenCanvas(24,20),ctx=c.getContext('2d')!;
  ctx.fillStyle='rgba(220,70,40,.7)';ctx.fillRect(0,0,24,20);
  const asset=await e.assetStore.add(await c.convertToBlob(),'patch',undefined,false);
  const patch=e.document.layers.add(new AdjustmentLayer({x:30,y:20,adjustment:new PatchAdjustment({assetId:asset.id,width:24,height:20})}));
  const results:boolean[]=[];
  const compare=async()=>{
   const doc=e.document.getSnapshot().document;
   const a=await e.renderer.render(doc,e.assetStore),b=await e.renderer.render(doc,e.assetStore,{cache:false});
   const x=a.getContext('2d')!.getImageData(0,0,160,100).data,y=b.getContext('2d')!.getImageData(0,0,160,100).data;
   results.push(x.every((value,i)=>value===y[i]));a.width=a.height=b.width=b.height=1;
  };
  await compare();await compare();
  background.strokes.add(new PaintFill({bounds:{x:0,y:0,width:80,height:100},color:'#99cc44'}));await compare();await compare();
  background.opacity=.3;await compare();e.document.undo();await compare();
  patch.opacity=.4;await compare();e.document.undo();await compare();
  patch.transform=new AffineTransform(1,.2,.3,1,0,0);await compare();await compare();
  e.document.undo();await compare();e.document.redo();await compare();
  background.visible=false;await compare();background.visible=true;await compare();
  e.renderer.clearCache();await compare();
  return results;
 });
 expect(results).toHaveLength(15);expect(results.every(Boolean)).toBe(true);
});
