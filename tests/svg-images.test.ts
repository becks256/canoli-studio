import {describe,it,expect} from 'vitest';
import {Document,LayerGroup,RasterLayer,VectorLayer,VectorPath,ToneAdjustment,LayerStyle,LayerMask,AffineTransform} from '../src/dom';
import {planSvgImages,type SvgImage} from '../src/core/svg-images';
import {svgDocumentChunks} from '../src/core/svg-export';
import {planSvgMasks} from '../src/core/svg-masks';
import {planSvgStyles,svgEffectRegion} from '../src/core/svg-styles';
import {getExportCapabilityReport} from '../src/engine/export';

function scene(){const doc=new Document({width:160,height:120}),group=doc.layers.add(new LayerGroup({x:12,y:8})),layer=group.layers.add(new RasterLayer({assetId:'source',width:64,height:32,x:4,y:4}));return{doc,group,layer};}
const image:SvgImage={id:'canoli-image-1',dataUrl:'data:image/png;base64,AAAA',width:64,height:32,x:0,y:0,space:'source'};
describe('SVG raster interchange',()=>{
 it('captures full affine placement and distinguishes native sources from edited raster pixels',()=>{
  const{doc,group,layer}=scene();group.transform=new AffineTransform(0,1,-1,0,100,10);
  expect(planSvgImages(doc.toJSON())[0]).toMatchObject({rendered:false,world:{a:0,b:1,c:-1,d:0,e:96,f:14}});
  layer.adjustments.add(new ToneAdjustment({exposure:0.5}));expect(planSvgImages(doc.toJSON())[0].rendered).toBe(true);
  layer.adjustments.at(0)!.enabled=false;expect(planSvgImages(doc.toJSON())[0].rendered).toBe(false);
  layer.clear();expect(planSvgImages(doc.toJSON())[0].rendered).toBe(true);
 });
 it('includes raster masks and styles in the shared output hierarchy/support',()=>{
  const{doc,layer}=scene();layer.mask=new LayerMask({base:0.5});layer.styles=new LayerStyle({dropShadow:{enabled:true,color:'#000000',opacity:1,x:20,y:12,blur:4}});
  expect(planSvgMasks(doc.toJSON())).toHaveLength(1);expect(planSvgStyles(doc.toJSON())).toHaveLength(1);expect(svgEffectRegion(doc.toJSON())).toEqual({x:-34,y:-26,width:228,height:172});
 });
 it('does not encode hidden or zero-opacity raster subtrees',()=>{
  const{doc,group}=scene();group.visible=false;expect(planSvgImages(doc.toJSON())).toEqual([]);group.visible=true;group.opacity=0;expect(planSvgImages(doc.toJSON())).toEqual([]);
 });
 it('retains independent vectors and shares one prepared image definition across source instances',()=>{
  const{doc,layer}=scene(),copy=layer.duplicate();const vector=doc.layers.add(new VectorLayer());vector.paths.add(VectorPath.rectangle({x:0,y:0,width:10,height:10}));
  const before=doc.toJSON(),svg=[...svgDocumentChunks(before,undefined,new Map([[layer.id,image],[copy.id,image]]))].join('');
  expect(svg.match(/<image /g)).toHaveLength(1);expect(svg.match(/<use /g)).toHaveLength(2);expect(svg).toContain('<path ');expect(doc.toJSON()).toEqual(before);
 });
 it('rejects missing/untrusted prepared image data instead of omitting a visible raster',()=>{
  const{doc,layer}=scene();expect(()=>[...svgDocumentChunks(doc.toJSON())]).toThrow('host image preparation');
  const untrusted=new Map([[layer.id,{...image,dataUrl:'https://example.com/image.png'}]]);
  expect(()=>[...svgDocumentChunks(doc.toJSON(),undefined,untrusted)]).toThrow('prepared embedded PNG');
 });
 it('reports actual raster preservation, metadata exclusion and baked operations without an empty-vector claim',()=>{
  const{doc,layer}=scene();let report=getExportCapabilityReport(doc.toJSON(),{format:'svg'});expect(report.warnings.join(' ')).not.toContain('empty canvas');expect(report.featuresPreserved.join(' ')).toContain('source-file metadata');expect(report.warnings.join(' ')).toContain('complete decoded source');
  layer.clear();report=getExportCapabilityReport(doc.toJSON(),{format:'svg'});expect(report.featuresDegradedOrOmitted.join(' ')).toContain('Editable raster tone effects/erasures');expect(report.featuresPreserved.join(' ')).not.toContain('Native-resolution raster imagery');expect(report.featuresPreserved.join(' ')).toContain('document-resolution PNG');
 });
});
