import type { LayerData, VectorLayerData } from './model';
import { BLEND_MODES } from './model';
import { localTransform } from './spatial';
import { svgAttribute, svgNumber, svgPathElements } from './svg-path';
import { yieldTask } from './task-yield';
import {planSvgMasks,svgMaskDefinitions,type SvgDocument,type SvgRasterMasks} from './svg-masks';
import {planSvgStyles,svgStyleDefinitions,svgMatrix,svgEffectRegion} from './svg-styles';
import {svgImageDefinitions,type SvgImages} from './svg-images';
import {AffineTransform} from './affine';
import {svgTextElements,type SvgTextLayouts} from './svg-text';
import {planSvgPaint,svgPaintDefinitions,svgPaintElements} from './svg-paint';

/** Pure extraction, shared by synchronous constructors and cooperative host export.
 * Every layer boundary isolates its content, like the native compositor's surfaces.
 * Native mask coverage is supplied by the host; other losses are reported there.
 */
export function* svgDocumentChunks(document: SvgDocument, rasterMasks?:SvgRasterMasks, images?:SvgImages,texts?:SvgTextLayouts): Generator<string> {
  const { width, height } = document;
  if (!Number.isSafeInteger(width) || width <= 0 || !Number.isSafeInteger(height) || height <= 0)
    throw new Error('SVG dimensions must be positive safe integers.');
  yield `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" overflow="hidden">\n`;
  yield* svgImageDefinitions(images);
  const plans=planSvgMasks(document),maskIds=new Map(plans.map(plan=>[plan.layerId,plan.id]));
  yield* svgMaskDefinitions(document,plans,rasterMasks);
  const paints=planSvgPaint(document),paintPlans=new Map(paints.map(plan=>[plan.layer.id,plan]));
  yield* svgPaintDefinitions(paints,maskIds,images);
  const styles=planSvgStyles(document),stylePlans=new Map(styles.map(plan=>[plan.layerId,plan]));
  yield* svgStyleDefinitions(document,styles);
  const support=svgEffectRegion(document);
  let ordinal = 0,gradientOrdinal=0;
  function* layers(nodes: LayerData[],parent:AffineTransform): Generator<string> {
    for (const layer of nodes) {
      if (!layer.visible || layer.opacity === 0) continue;
      if(layer.kind==='adjustment'||layer.styles?.blendIf.enabled||(layer.kind==='group'&&layer.blendMode==='pass-through'))throw new Error('Adjustments, pass-through groups and Blend If require native backdrop preparation. Use host editor.export({format: "svg"}).');
      if (layer.kind !== 'group' && layer.kind !== 'vector'&&layer.kind!=='raster'&&layer.kind!=='text'&&layer.kind!=='smart-object'&&layer.kind!=='paint') continue;
      const matrix = localTransform(layer),world=parent.multiply(matrix);
      const transform = [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f].map(svgNumber).join(' ');
      if(layer.mask?.kind==='raster-erasures')throw new Error('Raster erasure coverage requires native SVG composition preparation.');
      if ((layer.blendMode==='linear-light'||layer.blendMode==='linear-burn')) throw new Error('Linear Light requires native SVG composition preparation.');
      if (layer.blendMode==='pass-through'||!BLEND_MODES.includes(layer.blendMode)) throw new Error('Unsupported SVG blend mode.');
      // Generated XML-safe IDs avoid collisions/whitespace in arbitrary model IDs.
      // The exact authored identifier is retained as inert, escaped metadata.
      yield `<g id="canoli-layer-${++ordinal}" data-layer-id="${svgAttribute(layer.id)}" transform="matrix(${transform})" opacity="${svgNumber(layer.opacity)}" style="isolation:isolate;mix-blend-mode:${layer.blendMode}">\n`;
      const effect=stylePlans.get(layer.id);
      // W * inverse(W) puts the filter in document coordinates. The inner W
      // restores the original content plane without flattening the layer tree.
      if(effect)yield `<g transform="matrix(${svgMatrix(effect.world.inverse())})" filter="url(#${effect.id})"><rect x="${svgNumber(support.x)}" y="${svgNumber(support.y)}" width="${svgNumber(support.width)}" height="${svgNumber(support.height)}" fill="#000000" fill-opacity="0" pointer-events="none" /><g transform="matrix(${svgMatrix(effect.world)})">\n`;
      const maskId=maskIds.get(layer.id);
      if(maskId)yield `<g mask="url(#${maskId})">\n`;
      // Fill opacity applies after all paths/children composite, before layer opacity.
      const fill = layer.fillOpacity ?? 1;
      if (fill !== 1&&!effect) yield `<g opacity="${svgNumber(fill)}" style="isolation:isolate">\n`;
      if (layer.kind === 'group') yield* layers(layer.children,world);
      else if(layer.kind==='vector')for (const path of layer.paths) { yield* svgPathElements(path,`canoli-vector-gradient-${++gradientOrdinal}`); yield '\n'; }
      else if(layer.kind==='text')yield* svgTextElements(layer,texts?.get(layer.id));
      else if(layer.kind==='paint'){const plan=paintPlans.get(layer.id);if(plan)yield* svgPaintElements(plan,maskIds,images);}
      else{
        const image=images?.get(layer.id);
        if(!image)throw new Error('Raster layers require host image preparation for SVG export.');
        if(image.space==='source')yield `<use href="#${image.id}" transform="scale(${svgNumber(layer.width/image.width)} ${svgNumber(layer.height/image.height)})" />\n`;
        else yield `<g transform="matrix(${svgMatrix(world.inverse())})"><use href="#${image.id}" x="${svgNumber(image.x)}" y="${svgNumber(image.y)}" /></g>\n`;
      }
      if (fill !== 1&&!effect) yield '</g>\n';
      if(maskId)yield '</g>\n';
      if(effect)yield '</g></g>\n';
      yield '</g>\n';
    }
  }
  yield* layers(document.children,new AffineTransform());
  yield '</svg>';
}

export function exportVectorLayerSvg(layer: VectorLayerData, width: number, height: number): string {
  return [...svgDocumentChunks({width, height, children: [layer]})].join('');
}

/** No raster allocations or mutation. Abort between bounded serialized fragments. */
export async function exportSvgBlob(document: SvgDocument, control?: {
  signal?: AbortSignal;
  onProgress?: (progress: {phase: 'encoding'; fraction: null}) => void;
}, rasterMasks?:SvgRasterMasks, images?:SvgImages,texts?:SvgTextLayouts): Promise<Blob> {
  control?.signal?.throwIfAborted();
  control?.onProgress?.({phase: 'encoding', fraction: null});
  const parts: string[] = [];
  let deadline = performance.now() + 8, fragments = 0;
  // Give queued cancellation a boundary before reading any geometry.
  await yieldTask();
  for (const part of svgDocumentChunks(document,rasterMasks,images,texts)) {
    control?.signal?.throwIfAborted();
    parts.push(part);
    if (++fragments % 16 === 0 || performance.now() >= deadline) {
      control?.onProgress?.({phase: 'encoding', fraction: null});
      await yieldTask();
      control?.signal?.throwIfAborted();
      deadline = performance.now() + 8;
    }
  }
  const blob = new Blob(parts, {type: 'image/svg+xml'});
  control?.signal?.throwIfAborted();
  return blob;
}
