import{afterEach,expect,it,vi}from'vitest';
import{Document,TextLayer}from'../src/dom';
import{AssetStore}from'../src/core/assets';
import{exportPng}from'../src/engine/png';
afterEach(()=>vi.unstubAllGlobals());
function scene(){const document=new Document({width:16,height:16});document.layers.add(new TextLayer({text:'X',fontSize:8,fontFamily:'"Guarded Width"',fontStretch:'condensed',color:'#000000'}));return document;}
function fonts(ready=true){const face={family:'Guarded Width',status:'loaded',style:'normal'},set=Object.assign(new Set([face]),{check:vi.fn((_font:string,_text:string)=>ready)});vi.stubGlobal('document',{fonts:set});return{face,set};}
function renderer(callback?:(document:unknown)=>void){
 const surfaces:{width:number;height:number}[]=[];
 const render=vi.fn(async(document, _assets, options)=>{callback?.(document);const surface={width:options.region.width,height:options.region.height,getContext:()=>({getImageData:()=>({data:new Uint8ClampedArray(options.region.width*options.region.height*4)})})};surfaces.push(surface);return surface;});return{render,surfaces};
}
it('rejects an unavailable requested width before callbacks or rendering, using complete native matching',async()=>{
 const document=scene(),assets=new AssetStore(),target=renderer(),{set}=fonts(false);let progress=0;
 try{await expect(exportPng(document._read(),assets,target as never,{onProgress:()=>progress++})).rejects.toThrow(/not loaded/);expect(target.render).not.toHaveBeenCalled();expect(progress).toBe(0);expect(set.check.mock.calls[0]?.[0]).toContain('condensed');}finally{assets.dispose();}
});
it('pins referenced font generations before the initial callback instead of accepting its new font',async()=>{
 const document=scene(),assets=new AssetStore(),target=renderer(),{face}=fonts();
 try{await expect(exportPng(document._read(),assets,target as never,{onProgress:()=>{face.style='italic';}})).rejects.toThrow(/font family changed/);expect(target.render).not.toHaveBeenCalled();}finally{assets.dispose();}
});
it('owns mutable input snapshots before callbacks and retains source text and original font requests',async()=>{
 const document=scene(),input=document.toJSON(),assets=new AssetStore();fonts();const observed:unknown[]=[];const target=renderer(value=>{observed.push(value);});
 try{const result=await exportPng(input,assets,target as never,{onProgress:progress=>{if(progress.fraction===0){const text=input.children[0];if(text.kind!=='text')throw new Error('Fixture');text.text='Changed later';text.fontVariantCaps='all-small-caps';text.fontStretch='expanded';}}});expect(result.type).toBe('image/png');expect(observed).not.toHaveLength(0);for(const value of observed){expect(Object.isFrozen(value)).toBe(true);expect((value as typeof input).children[0]).toMatchObject({text:'X',fontStretch:'condensed'});expect((value as typeof input).children[0]).not.toHaveProperty('fontVariantCaps');}expect(target.surfaces.every(surface=>surface.width===0&&surface.height===0)).toBe(true);}finally{assets.dispose();}
});
it('releases an in-flight surface after font loss and permits a later export with the new captured generation',async()=>{
 const document=scene(),assets=new AssetStore(),{face}=fonts(),target=renderer(()=>{face.style='italic';});
 try{await expect(exportPng(document._read(),assets,target as never)).rejects.toThrow(/font family changed/);expect(target.surfaces.every(surface=>surface.width===0&&surface.height===0)).toBe(true);const retry=renderer();expect((await exportPng(document._read(),assets,retry as never)).type).toBe('image/png');expect(retry.surfaces.every(surface=>surface.width===0&&surface.height===0)).toBe(true);}finally{assets.dispose();}
});
it('discards completed private strips when final cancellation or a progress callback rejects',async()=>{
 const document=scene(),assets=new AssetStore();fonts();
 try{for(const mode of ['cancel','callback']){const target=renderer(),controller=new AbortController();const pending=exportPng(document._read(),assets,target as never,{signal:controller.signal,onProgress:progress=>{if(progress.phase==='encoding'){if(mode==='cancel')controller.abort();else throw new Error('Stop at encoding');}}});await expect(pending).rejects.toThrow(mode==='cancel'?/cancel|abort/i:/Stop at encoding/);expect(target.surfaces.length).toBeGreaterThan(0);expect(target.surfaces.every(surface=>surface.width===0&&surface.height===0)).toBe(true);}}finally{assets.dispose();}
});
