import {expect,it} from 'vitest';
import {AffineTransform} from '../src/core/affine';
import {nativeToneSamplingGrid} from '../src/engine/smart-filter-grid';
import type {SmartFilterData} from '../src/core/smart/filters';
const tone:SmartFilterData={id:'tone',kind:'tone',enabled:true,exposure:1,contrast:10,saturation:-20};
it('bounds full tonal and feather jobs independently of document dimensions',()=>{
 for(const [width,height]of [[2048,128],[128,2048],[3000,2000],[10000,5000]])for(const feather of [0,3,24]){
  const grid=nativeToneSamplingGrid(width,height,new AffineTransform(),[tone],feather)!;expect(grid).toBeDefined();const pad=4+6*Math.ceil(feather/3);expect((grid.columns+pad)*(grid.rows+pad)).toBeLessThanOrEqual(1_000_000);expect(grid.columns+pad).toBeLessThanOrEqual(8192);expect(grid.rows+pad).toBeLessThanOrEqual(8192);
  let covered=0;for(let y=0;y<height;y+=grid.rows)for(let x=0;x<width;x+=grid.columns)covered+=Math.min(grid.columns,width-x)*Math.min(grid.rows,height-y);expect(covered).toBe(width*height);
 }
});
it('retains resampling and spatial-filter boundaries',()=>{
 for(const placement of [new AffineTransform(1,0,0,1,.5,0),new AffineTransform(1,0,0,1,0,.5),AffineTransform.scale(2),AffineTransform.scale(-1,1),new AffineTransform(1,.001,0,1,0,0)])expect(nativeToneSamplingGrid(2048,128,placement,[tone])).toBeUndefined();
 for(const filters of [[],[{...tone,enabled:false}],[tone,{id:'blur',kind:'gaussian-blur',enabled:true,sigma:2}],[tone,{id:'native',kind:'native-composition',enabled:true}] ]as SmartFilterData[][])expect(nativeToneSamplingGrid(2048,128,new AffineTransform(),filters)).toBeUndefined();
 expect(nativeToneSamplingGrid(2048,128,new AffineTransform(),[tone,{id:'disabled',kind:'gaussian-blur',enabled:false,sigma:2}])).toBeDefined();
});
it('keeps the previous sampling grid for unsafe mask halos',()=>{expect(nativeToneSamplingGrid(2048,128,new AffineTransform(),[tone],840)).toEqual({columns:256,rows:256});});
