import {test,expect} from '@playwright/test';

test('compact raw caches preserve affine paint, raster alpha and history pixels',async({page})=>{
 await page.goto('/');
 const results=await page.evaluate(async()=>{
  const {editor:e,PaintLayer,PaintFill,BrushStroke,LayerGroup,AffineTransform,LayerMask,MarqueeSelection}=window.luma;
  e.newDocument({width:320,height:240});
  const group=e.document.layers.add(new LayerGroup({x:30,y:20}));group.transform=AffineTransform.rotation(.23);
  const paint=group.layers.add(new PaintLayer({x:-15,y:10}));
  paint.strokes.add(new PaintFill({bounds:{x:-30,y:-10,width:110,height:70},color:'#4288ab',opacity:.6}));
  paint.strokes.add(new BrushStroke({points:[{x:10,y:20},{x:150,y:100}],size:21,color:'#cc1144',opacity:.7}));
  const canvas=new OffscreenCanvas(90,60),c=canvas.getContext('2d')!;
  c.fillStyle='rgba(20,200,90,.4)';c.fillRect(5,5,70,40);
  const raster=await e.importImage(new File([await canvas.convertToBlob()],'Alpha.png',{type:'image/png'}));
  raster.update({x:160,y:40});raster.transform=new AffineTransform(1,.2,.3,1,0,0);
  const fill=group.layers.add(new PaintLayer({x:70,y:15,opacity:.53}));
  fill.strokes.add(new PaintFill({bounds:{x:-8.5,y:3.25,width:83.75,height:56.5},color:'#998811',opacity:.61}));
  raster.opacity=.63;
  const results:{label:string;scale:number;max:number}[]=[];
  const check=async(label:string)=>{
   const snapshot=e.document.getSnapshot().document;
   // The second retained render exercises reads, not only cache construction.
   const warm=await e.renderer.render(snapshot,e.assetStore,{cache:true});warm.width=warm.height=1;
   for(const scale of [1,.125]){
    const options={outputSize:{width:Math.round(320*scale),height:Math.round(240*scale)}};
    const cached=await e.renderer.render(snapshot,e.assetStore,{...options,cache:true});cached.width=cached.height=1;
    const a=await e.renderer.render(snapshot,e.assetStore,{...options,cache:true});
    const b=await e.renderer.render(snapshot,e.assetStore,{...options,cache:false});
    const x=a.getContext('2d')!.getImageData(0,0,a.width,a.height).data,y=b.getContext('2d')!.getImageData(0,0,b.width,b.height).data;
    let max=0;for(let i=0;i<x.length;i++)max=Math.max(max,Math.abs(x[i]-y[i]));
    results.push({label,scale,max});a.width=a.height=b.width=b.height=1;
   }
  };
  await check('initial');
  paint.strokes.add(new BrushStroke({points:[{x:170,y:120},{x:230,y:160}],size:17,color:'#4400ff'}));await check('append');
  paint.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:0,y:0,width:200,height:130}),feather:3});await check('mask');
  raster.x=-20;await check('move');
  e.document.undo();await check('undo');e.document.redo();await check('redo');
  return results;
 });
 expect(results.every(result=>result.max===0),JSON.stringify(results)).toBe(true);
});
