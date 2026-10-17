/** Independent raster geometry checks. Retain raw max residuals separately;
 * these checks do not establish pixel identity or a causal rounding diagnosis. */
export function compareImportPixels(a:Uint8ClampedArray,b:Uint8ClampedArray,width:number,height:number){
 let interiorErrors=0,contourErrors=0,areaA=0,areaB=0,ax=0,ay=0,bx=0,by=0;
 const sample=(p:Uint8ClampedArray,index:number,channel:number)=>channel===3?p[index+3]:p[index+channel]*p[index+3]/255;
 for(let y=0;y<height;y++)for(let x=0;x<width;x++){
  const index=(y*width+x)*4,aa=a[index+3],ba=b[index+3];areaA+=aa;areaB+=ba;ax+=x*aa;ay+=y*aa;bx+=x*ba;by+=y*ba;
  let changed=false;for(let c=0;c<4;c++)if(Math.abs(sample(a,index,c)-sample(b,index,c))>3)changed=true;
  if(changed){let boundaryA=false,boundaryB=false;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;const next=(yy*width+xx)*4;for(let c=0;c<4;c++){if(Math.abs(sample(a,index,c)-sample(a,next,c))>3)boundaryA=true;if(Math.abs(sample(b,index,c)-sample(b,next,c))>3)boundaryB=true;}}if(!boundaryA&&!boundaryB)interiorErrors++;}
  if((aa>=128)!==(ba>=128)){
   let nearbyA=false,nearbyB=false;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const xx=x+dx,yy=y+dy;if(xx<0||yy<0||xx>=width||yy>=height)continue;const next=(yy*width+xx)*4;if((a[next+3]>=128)===(ba>=128))nearbyA=true;if((b[next+3]>=128)===(aa>=128))nearbyB=true;}if(!nearbyA||!nearbyB)contourErrors++;
  }
 }
 return{interiorErrors,contourErrors,areaError:Math.abs(areaA-areaB)/Math.max(1,areaA),centroidError:Math.hypot(ax/Math.max(1,areaA)-bx/Math.max(1,areaB),ay/Math.max(1,areaA)-by/Math.max(1,areaB))};
}
