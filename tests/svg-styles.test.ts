import {describe,it,expect} from 'vitest';
import {Document,LayerGroup,VectorLayer,VectorPath,LayerStyle,LayerMask,AffineTransform} from '../src/dom';
import {planSvgStyles,svgEffectRegion} from '../src/core/svg-styles';
import {svgDocumentChunks} from '../src/core/svg-export';
import {getExportCapabilityReport} from '../src/engine/export';

function scene(){const document=new Document({width:160,height:120}),group=document.layers.add(new LayerGroup({x:20,y:15})),layer=group.layers.add(new VectorLayer({x:10,y:5}));layer.paths.add(VectorPath.rectangle({x:0,y:0,width:32,height:24},0,{fill:'#804020'}));return{document,group,layer};}
describe('SVG effect preservation',()=>{
 it('retains editable effect parameters with encoded-sRGB overlay math and independent fill opacity',()=>{
  const{layer}=scene();layer.fillOpacity=0;layer.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#2040e0',opacity:0.5},dropShadow:{enabled:true,color:'#0020ff',opacity:1,x:20,y:12,blur:4}});
  const svg=layer.toSvg(160,120);expect(svg).toContain('color-interpolation-filters="sRGB"');expect(svg).toContain('stdDeviation="4"');expect(svg).toContain('dx="20" dy="12"');expect(svg).toContain('<feMergeNode in="shadow" />');expect(svg).toContain('result="content"');
 });
 it('computes conservative support through ancestor shadow chains without document-size raster allocation',()=>{
  const{document,group,layer}=scene();layer.styles=new LayerStyle({dropShadow:{enabled:true,color:'#0020ff',opacity:1,x:20,y:12,blur:4}});group.styles=new LayerStyle({dropShadow:{enabled:true,color:'#00ff00',opacity:1,x:-10,y:0,blur:3}});
  expect(svgEffectRegion(document.toJSON())).toEqual({x:-55,y:-37,width:270,height:194});
  group.visible=false;expect(svgEffectRegion(document.toJSON())).toEqual({x:-0,y:-0,width:160,height:120});expect(planSvgStyles(document.toJSON())).toEqual([]);
 });
 it('retains full world placement while suppressing zero-strength/empty effects',()=>{
  const{document,group,layer}=scene();group.transform=new AffineTransform(0,1,-1,0,100,10);layer.transform=new AffineTransform(1,0,0.5,1,10,5);layer.styles=new LayerStyle({dropShadow:{enabled:true,color:'#000000',opacity:1,x:20,y:12,blur:0}});
  expect(planSvgStyles(document.toJSON())[0].world.toJSON()).toEqual({a:0,b:1,c:-1,d:0.5,e:95,f:20});
  layer.styles=new LayerStyle({dropShadow:{enabled:true,color:'#000000',opacity:0,x:20,y:12,blur:4}});expect(planSvgStyles(document.toJSON())).toEqual([]);
 });
 it('reports preserved overlays/shadows and native backdrop baking separately',()=>{
  const{document,layer}=scene();layer.styles=new LayerStyle({colorOverlay:{enabled:true,color:'#ffffff',opacity:0.5}});let report=getExportCapabilityReport(document.toJSON(),{format:'svg'});
  expect(report.featuresPreserved.join(' ')).toContain('document-space drop shadows');expect(report.featuresDegradedOrOmitted).not.toContain('Blend If');
  const raw=document.toJSON();const group=raw.children[0];if(group.kind!=='group')throw new Error('fixture');group.children[0].styles!.blendIf.enabled=true;report=getExportCapabilityReport(raw,{format:'svg'});expect(report.featuresPreserved.join(' ')).toContain('Native adjustment layers, pass-through groups and Blend If');expect(report.featuresDegradedOrOmitted.join(' ')).toContain('native backdrop prefixes');
 });
 it('retains off-canvas vector mask support for a visible shadow without editing the source',()=>{
  const{document,layer}=scene();layer.x=-25;layer.fillOpacity=0;layer.styles=new LayerStyle({dropShadow:{enabled:true,color:'#000000',opacity:1,x:25,y:0,blur:0}});layer.mask=new LayerMask({paths:[VectorPath.rectangle({x:0,y:0,width:32,height:24})]});
  const before=document.toJSON(),svg=[...svgDocumentChunks(before)].join('');expect(svg).toContain('x="-27"');expect(document.toJSON()).toEqual(before);
 });
});
