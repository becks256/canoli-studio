import {it,expect} from 'vitest';
import {Document,RasterLayer,AffineTransform,LayerMask,PaintLayer,VectorLayer,EraserStroke} from '../src/dom';
import type {DocumentData} from '../src/core/model';
import {defaultStyle} from '../src/core/drawing';
import {nativeFrequencyRasterSource} from '../src/engine/frequency-identity';
import type {AssetStore} from '../src/core/assets';
const assets={get:()=>({width:64,height:32,bitmap:{width:64,height:32}})} as unknown as AssetStore;
const scene=()=>{const doc=new Document({width:64,height:32});doc.layers.add(new RasterLayer({assetId:'pixels',width:64,height:32}));return doc.toJSON();};
it('recognizes an unchanged native raster without mutating or replacing authored data',()=>{
 const data=scene(),before=structuredClone(data);expect(nativeFrequencyRasterSource(data,assets)).toBe(data.children[0]);expect(data).toEqual(before);
});
const mutations:Record<string,(data:DocumentData)=>void>={
 'multiple sources':d=>{d.children.push(new PaintLayer().toJSON());},
 'vector source':d=>{d.children=[new VectorLayer().toJSON()];},
 'paint source':d=>{d.children=[new PaintLayer().toJSON()];},
 'hidden source':d=>{d.children[0].visible=false;},
 'source opacity':d=>{d.children[0].opacity=.5;},
 'source fill opacity':d=>{d.children[0].fillOpacity=.5;},
 'source blend':d=>{d.children[0].blendMode='multiply';},
 'source origin':d=>{d.children[0].x=1;},
 'source affine':d=>{d.children[0].transform=new AffineTransform(1,.1,0,1).toJSON();},
 'source mask':d=>{d.children[0].mask=new LayerMask({base:1}).toJSON();},
 'source tone':d=>{const r=d.children[0];if(r.kind==='raster')r.effects.push({id:'native-source-tone',kind:'tone',enabled:false,exposure:0,contrast:0,saturation:0});},
 'source erasure':d=>{const r=d.children[0];if(r.kind==='raster')r.erasures=[{width:64,height:32,stroke:new EraserStroke({points:[{x:2,y:2}]}).toJSON()}];},
 'source shadow':d=>{const style=defaultStyle();style.dropShadow.enabled=true;d.children[0].styles=style;},
 'source overlay':d=>{const style=defaultStyle();style.colorOverlay.enabled=true;d.children[0].styles=style;},
 'source Blend If':d=>{const style=defaultStyle();style.blendIf.enabled=true;d.children[0].styles=style;},
 'non-native geometry':d=>{const r=d.children[0];if(r.kind==='raster')r.width=63;},
};
for(const [name,mutate]of Object.entries(mutations))it(`retains existing sampling for ${name}`,()=>{const d=scene();mutate(d);expect(nativeFrequencyRasterSource(d,assets)).toBeNull();});
for(const bitmapWidth of [0,63,65])it(`declines changed or closed bitmap width ${bitmapWidth}`,()=>{expect(nativeFrequencyRasterSource(scene(),{get:()=>({width:64,height:32,bitmap:{width:bitmapWidth,height:32}})} as unknown as AssetStore)).toBeNull();});
