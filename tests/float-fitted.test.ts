import{it,expect}from'vitest';
import{Document}from'../src/dom';
import{fittedRenderer}from'../src/engine/fitted-renderer';
import type{DocumentRenderer}from'../src/engine/renderer';
import type{AssetStore}from'../src/core/assets';
it('fitted float delivery composes the native artboard before scaling and applies fractional contain edges once',async()=>{
 const document=new Document({width:2,height:1,precision:'float32'}).toJSON();let disposed=false;
 const renderer={captureFloatScene:async()=>({document,dispose(){disposed=true;},async read(bounds:{width:number;height:number}){const result=new Float32Array(bounds.width*bounds.height*4);for(let i=0;i<result.length;i+=4)result.set([2,-.25,.5,1],i);return result;}})}as unknown as DocumentRenderer;
 const fitted=fittedRenderer(renderer,document,3,3,'contain'),scene=await fitted.captureFloatScene!({...document,width:3,height:3},{}as AssetStore);
 const actual=await scene.read({x:0,y:0,width:3,height:3});
 for(let y=0;y<3;y++)for(let x=0;x<3;x++)expect([...actual.subarray((y*3+x)*4,(y*3+x+1)*4)]).toEqual([2,-.25,.5,y===1?1:.25]);
 const lower=await scene.read({x:0,y:1,width:3,height:2});expect([...lower]).toEqual([...actual.subarray(12)]);scene.dispose();expect(disposed).toBe(true);
});
