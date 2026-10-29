/** Valid separable convolution of an owned alpha plane. Halo is explicit;
 * borders are supplied by the captured source rather than clamped per tile. */
export function convolveAlphaFloat(source:usize,output:usize,weights:usize,width:i32,height:i32,radius:i32,axis:i32):i32{
 if(width<=0||height<=0||<i64>width*height>262144||radius<0||radius>384||axis<0||axis>1)return 1;
 const outWidth=width-(axis==0?2*radius:0),outHeight=height-(axis==1?2*radius:0);
 if(outWidth<=0||outHeight<=0)return 1;
 let total:f64=0;
 for(let k=0;k<=2*radius;k++){const w=load<f64>(weights+<usize>k*8);if(!isFinite(w)||w<0)return 1;total+=w;}
 if(Math.abs(total-1)>1e-12)return 1;
 for(let i=0;i<width*height;i++){const value=load<f32>(source+<usize>i*4);if(!isFinite(value)||value<0||value>1)return 1;}
 if(radius==0){memory.copy(output,source,<usize>width*height*4);return 0;}
 // Exact constant lines avoid radius-dependent work in opaque/empty interiors.
 // A normalized positive kernel rounds a constant f32 input back to that word.
 const lines=axis==0?height:width,edge=axis==0?width:height,outEdge=edge-2*radius;
 for(let line=0;line<lines;line++){
  const first=load<f32>(source+<usize>(axis==0?line*width:line)*4);let constant=true;
  for(let j=1;j<edge;j++)if(load<f32>(source+<usize>(axis==0?line*width+j:j*width+line)*4)!=first){constant=false;break;}
  for(let at=0;at<outEdge;at++){
   let sum:f64=first;
   if(!constant){sum=0;for(let k=0;k<=2*radius;k++)sum+=<f64>load<f32>(source+<usize>(axis==0?line*width+at+k:(at+k)*width+line)*4)*load<f64>(weights+<usize>k*8);}
   store<f32>(output+<usize>(axis==0?line*outWidth+at:at*outWidth+line)*4,<f32>Math.max(0,Math.min(1,sum)));
  }
 }
 return 0;
}
