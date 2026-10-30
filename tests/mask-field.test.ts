import {expect,it} from 'vitest';
import {maskFieldGeometry} from '../src/core/mask-field';
import {AffineTransform} from '../src/core/affine';
import {LayerMask,MarqueeSelection,PencilStroke,EraserStroke,VectorPath,WetPaintStroke} from '../src/dom';

it('mask support includes transformed selection and Bézier control hulls outside the image frame',()=>{
  const selection=new MarqueeSelection({x:-30,y:20,width:10,height:8,shape:'rectangle'}).transformed(AffineTransform.rotation(Math.PI/2));
  const a=maskFieldGeometry(new LayerMask({selection}).toJSON(),AffineTransform.translation(100,50));
  expect(a.background).toBe(0);expect(a.bounds.x).toBeLessThanOrEqual(70);expect(a.bounds.y).toBeLessThanOrEqual(20);
  expect(a.bounds.x+a.bounds.width).toBeGreaterThanOrEqual(80);expect(a.bounds.y+a.bounds.height).toBeGreaterThanOrEqual(30);
  const vector=new LayerMask({paths:[new VectorPath({points:[{x:0,y:0,out:{x:80,y:-50}},{x:10,y:0,in:{x:70,y:-40}},{x:10,y:10}],closed:true})]});
  const b=maskFieldGeometry(vector.toJSON(),new AffineTransform());
  expect(b.bounds).toEqual({x:-2,y:-52,width:84,height:64});
});

it('finite deviation bounds include painted refinements and capture-scaled erasure coverage',()=>{
  const paint=new LayerMask({base:.37}).paint(new PencilStroke({points:[{x:9000.5,y:4000.5}],size:1,pressureSize:false}),'hide');
  const p=maskFieldGeometry(paint.toJSON(),AffineTransform.translation(3,4));
  expect(p.background).toBe(.37);expect(p.bounds.x).toBeLessThan(9003);expect(p.bounds.x+p.bounds.width).toBeGreaterThan(9004);
  const erasure=new LayerMask({rasterErasures:{width:100,height:50,operations:[{width:50,height:25,stroke:new EraserStroke({points:[{x:5,y:6}],size:2,pressureSize:false})}]}});
  const e=maskFieldGeometry(erasure.toJSON(),AffineTransform.scale(3,4));
  expect(e.background).toBe(1);expect(e.bounds.x).toBeLessThan(30);expect(e.bounds.x+e.bounds.width).toBeGreaterThan(30);
  expect(e.bounds.y).toBeLessThan(48);expect(e.bounds.y+e.bounds.height).toBeGreaterThan(48);
});

it('complete 50 MP bitmap support is independent of working-plane budgets and empty fields retain their background',()=>{
  expect(maskFieldGeometry(LayerMask.fromBitmap('original').toJSON(),new AffineTransform(),{width:10000,height:5000})).toEqual({background:0,bounds:{x:-2,y:-2,width:10004,height:5004}});
  expect(maskFieldGeometry(new LayerMask({base:.37}).toJSON(),new AffineTransform())).toEqual({background:.37,bounds:{x:0,y:0,width:1,height:1}});
  expect(maskFieldGeometry(new LayerMask({paths:[]}).toJSON(),new AffineTransform()).background).toBe(0);
  expect(()=>maskFieldGeometry(LayerMask.fromBitmap('missing').toJSON(),new AffineTransform())).toThrow(/native geometry/);
  expect(()=>maskFieldGeometry(LayerMask.fromBitmap('unresolved').toJSON(),AffineTransform.translation(Number.MAX_SAFE_INTEGER,0),{width:1,height:1})).toThrow(/precision/);
});

it('wet reconstruction support expands in the native mask plane before large original-grid scaling',()=>{
  const wet=new WetPaintStroke({brush:new PencilStroke({points:[{x:2.5,y:1.5}],size:1,pressureSize:false}),tiles:[{x:2,y:1,width:1,height:1,assetId:'coverage-value',coverage:{assetId:'coverage-support'}}]});
  const mask=new LayerMask({base:.37}).applyWetPaint(wet).toJSON(),field=maskFieldGeometry(mask,AffineTransform.scale(8));
  expect(field.bounds.x).toBeLessThanOrEqual(12);expect(field.bounds.x+field.bounds.width).toBeGreaterThanOrEqual(28);
  expect(field.bounds.y).toBeLessThanOrEqual(4);expect(field.bounds.y+field.bounds.height).toBeGreaterThanOrEqual(20);
});
