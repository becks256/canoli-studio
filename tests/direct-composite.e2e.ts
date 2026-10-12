import {test,expect} from '@playwright/test';

test('direct content composition matches the intermediate surface across blends, masks and opacity',async({page})=>{
  await page.goto('/');
  const cases=await page.evaluate(async()=>{
    const {CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const {defaultStyle}=await import(/* @vite-ignore */ String('/src/core/drawing.ts'));
    const {BLEND_MODES}=await import(/* @vite-ignore */ String('/src/core/model.ts'));
    const {editor,PaintLayer,PaintFill,LayerMask,MarqueeSelection}=window.luma;
    editor.newDocument({width:40,height:32});
    const back=editor.document.layers.add(new PaintLayer());
    back.strokes.add(new PaintFill({bounds:{x:0,y:0,width:40,height:32},color:'#497fb4',opacity:0.7}));
    const front=editor.document.layers.add(new PaintLayer({opacity:0.6}));
    front.strokes.add(new PaintFill({bounds:{x:3,y:2,width:30,height:25},color:'#d57241',opacity:0.7}));
    front.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:4,y:3,width:23,height:19}),density:0.6});
    const renderer=new CanvasRenderer();const cases=[];
    try{
      for(const mode of BLEND_MODES)for(const overlay of [false,true])for(const masked of [false,true]){
        const direct=editor.document.toJSON();
        for(const item of direct.children)item.styles ??= defaultStyle();
        const layer=direct.children[1];layer.blendMode=mode;
        if(!masked) layer.mask=null;
        layer.styles!.colorOverlay={enabled:overlay,color:'#00ff00',opacity:0.4};
        const reference=structuredClone(direct);
        // Invisible shadow retains the original intermediate-surface route.
        for(const item of reference.children)item.styles!.dropShadow={enabled:true,opacity:0,color:'#000000',x:0,y:0,blur:0};
        const cold=await renderer.render(direct,editor.assetStore);cold.width=0;
        const a=await renderer.render(direct,editor.assetStore);
        const b=await renderer.render(reference,editor.assetStore,{cache:false});
        const x=a.getContext('2d')!.getImageData(0,0,40,32).data;
        const y=b.getContext('2d')!.getImageData(0,0,40,32).data;
        cases.push({mode,overlay,masked,equal:x.every((v:number,i:number)=>v===y[i])});
        a.width=b.width=0;
      }
    }finally{renderer.dispose();}
    return cases;
  });
  for(const result of cases)expect(result.equal,JSON.stringify(result)).toBe(true);
});

test('overlay cache promotion preserves edits, preview targets, undo and eviction within one slot',async({page})=>{
  await page.goto('/');
  const result=await page.evaluate(async()=>{
    const {CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const {editor,PaintLayer,PaintFill,LayerStyle,BrushStroke}=window.luma;
    editor.newDocument({width:80,height:60});
    const back=editor.document.layers.add(new PaintLayer());
    back.strokes.add(new PaintFill({bounds:{x:0,y:0,width:80,height:60},color:'#ff0000'}));
    back.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#0000ff',opacity:0.5}});
    const front=editor.document.layers.add(new PaintLayer());
    const renderer=new CanvasRenderer();
    let target=front.id;
    const equal: boolean[]=[];
    const check=async()=>{
      const snapshot=editor.document.getSnapshot().document;
      const paintPreview={layerId:target,stroke:new BrushStroke({points:[{x:20,y:20,pressure:1},{x:40,y:30,pressure:1}],size:10,color:'#00ff00'}).toJSON()};
      const a=await renderer.render(snapshot,editor.assetStore,{paintPreview});
      const b=await renderer.render(snapshot,editor.assetStore,{paintPreview,cache:false});
      const x=a.getContext('2d')!.getImageData(0,0,80,60).data;
      const y=b.getContext('2d')!.getImageData(0,0,80,60).data;
      equal.push(x.every((v:number,i:number)=>v===y[i]));a.width=b.width=0;
    };
    try{
      await check();const firstBytes=(renderer as any).cache.byteLength;
      await check();const secondBytes=(renderer as any).cache.byteLength;
      back.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#ffffff',opacity:0.3}});await check();
      editor.document.undo();await check();
      target=back.id;await check();
      back.styles=new LayerStyle();await check();
      renderer.clearCache();await check();
      return {equal,firstBytes,secondBytes};
    }finally{renderer.dispose();}
  });
  expect(result.equal).toEqual(Array(7).fill(true));
  expect(result.secondBytes).toBe(result.firstBytes);
  expect(result.secondBytes).toBeLessThan(64*1024*1024);
});

test('finished masked and shadowed layer caching matches uncached blends and edits',async({page})=>{
  await page.goto('/');
  const checks=await page.evaluate(async()=>{
    const {CanvasRenderer}=await import(/* @vite-ignore */ String('/src/engine/renderer.ts'));
    const {BLEND_MODES}=await import(/* @vite-ignore */ String('/src/core/model.ts'));
    const {editor:e,PaintLayer,PaintFill,LayerStyle,LayerMask,MarqueeSelection,BrushStroke}=window.luma;
    e.newDocument({width:60,height:48});
    const back=e.document.layers.add(new PaintLayer());back.strokes.add(new PaintFill({bounds:{x:0,y:0,width:60,height:48},color:'#4578a0',opacity:.6}));
    const front=e.document.layers.add(new PaintLayer({opacity:.7}));front.strokes.add(new PaintFill({bounds:{x:8,y:8,width:30,height:25},color:'#d65834',opacity:.8}));
    front.styles=new LayerStyle({dropShadow:{enabled:true,blur:3,x:2,y:3,opacity:.5,color:'#000000'},colorOverlay:{enabled:true,color:'#40a050',opacity:.3}});
    front.mask=new LayerMask({selection:new MarqueeSelection({shape:'ellipse',x:5,y:5,width:35,height:30}),feather:2,density:.8});
    const renderer=new CanvasRenderer(),checks:boolean[]=[];
    const compare=async(preview?:any)=>{
      const doc=e.document.getSnapshot().document;
      const cold=await renderer.render(doc,e.assetStore,{paintPreview:preview});cold.width=cold.height=0;
      const a=await renderer.render(doc,e.assetStore,{paintPreview:preview}),b=await renderer.render(doc,e.assetStore,{cache:false,paintPreview:preview});
      const x=a.getContext('2d')!.getImageData(0,0,60,48).data,y=b.getContext('2d')!.getImageData(0,0,60,48).data;
      checks.push(x.every((v:number,i:number)=>v===y[i]));a.width=a.height=b.width=b.height=0;
    };
    try{
      for(const mode of BLEND_MODES){front.blendMode=mode;await compare();}
      front.styles.colorOverlay={color:'#ff0000'};await compare();
      front.opacity=.3;await compare();front.fillOpacity=.4;await compare();
      front.mask=front.mask!.with({inverted:true});await compare();front.x=3;await compare();e.document.undo();await compare();
      back.x=2;await compare();
      await compare({layerId:front.id,stroke:new BrushStroke({points:[{x:25,y:25,pressure:1}],size:15,color:'#0000ff'}).toJSON()});
      renderer.clearCache();await compare();
    }finally{renderer.dispose();}
    return checks;
  });
  expect(checks.every(Boolean)).toBe(true);
});
