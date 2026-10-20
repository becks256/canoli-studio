import { expect, it } from 'vitest';
import { AffineTransform, BrushStroke, BrushTip, PencilStroke } from '../src/dom';
import { textureAffineSample } from '../src/core/brush-texture';
import { paintStampGeometry } from '../src/core/paint-stamps';
import type { BrushStrokeData } from '../src/core/drawing';

it('affine texture sampling owns an invertible complete mapping without imposing original-source dimension limits', () => {
  const sourceToOutput={a:2,b:.3,c:.4,d:1,e:-100,f:200};
  const value=textureAffineSample({width:100000,height:50000},{width:128,height:64,sourceToOutput});
  sourceToOutput.e=9;
  expect(value.sourceToOutput.e).toBe(-100);
  expect(value.smoothing).toBe(true);
  for(const scale of [1e-200,1e200])
    expect(textureAffineSample({width:100000,height:1},{width:1,height:1,sourceToOutput:AffineTransform.scale(scale).toJSON()}).sourceToOutput.a).toBe(scale);
});

it('affine texture sampling rejects singular/nonfinite/unknown matrices and unsafe working outputs', () => {
  const identity=new AffineTransform().toJSON(),source={width:10000,height:5000};
  for(const sourceToOutput of [{...identity,a:0}, {...identity,a:NaN}, {...identity,e:Infinity}, {...identity,extra:1},
    {...identity,a:1e-320,d:1e-320}, {...identity,a:1e308}])
    expect(()=>textureAffineSample(source,{width:1,height:1,sourceToOutput})).toThrow();
  for(const output of [{width:4096,height:4096},{width:4097,height:1},{width:1.5,height:1},{width:1,height:0}])
    expect(()=>textureAffineSample(source,{...output,sourceToOutput:identity})).toThrow();
  expect(()=>textureAffineSample(source,{width:1,height:1,sourceToOutput:identity,sourceRect:{x:0,y:0,width:1,height:1}} as never)).toThrow();
});

it('round textured footprints retain authored orientation while existing isotropic native geometry stays unchanged', () => {
  const stroke=new BrushStroke({points:[{x:12.5,y:14.5}],size:10,tip:new BrushTip({angle:90})}).toJSON() as BrushStrokeData;
  const before=structuredClone(stroke),point=stroke.points[0];
  expect(paintStampGeometry(stroke,point)).toMatchObject({cos:1,sin:0,a:1,b:0,c:-0,d:1});
  expect(paintStampGeometry(stroke,point,true)).toMatchObject({cos:0,sin:1,a:0,b:1,c:-1,d:0});
  expect(paintStampGeometry(stroke,{...point,copy:new AffineTransform(-1,0,0,1,64,0)},true)).toMatchObject({cx:51.5,cy:14.5,a:0,b:1,c:1,d:0});
  expect(stroke).toEqual(before);
});

it('textured pencil orientation retains the same pixel anchoring and complete copied footprint', () => {
  const stroke=new PencilStroke({points:[{x:12.25,y:14.75}],size:7,tip:new BrushTip({roundness:.5,angle:90})}).toJSON() as BrushStrokeData;
  const legacy=paintStampGeometry(stroke,stroke.points[0]);
  expect(legacy).toEqual(paintStampGeometry(stroke,stroke.points[0],true));
  expect(legacy).toMatchObject({cx:11.5,cy:14,rx:3.5,ry:2,cos:0,sin:1});
});
