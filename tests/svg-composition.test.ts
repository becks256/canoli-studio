import {describe,it,expect} from 'vitest';
import {Document,LayerGroup,PaintLayer,PaintFill,AdjustmentLayer,VectorLayer,VectorPath,LayerStyle,LayerMask,TextLayer,RasterLayer,CloneStroke} from '../src/dom';
import {planSvgComposition} from '../src/core/svg-composition';
import {planSvgImages} from '../src/core/svg-images';
import {svgDocumentChunks} from '../src/core/svg-export';
import {svgEffectRegion} from '../src/core/svg-styles';
import {getExportCapabilityReport} from '../src/engine/export';
function addPaint(parent:Document|LayerGroup){const paint=parent.layers.add(new PaintLayer());paint.strokes.add(new PaintFill({bounds:{x:8,y:8,width:32,height:24},color:'#804020'}));return paint;}
describe('SVG native backdrop composition',()=>{
 it('renders only the prefix through the last visible dependency while retaining later paths and original model data',()=>{
  const doc=new Document({width:160,height:112}),paint=addPaint(doc),adjustment=doc.layers.add(new AdjustmentLayer({adjustment:{kind:'tone',exposure:1,contrast:0,saturation:0}})),after=doc.layers.add(new VectorLayer());after.paths.add(VectorPath.rectangle({x:60,y:20,width:16,height:16}));const before=doc.toJSON(),plan=planSvgComposition(before);
  expect(plan.prefixes).toBe(1);expect(plan.document.children.map(layer=>layer.id)).toEqual([adjustment.id,after.id]);expect(plan.document.svgNativePrefixes?.get(adjustment.id)).toEqual([paint.toJSON(),adjustment.toJSON()]);expect(planSvgImages(plan.document)[0].prefix).toHaveLength(2);expect(doc.toJSON()).toEqual(before);
 });
 it('keeps independent group backdrops separate without moving outer masks or opacity into their prefixes',()=>{
  const doc=new Document(),groups=[doc.layers.add(new LayerGroup({name:'Left',opacity:0.5})),doc.layers.add(new LayerGroup({name:'Right',x:80}))];for(const group of groups){group.mask=new LayerMask({base:0.5});addPaint(group);group.layers.add(new AdjustmentLayer({name:'Tone'}));}
  const plan=planSvgComposition(doc.toJSON());expect(plan.prefixes).toBe(2);expect(plan.stacks).toEqual(['Left / Tone','Right / Tone']);const first=plan.document.children[0];expect(first.kind).toBe('group');expect(first.mask).toEqual(groups[0].mask!.toJSON());expect(first.opacity).toBe(0.5);expect(plan.document.svgNativePrefixes?.values().next().value?.length).toBe(2);
 });
 it('does not prepare hidden or zero-opacity dependencies and retains the original view when no native prefix is needed',()=>{
  const doc=new Document();addPaint(doc);doc.layers.add(new AdjustmentLayer({visible:false}));const group=doc.layers.add(new LayerGroup({opacity:0}));addPaint(group);group.layers.add(new AdjustmentLayer());const raw=doc.toJSON(),plan=planSvgComposition(raw);expect(plan.prefixes).toBe(0);expect(plan.adjustments).toBe(0);expect(plan.document).toBe(raw);expect(plan.nativeAssets.size).toBe(0);
 });
 it('keeps original shadow-chain support after baking internal styles',()=>{
  const doc=new Document({width:160,height:112}),group=doc.layers.add(new LayerGroup()),paint=addPaint(group);paint.styles=new LayerStyle({dropShadow:{enabled:true,x:20,y:8,blur:3,opacity:1,color:'#0000ff'}});group.styles=new LayerStyle({dropShadow:{enabled:true,x:10,y:4,blur:2,opacity:1,color:'#00ff00'}});group.layers.add(new AdjustmentLayer());const raw=doc.toJSON(),plan=planSvgComposition(raw);expect(svgEffectRegion(plan.document)).toEqual(svgEffectRegion(raw));expect(plan.document.svgSupport).toEqual({x:-49,y:-31,width:258,height:174});
 });
 it('pins reachable native source/mask/clone/patch pixels and text, excluding hidden sources and avoiding synthetic image assets',()=>{
  const doc=new Document();doc.layers.add(new RasterLayer({assetId:'photo',width:16,height:16})).mask=new LayerMask({assetId:'mask'});const paint=doc.layers.add(new PaintLayer());paint.strokes.add(new CloneStroke({points:[{x:8,y:8}],tiles:[{assetId:'clone',x:0,y:0,width:16,height:16}]}));doc.layers.add(new TextLayer({text:'Native',fontFamily:'monospace'}));doc.layers.add(new RasterLayer({assetId:'hidden',width:1,height:1,visible:false}));doc.layers.add(new AdjustmentLayer({adjustment:{kind:'patch',assetId:'patch',width:16,height:16}}));const plan=planSvgComposition(doc.toJSON());expect(plan.nativeAssets).toEqual(new Set(['photo','mask','clone','patch']));expect(plan.nativeTexts.map(text=>text.text)).toEqual(['Native']);
 });
 it('reports baked native settings/content instead of omitted adjustments or falsely preserved editable paths',()=>{
  const doc=new Document(),layer=doc.layers.add(new VectorLayer());layer.paths.add(VectorPath.rectangle({x:0,y:0,width:32,height:24}));layer.styles=new LayerStyle({blendIf:{enabled:true,source:[0,16,220,255]}});const report=getExportCapabilityReport(doc.toJSON(),{format:'svg'});expect(report.featuresPreserved.join(' ')).toContain('Native adjustment layers and Blend If');expect(report.featuresPreserved.join(' ')).not.toContain('Infinitely scalable');expect(report.featuresDegradedOrOmitted).not.toContain('Blend If');expect(report.warnings.join(' ')).toContain('Native backdrop stacks end at');
 });
 it('rejects unprepared backdrop-dependent synchronous output instead of silently dropping its semantics',()=>{
  const doc=new Document(),layer=doc.layers.add(new VectorLayer());layer.paths.add(VectorPath.rectangle({x:0,y:0,width:32,height:24}));layer.styles=new LayerStyle({blendIf:{enabled:true}});expect(()=>layer.toSvg()).toThrow('native backdrop preparation');layer.visible=false;expect(()=>layer.toSvg()).not.toThrow();layer.visible=true;layer.styles=new LayerStyle();doc.layers.add(new AdjustmentLayer());expect(()=>[...svgDocumentChunks(doc.toJSON())]).toThrow('native backdrop preparation');
 });
});
