import {expect,it} from 'vitest';
import {VectorPath} from '../src/dom';
import {pathBounds} from '../src/core/drawing';

it('path bounds include off-anchor Bezier handles and stroke support',()=>{
 const path=new VectorPath({points:[
  {x:0,y:0,in:{x:-100,y:5},out:{x:10,y:200}},
  {x:20,y:30,in:{x:50,y:-60},out:{x:200,y:30}},
 ],strokeWidth:8}).toJSON();
 expect(pathBounds(path)).toEqual({x:-104,y:-64,width:308,height:268});
});

it('a collapsed path retains a one-pixel bounds extent',()=>{
 const path=new VectorPath({points:[{x:3,y:4}],strokeWidth:0}).toJSON();
 expect(pathBounds(path)).toEqual({x:3,y:4,width:1,height:1});
});
