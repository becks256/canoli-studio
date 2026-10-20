import {describe,it,expect} from 'vitest';
import {Document,PaintLayer,PaintFill,BrushStroke,EraserStroke,CloneStroke,MarqueeSelection,LayerMask,AffineTransform} from '../src/dom';
import {strokeStamps,paintStampAlpha,paintStampSize} from '../src/core/paint-stamps';
import {svgDocumentChunks} from '../src/core/svg-export';
import {planSvgImages} from '../src/core/svg-images';
import {planSvgMasks} from '../src/core/svg-masks';
import {getExportCapabilityReport} from '../src/engine/export';

function scene(){const doc=new Document({width:128,height:96}),paint=doc.layers.add(new PaintLayer());return{doc,paint};}
describe('SVG painted artwork',()=>{
 it('retains the native stamp grid when clipping a very long segment',()=>{
  const stroke=new BrushStroke({points:[{x:0,y:0},{x:256,y:0}],size:4}).toJSON();const points=[...strokeStamps(stroke,{x:100,y:0,width:10,height:1})];expect(points).toHaveLength(19);expect(points[0].x).toBe(96);expect(points.at(-1)!.x).toBe(114);expect(points.every(point=>point.x===Math.round(point.x))).toBe(true);
 });
 it('uses native minimum pressure/flow and pencil size rules without resampling input',()=>{
  const stroke=new BrushStroke({points:[{x:2,y:3,pressure:0}],size:20,flow:0,pressureOpacity:true}).toJSON();expect(paintStampSize(stroke,stroke.points[0])).toBe(1);expect(paintStampAlpha(stroke,stroke.points[0])).toBe(0.0001);expect(stroke.points).toHaveLength(1);
 });
 it('rejects unrepresentable visible stamp indices instead of entering a non-advancing loop',()=>{
  const stroke=new BrushStroke({points:[{x:-9e15,y:0},{x:9e15,y:0}],size:0.1}).toJSON();const iterator=strokeStamps(stroke,{x:0,y:0,width:128,height:96});expect(()=>iterator.next()).toThrow('numeric precision');
 });
 it('retains stroke-wide opacity outside individual flow/pressure dabs',()=>{
  const{doc,paint}=scene();paint.strokes.add(new BrushStroke({points:[{x:20,y:20},{x:20,y:20}],size:10,opacity:0.5,flow:0.25}));const svg=[...svgDocumentChunks(doc.toJSON())].join('');expect(svg.match(/<circle /g)).toHaveLength(2);expect(svg).toContain('<g opacity="0.5" style="isolation:isolate">');expect(svg.match(/opacity="0.25"/g)).toHaveLength(2);expect(svg).not.toContain('<image ');
 });
 it('keeps erasers ordered over prior paint rather than suppressing later fills',()=>{
  const{doc,paint}=scene();paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:64,height:64},color:'#ff0000'}));paint.strokes.add(new EraserStroke({points:[{x:20,y:20}],size:10}));paint.strokes.add(new PaintFill({bounds:{x:16,y:16,width:8,height:8},color:'#0000ff'}));const before=doc.toJSON(),svg=[...svgDocumentChunks(before)].join('');expect(svg).toContain('slope="-1" intercept="1"');expect(svg).toContain('mask="url(#canoli-paint-1-2-erase)"');expect(svg.lastIndexOf('fill="#0000ff"')).toBeGreaterThan(svg.lastIndexOf('mask="url(#canoli-paint-1-2-erase)"'));expect(doc.toJSON()).toEqual(before);
 });
 it('prepares selection clips separately from layer masks with collision-free private lookup keys',()=>{
  const{doc,paint}=scene();paint.mask=new LayerMask({base:0.5});paint.strokes.add(new BrushStroke({points:[{x:20,y:20}],clip:new MarqueeSelection({shape:'ellipse',x:0,y:0,width:32,height:32})}));const plans=planSvgMasks(doc.toJSON());expect(plans).toHaveLength(2);expect(plans[0].layerId).toBe(paint.id);expect(plans[1].layerId).not.toBe(paint.id);expect(plans[1].mask.kind).toBe('selection');expect(plans[1].vector).toBe(false);
 });
 it('plans native clone sources per tile and fails without actual host preparation',()=>{
  const{doc,paint}=scene();paint.strokes.add(new CloneStroke({points:[{x:20,y:20}],tiles:[{assetId:'source',x:0,y:0,width:32,height:32}]}));const plans=planSvgImages(doc.toJSON());expect(plans).toHaveLength(1);expect(plans[0].layer).toMatchObject({kind:'raster',assetId:'source',width:32,height:32});expect(()=>[...svgDocumentChunks(doc.toJSON())]).toThrow('host image preparation');
 });
 it('bounds stroke coverage in the transformed native plane and skips empty selections',()=>{
  const{doc,paint}=scene();paint.transform=AffineTransform.translation(10,20);
  paint.strokes.add(new BrushStroke({points:[{x:20,y:20}],clip:new MarqueeSelection({shape:'rectangle',x:1,y:2,width:4,height:5,transform:AffineTransform.scale(2,3).toJSON()})}));
  paint.strokes.add(new BrushStroke({points:[{x:20,y:20}],clip:new MarqueeSelection()}));
  const plans=planSvgMasks(doc.toJSON());expect(plans[0].region).toEqual({x:10,y:24,width:12,height:19});expect(plans[1].region).toMatchObject({width:0,height:0});
 });
 it('rejects raw paint servers instead of emitting external references',()=>{
  const{doc,paint}=scene();paint.strokes.add(new PaintFill({bounds:{x:0,y:0,width:10,height:10}}));const raw=doc.toJSON(),layer=raw.children[0];if(layer.kind!=='paint')throw new Error('Expected paint');if(layer.strokes[0].kind!=='fill')throw new Error('Expected fill');layer.strokes[0].color='url(https://example.com/fill.svg)';expect(()=>[...svgDocumentChunks(raw)]).toThrow('six-digit');
 });
 it('reports editable painted geometry and lost original commands instead of omitted paint/empty canvas',()=>{
  const{doc,paint}=scene();paint.strokes.add(new BrushStroke({points:[{x:20,y:20}]}));const report=getExportCapabilityReport(doc.toJSON(),{format:'svg'});expect(report.featuresPreserved.join(' ')).toContain('Editable paint');expect(report.featuresDegradedOrOmitted).not.toContain('Paint layers');expect(report.featuresDegradedOrOmitted.join(' ')).toContain('Original paint command settings');expect(report.warnings.join(' ')).not.toContain('empty canvas');
 });
});
