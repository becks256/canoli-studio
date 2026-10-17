import {describe,it,expect} from 'vitest';
import {Document,LayerGroup,VectorLayer,VectorPath,LayerMask,AffineTransform} from '../src/dom';
import {planSvgMasks} from '../src/core/svg-masks';
import {svgDocumentChunks} from '../src/core/svg-export';
import {getExportCapabilityReport} from '../src/engine/export';

function scene(){
 const doc=new Document({width:160,height:96}),group=doc.layers.add(new LayerGroup({x:12,y:8})),layer=group.layers.add(new VectorLayer({x:4,y:4}));
 layer.paths.add(VectorPath.rectangle({x:0,y:0,width:120,height:80},0,{fill:'#ff0000'}));
 layer.mask=new LayerMask({paths:[VectorPath.rectangle({x:8,y:8,width:64,height:48})]});return{doc,group,layer};
}
describe('SVG mask contract',()=>{
 it('retains editable compound vector coverage, density and inversion without raster assets',()=>{
  const{doc,layer}=scene();layer.mask=layer.mask!.with({inverted:true,density:0.6});
  const before=doc.toJSON(),svg=[...svgDocumentChunks(before)].join('');
  expect(svg).toContain('mask-type:alpha');expect(svg).toContain('slope="-0.6" intercept="1"');expect(svg).toContain('fill-rule="evenodd"');expect(svg).not.toContain('<image');
  expect(layer.toSvg(160,96)).toContain('<mask');expect(doc.toJSON()).toEqual(before);
 });
 it('only prepares visible extracted masks and classifies feather/painted vector masks as native',()=>{
  const{doc,group,layer}=scene();expect(planSvgMasks(doc.toJSON()).map(p=>p.vector)).toEqual([true]);
  layer.mask=layer.mask!.with({feather:3});expect(planSvgMasks(doc.toJSON()).map(p=>p.vector)).toEqual([false]);
  group.visible=false;expect(planSvgMasks(doc.toJSON())).toEqual([]);
  group.visible=true;group.opacity=0;expect(planSvgMasks(doc.toJSON())).toEqual([]);
 });
 it('keeps linked and unlinked mask placement in the correct full affine plane',()=>{
  const{doc,group,layer}=scene();group.transform=new AffineTransform(2,0,1,1,12,8);
  layer.mask=layer.mask!.with({linked:false,x:30,y:20});const plan=planSvgMasks(doc.toJSON())[0];
  expect(plan.world.toJSON()).toEqual({a:2,b:0,c:1,d:1,e:24,f:12});
  const svg=[...svgDocumentChunks(doc.toJSON())].join('');expect(svg).toContain('transform="matrix(0.5 0 -0.5 1 -1 8)"');
 });
 it('standalone serialization rejects masks requiring host coverage instead of dropping them',()=>{
  const{layer}=scene();layer.mask=new LayerMask({base:0.5});expect(()=>layer.toSvg()).toThrow('requires native coverage preparation');
  layer.mask=layer.mask.with({enabled:false});expect(layer.toSvg()).not.toContain('<mask');
 });
 it('rebases attached unlinked masks when exporting a layer without its ancestors',()=>{
  const{layer}=scene();layer.mask=layer.mask!.with({linked:false,x:30,y:20});
  expect(layer.toSvg(160,96)).toContain('transform="matrix(1 0 0 1 14 8)"');
 });
 it('does not prepare a mask on a group with no extracted visible vector artwork',()=>{
  const doc=new Document(),group=doc.layers.add(new LayerGroup());group.mask=new LayerMask({assetId:'not-needed'});
  expect(planSvgMasks(doc.toJSON())).toEqual([]);expect([...svgDocumentChunks(doc.toJSON())].join('')).not.toContain('<mask');
 });
 it('rejects external mask tile sources and reports actual preservation versus rasterization',()=>{
  const{doc,layer}=scene();let report=getExportCapabilityReport(doc.toJSON(),{format:'svg'});
  expect(report.featuresPreserved.join(' ')).toContain('Editable unfeathered vector');
  layer.mask=new LayerMask({base:0.5});report=getExportCapabilityReport(doc.toJSON(),{format:'svg'});
  expect(report.warnings.join(' ')).toContain('native-resolution PNG');expect(report.featuresDegradedOrOmitted).not.toContain('Layer and group masks');
  expect(()=>[...svgDocumentChunks(doc.toJSON(),new Map([[layer.id,[{x:0,y:0,width:160,height:96,dataUrl:'https://example.com/mask.png'}]]]))]).toThrow('embedded PNG');
 });
});
