import type {OwnedRawImage} from './codec';
import type {OwnedLensCorrection} from '../lens/codec';
import {validateLensGeometry,type LensCorrectionData} from './lens';

/** Private native-linear sampling; bounded source tiles never borrow WASM views. */
export function rawLensSampler(image:OwnedRawImage,lens:LensCorrectionData,profile?:OwnedLensCorrection){
  validateLensGeometry(lens,image.width,image.height);
  if(lens.profile&&(!profile||profile.report.width!==image.width||profile.report.height!==image.height))throw new Error('Calibrated lens sampling requires a matching native profile lease.');
  if(!lens.profile&&profile)throw new Error('A native profile lease requires calibrated lens settings.');
  if(lens.profile?.chromatic&&image.channels===1)throw new Error('Chromatic lens correction requires a color RAW source.');
  if(!image.readRegion)throw new Error('Lens correction requires native region reads.');
  const {width,height,channels}=image,cx=width*lens.center.x-.5,cy=height*lens.center.y-.5;
  const norm=Math.min(width,height)*.5,diagonal2=(width*width+height*height)*.25;
  const size=32,budget=8_000_000;
  type Tile={x:number;y:number;width:number;height:number;pixels:Uint16Array;gains?:Float64Array|Float32Array;bytes:number};
  const tiles=new Map<number,Tile>();let bytes=0,last:Tile|undefined;
  const vignette=profile?!!(profile.report.applied&2):Object.values(lens.vignette).some(n=>n!==0);
  function point(x:number,y:number,c:number):number{
    let tile=last;
    if(!tile||x<tile.x||y<tile.y||x>=tile.x+tile.width||y>=tile.y+tile.height){
      const tx=Math.floor(x/size),ty=Math.floor(y/size),key=ty*Math.ceil(width/size)+tx;
      tile=tiles.get(key);
      if(tile){tiles.delete(key);tiles.set(key,tile);}else{
        const left=tx*size,top=ty*size,w=Math.min(size,width-left),h=Math.min(size,height-top),pixels=image.readRegion!(left,top,w,h);
        if(pixels.length!==w*h*channels)throw new Error('Invalid native lens tile extent.');
        const gains=vignette?(profile?profile.gains(left,top,w,h):new Float64Array(w*h)):undefined;
        if(gains&&!profile)for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
          const r2=((left+xx-cx)**2+(top+yy-cy)**2)/diagonal2,{k1,k2,k3}=lens.vignette;
          gains[yy*w+xx]=1/(1+r2*(k1+r2*(k2+r2*k3)));
        }
        tile={x:left,y:top,width:w,height:h,pixels,gains,bytes:pixels.byteLength+(gains?.byteLength??0)};
        tiles.set(key,tile);bytes+=tile.bytes;
        while(bytes>budget&&tiles.size>1){const first=tiles.keys().next().value!;bytes-=tiles.get(first)!.bytes;tiles.delete(first);}
      }
      last=tile;
    }
    const index=(y-tile.y)*tile.width+x-tile.x;
    const value=tile.pixels[index*channels+(channels===1?0:c)]*(tile.gains?.[index]??1);
    // Lensfun's float32 color callback corrects source samples before resampling.
    return profile&&tile.gains?Math.fround(value):value;
  }
  function sample(x:number,y:number,c:number){
    if(!Number.isFinite(x)||!Number.isFinite(y))throw new Error('Invalid lens sampling coordinate.');
    const left=Math.floor(x),top=Math.floor(y),fx=x-left,fy=y-top;let total=0,coverage=0;
    for(let j=0;j<2;j++)for(let i=0;i<2;i++){
      const xx=left+i,yy=top+j,weight=(i?fx:1-fx)*(j?fy:1-fy);
      if(weight&&xx>=0&&yy>=0&&xx<width&&yy<height){total+=weight*point(xx,yy,c);coverage+=weight;}
    }
    return {value:coverage?Math.min(65535,Math.max(0,Math.floor(total/coverage+.5))):0,coverage};
  }
  return {rows(top:number,count:number){
    if(!Number.isSafeInteger(top)||!Number.isSafeInteger(count)||top<0||count<1||top+count>height)throw new Error('Invalid lens output rows.');
    const pixels=new Uint16Array(width*count*3),alpha=new Uint8Array(width*count);
    if(profile){
      // Coordinate scratch is independent of original geometry and absolute pixel
      // positions make output invariant to strips, blocks and source-cache eviction.
      for(let y=0;y<count;y+=16)for(let x=0;x<width;x+=256){
        const w=Math.min(256,width-x),h=Math.min(16,count-y),coordinates=profile.coordinates(x,top+y,w,h);
        for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
          const from=(yy*w+xx)*6,to=(y+yy)*width+x+xx;let coverage=1;
          for(let c=0;c<3;c++){const result=sample(coordinates[from+c*2],coordinates[from+c*2+1],c);pixels[to*3+c]=result.value;coverage=Math.min(coverage,result.coverage);}
          alpha[to]=Math.round(Math.min(1,Math.max(0,coverage))*255);if(!alpha[to])pixels.fill(0,to*3,to*3+3);
        }
      }
      return{pixels,alpha};
    }
    for(let yy=0;yy<count;yy++)for(let x=0;x<width;x++){
      const u=(x-cx)/(norm*lens.scale),v=(top+yy-cy)/(norm*lens.scale),r2=u*u+v*v,{k1,k2,k3}=lens.distortion;
      const factor=1+r2*(k1+r2*(k2+r2*k3)),dx=u*factor*norm,dy=v*factor*norm;let coverage=1;
      for(let c=0;c<3;c++){
        const scale=c===0?lens.chromatic.red:c===2?lens.chromatic.blue:1;
        const result=sample(cx+dx*scale,cy+dy*scale,c);pixels[(yy*width+x)*3+c]=result.value;coverage=Math.min(coverage,result.coverage);
      }
      const index=yy*width+x;alpha[index]=Math.round(Math.min(1,Math.max(0,coverage))*255);
      if(!alpha[index])pixels.fill(0,index*3,index*3+3);
    }
    return{pixels,alpha};
  },dispose(){tiles.clear();last=undefined;bytes=0;}};
}
