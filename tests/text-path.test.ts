import {expect,it} from 'vitest';
import {normalizeTextPath,textPathData} from '../src/core/text-path';
import {normalizeStyledTextScene} from '../src/engine/styled-text';

const points=[{x:10,y:80,in:{x:5,y:90},out:{x:40,y:10}},{x:190,y:80,in:{x:160,y:10},out:{x:195,y:90}}];
it('snapshots editable cubic anchors, offsets and orientation before asynchronous rendering',()=>{
 const input={points:structuredClone(points),startOffset:-12,baselineOffset:7,reverse:true},path=normalizeTextPath(input);input.points[0].out.y=999;
 expect(path.points[0].out.y).toBe(10);expect(path).toMatchObject({closed:false,startOffset:-12,baselineOffset:7,reverse:true});expect(Object.isFrozen(path.points[0].out)).toBe(true);expect(Object.isFrozen(path.points)).toBe(true);
 expect(textPathData(path)).toBe('M190 80C160 10 40 10 10 80');
});
it('retains the original closed seam while reversing every cubic and its closing handles',()=>{
 const path=normalizeTextPath({points,closed:true,reverse:true});expect(textPathData(path)).toBe('M10 80C5 90 195 90 190 80C160 10 40 10 10 80Z');
 const loop=normalizeTextPath({points:[points[0]],closed:true});expect(textPathData(loop)).toBe('M10 80C40 10 5 90 10 80Z');
});
it('uses literal coordinates rather than accepting SVG markup or path URLs',()=>{
 const input={points,href:'https://example.invalid/path.svg'};expect(()=>normalizeTextPath(input)).toThrow();const injected={points,d:'M0 0 L100 100'};expect(()=>normalizeTextPath(injected)).toThrow();
 expect(textPathData(normalizeTextPath({points}))).toBe('M10 80C40 10 160 10 190 80');
});
it('inherits the vector editing budget and keeps work-window geometry separate from baseline geometry',()=>{
 const large=normalizeStyledTextScene({width:100000000,height:1,lines:[{x:1000000,y:-2000,path:{points},spans:[{text:'AB'}]}]});expect(large.width).toBe(100000000);expect(large.lines[0]).toMatchObject({x:1000000,y:-2000,path:{startOffset:0,baselineOffset:0,closed:false,reverse:false}});
 expect(()=>normalizeTextPath({points:Array.from({length:20001},()=>points[0])})).toThrow();
 const many=Array.from({length:2},()=>({path:{points:Array.from({length:10001},(_,i)=>points[i%2])},spans:[]}));expect(()=>normalizeStyledTextScene({width:1,height:1,lines:many})).toThrow('anchor');
});
it('owns a separate immutable baseline for each visual line without mutating or merging their text',()=>{
 const input={width:240,height:160,lines:[{path:{points:structuredClone(points)},spans:[{text:'A'},{text:'B'}]},{path:{points:structuredClone(points),reverse:true},spans:[{text:'C'}]}]},scene=normalizeStyledTextScene(input);input.lines[0].path.points[1].x=0;
 expect(scene.lines[0].path?.points[1].x).toBe(190);expect(scene.lines[0].spans.map(s=>s.text)).toEqual(['AB']);expect(scene.lines[1].path?.reverse).toBe(true);expect(scene.lines[0].path).not.toBe(scene.lines[1].path);
});
it.each([{}, {points:[]}, {points:[{x:0,y:0,in:{x:0,y:0},out:{x:0,y:0}}]}, {points:points.map(()=>({x:0,y:0,in:{x:0,y:0},out:{x:0,y:0}}))}, {points,startOffset:Infinity}, {points,baselineOffset:NaN}, {points,reverse:'yes'}, {points:[{...points[0],x:Infinity},points[1]]}])('rejects missing, degenerate, nonfinite or unrepresentable baselines: %j',input=>{
 expect(()=>normalizeTextPath(input as Parameters<typeof normalizeTextPath>[0])).toThrow();
});
