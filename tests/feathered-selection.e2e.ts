import { test, expect } from '@playwright/test';

test('combined selection feather matches the canvas round trip across transforms and tiles', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const { maskCoverage } = await import(/* @vite-ignore */ String('/src/engine/masks.ts'));
    const { AffineTransform } = await import(/* @vite-ignore */ String('/src/core/affine.ts'));
    const { featherRegion } = await import(/* @vite-ignore */ String('/src/engine/feather-region.ts'));
    const processor = window.luma.editor.renderer.processor;
    const fused = processor.featheredSelection.bind(processor);
    const results = [];
    for (const width of [200, 1100]) for (const angle of [0, 0.7]) {
      const world = new AffineTransform(Math.cos(angle), Math.sin(angle), -Math.sin(angle), Math.cos(angle), 20, 10);
      const mask = new window.luma.LayerMask({ selection: new window.luma.MarqueeSelection({shape:'ellipse',x:0,y:0,width:600,height:150}), feather:7 }).toJSON();
      const space = {x:-20,y:-20,width,height:240,sx:1,sy:1};
      const actual = await maskCoverage(mask, space, 20, 10, processor, undefined, world);
      processor.featheredSelection = async (tile, radiusX, radiusY) => {
        const source = await processor.selection(tile);
        const canvas = document.createElement('canvas'); canvas.width=tile.width;canvas.height=tile.height;
        const c=canvas.getContext('2d')!,image=c.createImageData(tile.width,tile.height);
        image.data.set(source);c.putImageData(image,0,0);
        const pixels=c.getImageData(0,0,tile.width,tile.height).data;
        const region=featherRegion(pixels,{...tile,radiusX,radiusY});
        if(region){
          const softened=await processor.feather(region.pixels,{width:region.width,height:region.height,radiusX,radiusY});
          const image=c.createImageData(region.width,region.height);image.data.set(softened);c.putImageData(image,region.x,region.y);
        }
        const result=c.getImageData(0,0,tile.width,tile.height).data;canvas.width=canvas.height=1;return result;
      };
      const reference=await maskCoverage(mask,space,20,10,processor,undefined,world);
      processor.featheredSelection=fused;
      const a=actual.getContext('2d')!.getImageData(0,0,width,240).data;
      const b=reference.getContext('2d')!.getImageData(0,0,width,240).data;
      results.push({width,angle,equal:a.every((value:number,index:number)=>value===b[index])});
      actual.width=actual.height=reference.width=reference.height=1;
    }
    return results;
  });
  expect(results).toHaveLength(4);
  expect(results.every(result=>result.equal)).toBe(true);
});
