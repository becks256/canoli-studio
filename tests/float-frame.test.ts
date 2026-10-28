import{it,expect}from'vitest';
import{projectFloatFrame}from'../src/engine/float-frame';
import{AffineTransform}from'../src/core/affine';
const pixels=new Float32Array([1,2,-1,.5,2,4,-2,1,-1,-2,3,.25,9,8,7,0]);
const source={width:2,height:2,async readWindow(b:{x:number;y:number;width:number;height:number}){if(b.x<0||b.y<0||b.x+b.width>2||b.y+b.height>2)throw Error('Outside native artboard');const out=new Float32Array(b.width*b.height*4);for(let y=0;y<b.height;y++)for(let x=0;x<b.width;x++)out.set(pixels.subarray(((y+b.y)*2+x+b.x)*4,((y+b.y)*2+x+b.x)*4+4),(y*b.width+x)*4);return out;}};
it('resampled frames filter completed straight colors in premultiplied float, preserving signed/HDR precision',async()=>{
 const actual=await projectFloatFrame(source,{x:0,y:0,width:1,height:1},{region:{x:0,y:0,width:2,height:2},width:1,height:1});expect([...actual]).toEqual([Math.fround(9/7),Math.fround(18/7),-1,7/16]);
});
it('aligned frame reads preserve all native words while clipping artboard borders independently of partitioning',async()=>{
 const frame={region:{x:3,y:-4,width:2,height:2},width:2,height:2,rootTransform:AffineTransform.translation(3,-4)},identity=await projectFloatFrame(source,{x:0,y:0,width:2,height:2},frame);expect(identity).toEqual(pixels);expect(identity.buffer).not.toBe(pixels.buffer);const full=await projectFloatFrame(source,{x:-1,y:-1,width:4,height:4},frame),parts=new Float32Array(64);for(let y=0;y<4;y++)parts.set(await projectFloatFrame(source,{x:-1,y:y-1,width:4,height:1},frame),y*16);expect(parts).toEqual(full);expect([...full.subarray((2*4+2)*4,(2*4+3)*4)]).toEqual([9,8,7,0]);expect([...full.subarray(0,4)]).toEqual([0,0,0,0]);
});
it('frame requests snapshot geometry before awaits and reject cancelled, changed or malformed native reads',async()=>{
 const frame={region:{x:0,y:0,width:2,height:2},width:2,height:2},pending=projectFloatFrame(source,{x:0,y:0,width:2,height:2},frame);frame.region.width=200;expect(await pending).toEqual(pixels);await expect(projectFloatFrame(source,{x:0,y:0,width:2,height:2},frame,{isCancelled:()=>true})).rejects.toThrow();const bad={width:2,height:2,readWindow:async()=>new Float32Array(1)};await expect(projectFloatFrame(bad,{x:0,y:0,width:2,height:2},{...frame,region:{x:0,y:0,width:2,height:2}})).rejects.toThrow();const changed={width:2,height:2,async readWindow(){changed.width=3;return pixels.slice();}};await expect(projectFloatFrame(changed,{x:0,y:0,width:2,height:2},{...frame,region:{x:0,y:0,width:2,height:2}})).rejects.toThrow('changed');
});
it('independent native-scene frame fixtures bind source and complete reference bytes',async()=>{
 const{readFile}=await import('node:fs/promises'),{createHash}=await import('node:crypto'),{gunzipSync}=await import('node:zlib'),base='tests/fixtures/float-frame/',m=JSON.parse(await readFile(base+'manifest.json','utf8')),sha=(b:Uint8Array)=>createHash('sha256').update(b).digest('hex');expect(sha(await readFile('scripts/generate-float-frame-fixtures.py'))).toBe(m.generatorSha256);for(const row of m.nativeSources)expect(sha(await readFile(row.path))).toBe(row.sha256);for(const[name,row]of Object.entries(m.files)as[string,{bytes:number;sha256:string;rawSha256:string}][]){const data=await readFile(base+name);expect(data.length).toBe(row.bytes);expect(sha(data)).toBe(row.sha256);expect(sha(gunzipSync(data))).toBe(row.rawSha256);}
});
