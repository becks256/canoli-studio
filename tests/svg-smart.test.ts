import {describe,it,expect} from 'vitest';
import {Document,VectorLayer,VectorPath,RasterLayer,TextLayer,PaintLayer,PaintFill,LayerMask,MarqueeSelection,SmartToneFilter} from '../src/dom';
import {planSvgSmart} from '../src/core/svg-smart';
import {allLayers} from '../src/core/model';
import {planSvgMasks} from '../src/core/svg-masks';
import {svgDocumentChunks} from '../src/core/svg-export';
import {getExportCapabilityReport} from '../src/engine/export';

function scene(){const doc=new Document({width:240,height:160}),master=new Document({width:64,height:48}),vector=master.layers.add(new VectorLayer());vector.paths.add(VectorPath.rectangle({x:-8,y:-4,width:40,height:32},0,{fill:'#ff0000',stroke:null}));const key=doc.defineComponent(master),instance=doc.placeSmartObject(key,{x:12,y:16,width:128,height:48});return{doc,master,key,instance};}
describe('SVG smart-object export view',()=>{
 it('keeps generated viewport alpha sampling while same-named authored masks retain geometric SVG clipping',()=>{
  const{doc,master,key,instance}=scene();master.layers.at(0)!.mask=new LayerMask({paths:[VectorPath.rectangle({x:0,y:0,width:32,height:24})]});doc.defineComponent(master,{id:key});instance.name='Component contents';
  const authored=doc.layers.add(new VectorLayer({name:'Component contents'}));authored.paths.add(VectorPath.rectangle({x:0,y:0,width:40,height:32}));authored.mask=new LayerMask({paths:[VectorPath.rectangle({x:4,y:4,width:24,height:24})]});
  const before=doc.toJSON(),svg=[...svgDocumentChunks(planSvgSmart(before).document)].join('');expect(svg.match(/<mask /g)).toHaveLength(1);expect(svg.match(/<clipPath /g)).toHaveLength(2);expect(doc.toJSON()).toEqual(before);expect(JSON.stringify(before)).not.toContain('svgAlphaMasks');
 });
 it('expands shared vector instances with independent geometry and editable master clips without model mutation',()=>{
  const{doc,instance}=scene();instance.duplicate().x=150;const before=doc.toJSON(),plan=planSvgSmart(before),nodes=allLayers(plan.document.children),svg=[...svgDocumentChunks(plan.document)].join('');
  expect(plan.expanded).toBe(2);expect(plan.filtered).toBe(0);expect(nodes.some(node=>node.kind==='smart-object')).toBe(false);expect(new Set(nodes.map(node=>node.id)).size).toBe(nodes.length);expect(planSvgMasks(plan.document).every(mask=>mask.vector)).toBe(true);expect(svg).not.toContain('<image ');expect(svg.match(/<path /g)).toHaveLength(4);expect(svg).toContain('matrix(2 0 0 1 0 0)');expect(doc.toJSON()).toEqual(before);
 });
 it('pins only reachable visible filtered assets/text, including filter and ordinary masks',()=>{
  const doc=new Document(),master=new Document({width:64,height:48}),image=master.layers.add(new RasterLayer({assetId:'pixels',width:64,height:48}));image.mask=new LayerMask({assetId:'inner-mask'});master.layers.add(new TextLayer({text:'Native',fontFamily:'monospace'}));const key=doc.defineComponent(master),instance=doc.placeSmartObject(key);instance.setFilters([new SmartToneFilter({contrast:20})]);instance.filterMask=new LayerMask({assetId:'filter-mask'});
  const unused=new Document();unused.layers.add(new RasterLayer({assetId:'unused',width:1,height:1}));doc.defineComponent(unused);
  const plan=planSvgSmart(doc.toJSON());expect(plan.filtered).toBe(1);expect(plan.filteredAssets).toEqual(new Set(['pixels','inner-mask','filter-mask']));expect(plan.filteredTexts.map(text=>text.text)).toEqual(['Native']);expect(plan.document.children[0].kind).toBe('smart-object');
 });
 it('does not prepare hidden instances or their original source assets',()=>{
  const{doc,instance}=scene();instance.setFilters([new SmartToneFilter({contrast:20})]);instance.visible=false;const plan=planSvgSmart(doc.toJSON());expect(plan.expanded).toBe(0);expect(plan.filtered).toBe(0);expect(plan.filteredAssets.size).toBe(0);expect(plan.filteredTexts).toEqual([]);
 });
 it('reports omitted ordinary master contents but preserves filtered contents through native rendering',()=>{
  const doc=new Document(),master=new Document();master.layers.add(new PaintLayer()).strokes.add(new PaintFill({bounds:{x:0,y:0,width:20,height:20},color:'#ff0000'}));const instance=doc.placeSmartObject(doc.defineComponent(master));let report=getExportCapabilityReport(doc.toJSON(),{format:'svg'});expect(report.featuresDegradedOrOmitted).not.toContain('Paint layers');expect(report.featuresPreserved.join(' ')).toContain('Editable paint');expect(report.featuresDegradedOrOmitted).toContain('Smart-object master links and shared component identity');instance.setFilters([new SmartToneFilter({contrast:20})]);report=getExportCapabilityReport(doc.toJSON(),{format:'svg'});expect(report.featuresDegradedOrOmitted).not.toContain('Paint layers');expect(report.featuresPreserved.join(' ')).toContain('Native-rendered smart filters');
 });
 it('rejects missing definitions and the shared logical expansion budget rather than silently dropping instances',()=>{
  const{doc}=scene(),raw=doc.toJSON(),first=raw.children[0];expect(()=>planSvgSmart({...raw,components:[]})).toThrow('registry');const many=structuredClone(raw);many.children=Array.from({length:64},(_,i)=>({...first,id:`instance-${i}`}));const source=many.components![0].source;if(source.kind!=='document')throw new Error('Expected master');const child=source.document.children[0];if(child.kind!=='vector')throw new Error('Expected vector');source.document.children=Array.from({length:64},(_,i)=>({...child,id:`child-${i}`,paths:[]}));expect(()=>planSvgSmart(many)).toThrow('budget');
 });
 it('retains nested scoped unlinked masks and disabled-filter editability',()=>{
  const{doc,master,key}=scene();const vector=master.layers.at(0)!;vector.mask=new LayerMask({selection:new MarqueeSelection({shape:'rectangle',x:0,y:0,width:24,height:24}),linked:false});doc.defineComponent(master,{id:key});const outer=Document.fromJSON({...new Document({width:64,height:48}).toJSON(),components:doc.toJSON().components});outer.placeSmartObject(key,{x:4,y:8});const outerKey=doc.defineComponent(outer),instance=doc.placeSmartObject(outerKey,{x:80,y:40});instance.setFilters([new SmartToneFilter({enabled:false})]);const before=doc.toJSON(),plan=planSvgSmart(before);expect(plan.expanded).toBe(3);expect(plan.filtered).toBe(0);const independent=allLayers(plan.document.children).filter(layer=>layer.mask?.linked===false);expect(independent).toHaveLength(2);expect(independent.map(layer=>({x:layer.mask!.x,y:layer.mask!.y,basis:layer.mask!.basis}))).toEqual([{x:12,y:16,basis:{a:2,b:0,c:0,d:1,e:0,f:0}},{x:84,y:48,basis:{a:1,b:0,c:0,d:1,e:0,f:0}}]);expect(doc.toJSON()).toEqual(before);
 });
});
