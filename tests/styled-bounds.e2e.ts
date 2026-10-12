import {test,expect} from '@playwright/test';

test('bounded styled surfaces match full canvases across transforms, masks and cache reuse',async({page})=>{
 await page.goto('/');
 const rows=await page.evaluate(async()=>{
  const {editor:e,PaintLayer,PaintFill,LayerStyle,LayerMask,MarqueeSelection,AffineTransform}=window.luma;
  e.newDocument({width:640,height:480});
  const background=e.document.layers.add(new PaintLayer());
  background.strokes.add(new PaintFill({bounds:{x:0,y:0,width:640,height:480},color:'#183858'}));
  const fill=e.document.layers.add(new PaintLayer({x:35.25,y:40.5,opacity:.63}));
  fill.strokes.add(new PaintFill({bounds:{x:-15.5,y:6.25,width:150.75,height:95.5},color:'#aa3155',opacity:.72}));
  const source=new OffscreenCanvas(90,60),c=source.getContext('2d')!;
  for(let x=0;x<90;x++){c.fillStyle=`rgba(${x*2},140,90,${(x%7+1)/8})`;c.fillRect(x,0,1,60);}
  const raster=await e.importImage(new File([await source.convertToBlob()],'alpha.png',{type:'image/png'}));
  raster.update({x:245.5,y:160.25,opacity:.57});
  for(const layer of [fill,raster])layer.styles=new LayerStyle({dropShadow:{enabled:true,blur:4.7,x:-12.25,y:17.75,opacity:.63,color:'#402060'},colorOverlay:{enabled:true,color:'#d09040',opacity:.35}});
  const rows:{label:string;scale:number;max:number;different:number}[]=[];
  const check=async(label:string)=>{
   const snapshot=e.document.getSnapshot().document;
   for(const scale of [1,.5,.125]){
    const options={outputSize:{width:640*scale,height:480*scale}};
    const warm=await e.renderer.render(snapshot,e.assetStore,{...options,cache:true});warm.width=warm.height=1;
    const a=await e.renderer.render(snapshot,e.assetStore,{...options,cache:true});
    const b=await e.renderer.render(snapshot,e.assetStore,{...options,cache:false});
    const x=a.getContext('2d')!.getImageData(0,0,a.width,a.height).data,y=b.getContext('2d')!.getImageData(0,0,b.width,b.height).data;
    let max=0,different=0;for(let i=0;i<x.length;i++){const delta=Math.abs(x[i]-y[i]);max=Math.max(max,delta);if(delta)different++;}
    rows.push({label,scale,max,different});a.width=a.height=b.width=b.height=1;
   }
  };
  await check('styled');
  for(const layer of [fill,raster])layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:0,y:0,width:90,height:60}),feather:3.5});
  await check('feathered mask');
  for(const angle of [.23,Math.PI/4,Math.PI/2]){
   fill.transform=AffineTransform.rotation(angle);raster.transform=new AffineTransform(Math.cos(angle),Math.sin(angle),-.7*Math.sin(angle),.7*Math.cos(angle),0,0);
   await check(`rotation ${angle}`);
  }
  raster.x=-25;fill.y=-40;await check('artboard clipping');
  e.document.undo();await check('undo');
  background.visible=false;await check('transparent background');
  for(const layer of [fill,raster])layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:0,y:0,width:90,height:60}),feather:3.5,inverted:true,density:.4,linked:false});
  await check('inverted partial unlinked mask');
  for(const layer of [fill,raster]){
   layer.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:0,y:0,width:90,height:60}),density:0});
   layer.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#0044ff',opacity:.6}});
  }
  await check('overlay with disabled mask contribution');

  return rows;
 });
 expect(rows.every(row=>row.max===0),JSON.stringify(rows)).toBe(true);
});
