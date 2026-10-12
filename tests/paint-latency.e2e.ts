import { test, expect } from '@playwright/test';

const cases: {layers:number;tool:'brush'|'pencil'|'eraser';styled:boolean;raster?:boolean}[] = [
  ...[0,5,20].flatMap(layers => (['brush','pencil'] as const).map(tool=>({layers,tool,styled:false}))),
  {layers:5,tool:'eraser',styled:false},
  {layers:5,tool:'eraser',styled:false,raster:true},
  {layers:5,tool:'brush',styled:true},
  {layers:20,tool:'brush',styled:true},
];
for (const {layers,tool,styled,raster=false} of cases) {
  test(`${tool} with ${layers} layers${styled ? ' styled' : ''}${raster ? ' raster' : ''} presents live input without refreshing the editor tool snapshot`, async ({ page }, testInfo) => {
    await page.goto('/');
    await page.evaluate(async({layers,styled,raster}) => {
      const {editor,PaintLayer,PaintFill,LayerStyle}=window.luma;
      editor.newDocument({width:800,height:600});
      for(let i=0;i<layers;i++){
        if(raster && i===layers-1){
          const canvas=document.createElement('canvas');canvas.width=800;canvas.height=600;
          canvas.getContext('2d')!.fillRect(0,0,800,600);
          const blob=await new Promise<Blob>(resolve=>canvas.toBlob(b=>resolve(b!)));
          await editor.importImage(new File([blob],'erase.png',{type:'image/png'}));
          continue;
        }
        const layer=editor.document.layers.add(new PaintLayer({name:`Latency ${i}`}));
        layer.strokes.add(new PaintFill({bounds:{x:i*20,y:i*10,width:400,height:300},color:'#807060'}));
        if(styled)layer.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#5080c0',opacity:0.5}});
        editor.document.selectedLayer=layer;
      }
    },{layers,styled,raster});
    const historyBefore=await page.evaluate(()=>window.luma.editor.document.getSnapshot().past.length);
    await page.keyboard.press('Control+1');
    const toolButton = page.getByRole('button', { name: tool === 'brush' ? 'Brush tool (B)' : tool === 'pencil' ? 'Pencil tool (N)' : 'Eraser tool (E)', exact: true });
    await toolButton.click();
    await expect(toolButton).toHaveAttribute('aria-pressed', 'true');
    await page.evaluate(() => {
      const editor = window.luma.editor;
      const samples: { inputMs: number; prepareMs: number; points: number; backend: string }[] = [];
      (window as any).paintTiming = samples;
      let inputTime = 0;
      const move = editor.tools.move.bind(editor.tools);
      editor.tools.move = (...args) => { inputTime = performance.now(); return move(...args); };
      const prepare = editor.renderer.prepareViewport.bind(editor.renderer);
      editor.renderer.prepareViewport = async (...args) => {
        const start = performance.now(), input = inputTime;
        const result = await prepare(...args);
        const prepared = performance.now();
        const preview = args[2]?.paintPreview;
        if (preview && input) {
          const present = result.present.bind(result);
          result.present = canvas => {
            present(canvas);
            samples.push({ inputMs: performance.now() - input, prepareMs: prepared - start,
              points: preview.stroke.points.length, backend: result.backend });
          };
        }
        return result;
      };
    });
    const box = (await page.locator('.canvas-wrap').boundingBox())!;
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.evaluate(() => { (window as any).paintUiSnapshot = window.luma.editor.tools.getUiSnapshot(); });
    for (let i = 1; i <= 40; i++) {
      await page.mouse.move(box.x + 100 + i * 5, box.y + 100 + Math.sin(i / 5) * 30);
      await page.waitForTimeout(16);
    }
    await expect.poll(() => page.evaluate(() => (window as any).paintTiming.length)).toBeGreaterThan(10);
    expect(await page.evaluate(() => (window as any).paintUiSnapshot === window.luma.editor.tools.getUiSnapshot())).toBe(true);
    const samples = await page.evaluate(() => (window as any).paintTiming);
    await testInfo.attach('pointer-to-canvas-presentation', { body: JSON.stringify(samples, null, 2), contentType: 'application/json' });
    console.log('live-paint', JSON.stringify({tool,layers,styled,raster,samples}));
    await page.mouse.up();
    expect(await page.evaluate(() => window.luma.editor.document.getSnapshot().past.length)).toBe(Math.min(60,historyBefore+1));
    await page.keyboard.press('Control+z');
    await expect(page.locator('.layer-row')).toHaveCount(layers);
  });
}
