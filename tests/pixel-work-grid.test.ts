import {it,expect}from 'vitest';
import {nativeSamplingGrid,pixelWorkGrid}from '../src/engine/pixel-work-grid';
for(const [width,height]of [[1,1],[1028,68],[2048,64],[4096,4096],[8192,8192],[12000,2048]])it(`covers ${width}x${height} without overlaps, omissions or enlarged blend buffers`,()=>{
 const grid=pixelWorkGrid(width,height);let covered=0;for(let y=0;y<height;y+=grid.rows)for(let x=0;x<width;x+=grid.columns){const w=Math.min(grid.columns,width-x),h=Math.min(grid.rows,height-y);expect(w*h).toBeLessThanOrEqual(1024*1024);expect(w).toBeLessThanOrEqual(8192);expect(h).toBeLessThanOrEqual(8192);covered+=w*h;}expect(covered).toBe(width*height);
});
it('keeps an overscanned wide blend strip in one existing-budget job',()=>{const grid=pixelWorkGrid(2052,68);expect(grid.columns>=2052&&grid.rows>=68).toBe(true);});
it('coalesces native export strips without increasing halo work',()=>{
 for(const [width,height,legacy,halo,pad]of [[2048,64,512,6,8],[2052,68,1024,6,4],[2048,64,512,180,8],[1024,1024,512,6,8]]){
  const grid=nativeSamplingGrid(width,height,legacy,halo,pad),jobs=Math.ceil(width/grid.columns)*Math.ceil(height/grid.rows),oldJobs=Math.ceil(width/legacy)*Math.ceil(height/legacy),margin=pad+2*halo;
  expect(jobs).toBeLessThan(oldJobs);expect((grid.columns+margin)*(grid.rows+margin)).toBeLessThanOrEqual(1_000_000);expect((width+Math.ceil(width/grid.columns)*margin)*(height+Math.ceil(height/grid.rows)*margin)).toBeLessThanOrEqual((width+Math.ceil(width/legacy)*margin)*(height+Math.ceil(height/legacy)*margin));
 }
});
it('retains the exact previous grid when halos or fragmentation do not improve',()=>{for(const [width,height,legacy,halo]of [[520,520,256,840],[512,512,1024,6],[64,64,256,1000]])expect(nativeSamplingGrid(width,height,legacy,halo)).toEqual({columns:legacy,rows:legacy});});
for(const [w,h]of [[0,1],[1,-1],[.5,2],[Infinity,1]])it('rejects invalid working geometry before partitioning',()=>{expect(()=>pixelWorkGrid(w,h)).toThrow('working dimensions');});
