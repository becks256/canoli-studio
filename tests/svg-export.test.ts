import {describe,it,expect} from 'vitest';
import {Document,LayerGroup,VectorLayer,VectorPath,AffineTransform,formatSvgPathD,parseSvgPath} from '../src/dom';
import {exportSvgBlob,svgDocumentChunks} from '../src/core/svg-export';
import {getExportCapabilityReport} from '../src/engine/export';
import {defaultStyle} from '../src/core/drawing';

function scene(){
  const document=new Document({width:200,height:120});
  const group=document.layers.add(new LayerGroup({x:30,y:20,opacity:0.5}));
  const layer=group.layers.add(new VectorLayer({x:10,y:5,fillOpacity:0.4}));
  layer.paths.add(VectorPath.rectangle({x:0,y:0,width:20,height:20},0,{fill:'#ff0000'}));
  return{document,group,layer};
}

describe('SVG geometry and extraction contract',()=>{
  it('retains double-precision anchors and cubic handles through SVG path data',()=>{
    const path=new VectorPath({points:[{x:0.000012345678901234,y:1.2345678901234567,out:{x:1e-9,y:2.345678901234567}},{x:9.876543210987654,y:4.567890123456789,in:{x:7.654321098765432,y:1e-8}}]});
    const data=path.toJSON(),parsed=parseSvgPath(formatSvgPathD(data));
    expect(parsed[0]).toMatchObject({x:data.points[0].x,y:data.points[0].y,out:data.points[0].out});
    expect(parsed[1]).toMatchObject({x:data.points[1].x,y:data.points[1].y,in:data.points[1].in});
  });
  it('retains hierarchy and full affine placement without changing model or history',async()=>{
    const{document,layer}=scene();layer.transform=new AffineTransform(0,2,-3,0,10,5);
    const before=document.toJSON(),revision=document.getSnapshot().revision;
    const svg=await(await exportSvgBlob(before)).text();
    expect(svg).toContain('matrix(1 0 0 1 30 20)');
    expect(svg).toContain('matrix(0 2 -3 0 10 5)');
    expect(svg).toContain('opacity="0.4"');expect(svg).toContain('opacity="0.5"');
    expect(document.toJSON()).toEqual(before);expect(document.getSnapshot().revision).toBe(revision);
  });
  it('does not expose descendants of hidden or zero-opacity ancestors',async()=>{
    const{document,group}=scene();group.visible=false;
    expect(await(await exportSvgBlob(document.toJSON())).text()).not.toContain('<path');
    group.visible=true;group.opacity=0;
    expect(await(await exportSvgBlob(document.toJSON())).text()).not.toContain('<path');
  });
  it('standalone layer SVG respects its own visibility/placement and dimension errors',()=>{
    const{layer}=scene();
    expect(layer.toSvg(200,120)).toContain('matrix(1 0 0 1 10 5)');
    layer.visible=false;expect(layer.toSvg()).not.toContain('<path');
    for(const size of [0,-1,1.5,Infinity,NaN])expect(()=>layer.toSvg(size,120)).toThrow('positive safe integers');
    expect(layer.toSvg(Number.MAX_SAFE_INTEGER,1)).toContain(`width="${Number.MAX_SAFE_INTEGER}"`);
  });
  it('keeps arbitrary identifiers inert and rejects XML-unrepresentable text',async()=>{
    const{document}=scene(),raw=document.toJSON();
    raw.children[0].id='quoted " & <script>\n\t🐈';
    const svg=await(await exportSvgBlob(raw)).text();
    expect(svg).toContain('data-layer-id="quoted &quot; &amp; &lt;script&gt;&#10;&#9;🐈"');
    expect(svg).not.toContain('<script>');
    raw.children[0].id='bad\u0000';await expect(exportSvgBlob(raw)).rejects.toThrow('XML 1.0');
    raw.children[0].id='bad\ud800';expect(()=>[...svgDocumentChunks(raw)]).toThrow('XML 1.0');
  });
  it('rejects markup in paint and nonfinite geometry even for raw helper calls',async()=>{
    const{document}=scene(),raw=document.toJSON();
    const group=raw.children[0];if(group.kind!=='group')throw new Error('fixture');
    const layer=group.children[0];if(layer.kind!=='vector')throw new Error('fixture');
    layer.paths[0].fill='url(https://example.com/paint)';await expect(exportSvgBlob(raw)).rejects.toThrow('six-digit');
    layer.paths[0].fill=null;layer.paths[0].points[0].x=Infinity;
    await expect(exportSvgBlob(raw)).rejects.toThrow('finite');
  });
  it('reports masks, styles, smart contents and missing blend backdrops explicitly',()=>{
    const{document}=scene(),master=new Document({width:20,height:20});const art=master.layers.add(new VectorLayer());art.paths.add(VectorPath.rectangle({x:0,y:0,width:10,height:10}));document.placeSmartObject(document.defineComponent(master));const raw=document.toJSON();
    raw.children[0].styles={...defaultStyle(),blendIf:{...defaultStyle().blendIf,enabled:true}};
    raw.children[0].mask={kind:'paint',enabled:true,density:1,inverted:false,x:0,y:0,base:1,strokes:[]};
    raw.children[0].blendMode='multiply';
    const report=getExportCapabilityReport(raw,{format:'svg'});
    expect(report.featuresDegradedOrOmitted).toEqual(expect.arrayContaining(['Editable adjustment/Blend If settings and artwork/masks/styles inside native backdrop prefixes','Smart-object master links and shared component identity']));
    expect(report.warnings.join(' ')).toContain('content, masks, styles and blending are baked');
  });
  it('receives queued cancellation and can export again without a partial result',async()=>{
    const{document}=scene(),controller=new AbortController();
    const pending=exportSvgBlob(document.toJSON(),{signal:controller.signal});
    controller.abort(new Error('Stop extraction'));
    await expect(pending).rejects.toThrow('Stop extraction');
    expect((await exportSvgBlob(document.toJSON())).type).toBe('image/svg+xml');
  });
  it('receives a real task abort after a large path has started and before its last anchor',async()=>{
    const{document}=scene(),raw=document.toJSON(),group=raw.children[0];
    if(group.kind!=='group'||group.children[0].kind!=='vector')throw new Error('fixture');
    const points=Array.from({length:20000},(_,i)=>({x:i%200,y:Math.floor(i/200),in:{x:i%200,y:Math.floor(i/200)},out:{x:i%200,y:Math.floor(i/200)}}));
    const controller=new AbortController();let started=false,readLast=false;
    Object.defineProperty(points[5000],'x',{get(){if(!started){started=true;setTimeout(()=>controller.abort(new Error('Mid-path stop')),0);}return 0;}});
    Object.defineProperty(points[19999],'x',{get(){readLast=true;return 199;}});
    group.children[0].paths[0].points=points;
    await expect(exportSvgBlob(raw,{signal:controller.signal})).rejects.toThrow('Mid-path stop');
    expect(started).toBe(true);expect(readLast).toBe(false);
  });
});
