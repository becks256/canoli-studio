import type {OwnedRawImage} from './codec';
import {validateLensGeometry,type LensCorrectionData} from './lens';

/** Private native-linear sampling; bounded source tiles never borrow WASM views. */
export function rawLensSampler(image:OwnedRawImage,lens:LensCorrectionData){
  validateLensGeometry(lens,image.width,image.height);
  if(!image.readRegion)throw new Error('Lens correction requires native region reads.');
  const {width,height,channels}=image,cx=width*lens.center.x-.5,cy=height*lens.center.y-.5;
  const norm=Math.min(width,height)*.5,diagonal2=(width*width+height*height)*.25;
  const size=32,budget=8_000_000;
  type Tile={x:number;y:number;width:number;height:number;pixels:Uint16Array;gains?:Float64Array;bytes:number};
  const tiles=new Map<number,Tile>();let bytes=0,last:Tile|undefined;
  const vignette=Object.values(lens.vignette).some(n=>n!==0);
  function point(x:number,y:number,c:number):number{
    let tile=last;
    if(!tile||x<tile.x||y<tile.y||x>=tile.x+tile.width||y>=tile.y+tile.height){
      const tx=Math.floor(x/size),ty=Math.floor(y/size),key=ty*Math.ceil(width/size)+tx;
      tile=tiles.get(key);
      if(tile){tiles.delete(key);tiles.set(key,tile);}else{
        const left=tx*size,top=ty*size,w=Math.min(size,width-left),h=Math.min(size,height-top),pixels=image.readRegion!(left,top,w,h);
        if(pixels.length!==w*h*channels)throw new Error('Invalid native lens tile extent.');
        const gains=vignette?new Float64Array(w*h):undefined;
        if(gains)for(let yy=0;yy<h;yy++)for(let xx=0;xx<w;xx++){
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
    return tile.pixels[index*channels+(channels===1?0:c)]*(tile.gains?.[index]??1);
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
    const pixels=new Uint16Array(width*count*3),alpha=new Uint8Array(width*count);
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
