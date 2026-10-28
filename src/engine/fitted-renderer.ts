import{isFloatDocument}from'../core/float-document';
import type { DocumentData } from "../core/model";
import type { DocumentRenderer } from "./renderer";
import{freeze,isImmutable}from'../core/immutable';
import{AffineTransform}from'../core/affine';
import{projectFloatWindow}from'./float-projection';

/** Map delivery tiles back to the source artboard without rewriting layer geometry. */
export function fittedRenderer(
  renderer: DocumentRenderer,
  source: DocumentData,
  width: number,
  height: number,
  fit: "contain" | "cover" | "fill",
): DocumentRenderer {
  source=isImmutable(source)?source:freeze(structuredClone(source));
  let sx = width / source.width,
    sy = height / source.height;
  if (fit !== "fill")
    sx = sy = fit === "contain" ? Math.min(sx, sy) : Math.max(sx, sy);
  const ox = (width - source.width * sx) / 2;
  const oy = (height - source.height * sy) / 2;
  return {
    async captureFloatScene(delivery,assets,control={}){
      if(!renderer.captureFloatScene)throw new Error('This renderer cannot deliver fitted float document samples.');
      const document=isImmutable(delivery)?delivery:freeze(structuredClone(delivery)),scene=await renderer.captureFloatScene(source,assets,control),placement=new AffineTransform(sx,0,0,sy,ox,oy);
      return{document,signal:scene.signal,check:()=>scene.check(),dispose:()=>scene.dispose(),async read(bounds,override){
        if(override)throw new Error('A fitted float delivery capture has a fixed output frame.');
        // Fit the already composed native artboard. Clamping this source plane
        // excludes off-artboard layers and applies fractional edge coverage once.
        return projectFloatWindow({width:source.width,height:source.height,readWindow:region=>scene.read(region)},placement,bounds,control);
      }};
    },
    async render(_delivery, assets, options = {}) {
      const tile = options.region ?? { x: 0, y: 0, width, height };
      const canvas = await renderer.render(source, assets, {
        ...options,
        region: {
          x: (tile.x - ox) / sx,
          y: (tile.y - oy) / sy,
          width: tile.width / sx,
          height: tile.height / sy,
        },
        outputSize: { width: tile.width, height: tile.height },
        cache: false,
        readback: true,
      });
      // Float frames already filter and cover the clipped native artboard once.
      if(isFloatDocument(source))return canvas;
      // Contain margins must not reveal layers extending beyond the source artboard.
      const px = canvas.width / tile.width,
        py = canvas.height / tile.height;
      const left = (ox - tile.x) * px,
        top = (oy - tile.y) * py;
      const right = (ox + source.width * sx - tile.x) * px;
      const bottom = (oy + source.height * sy - tile.y) * py;
      const ctx = canvas.getContext("2d")!;
      if (left > 0) ctx.clearRect(0, 0, left, canvas.height);
      if (top > 0) ctx.clearRect(0, 0, canvas.width, top);
      if (right < canvas.width)
        ctx.clearRect(Math.max(0, right), 0, canvas.width, canvas.height);
      if (bottom < canvas.height)
        ctx.clearRect(0, Math.max(0, bottom), canvas.width, canvas.height);
      return canvas;
    },
    clearCache() {
      renderer.clearCache();
    },
    // This view does not own the shared renderer.
    dispose() {},
  };
}
