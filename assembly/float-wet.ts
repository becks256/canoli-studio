/** Native straight/premultiplied linear RGBA. No byte/gamut conversion. */
function unit(v:f64):bool{return isFinite(v)&&v>=0&&v<=1;}
function rgba(p:usize,count:i32,premultiplied:bool=false):bool{
 if(count<0)return false;
 for(let i=0;i<count;i++){
  const at=p+<usize>i*16,alpha=load<f32>(at+12);if(!unit(alpha))return false;
  for(let c:usize=0;c<3;c++){const v=load<f32>(at+c*4);if(!isFinite(v)||premultiplied&&alpha==0&&v!=0)return false;}
 }
 return true;
}
function copy(from:usize,to:usize):void{for(let c:usize=0;c<4;c++)store<f32>(to+c*4,load<f32>(from+c*4));}
function coverage(p:usize,count:i32):bool{for(let i=0;i<count;i++)if(!unit(load<f32>(p+<usize>i*4)))return false;return true;}
/** Status: 0 complete, 1 invalid input, 3 unrepresentable float32 output. */
export function loadWetPaintFloat(source:usize,output:usize,count:i32,red:f64,green:f64,blue:f64,alpha:f64,amount:f64):i32{
 if(!rgba(source,count)||!unit(alpha)||!unit(amount)||!isFinite(<f32>red)||!isFinite(<f32>green)||!isFinite(<f32>blue))return 1;
 for(let i=0;i<count;i++){
  const p=source+<usize>i*16,q=output+<usize>i*16,sa=<f64>load<f32>(p+12),a=sa*(1-amount)+alpha*amount,stored=<f32>a;
  for(let c:usize=0;c<3;c++){
   const paint=c==0?red:c==1?green:blue;
   const v=stored==0?<f32>0:<f32>(<f64>load<f32>(p+c*4)*sa*(1-amount)+paint*alpha*amount);
   if(!isFinite(v))return 3;store<f32>(q+c*4,v);
  }
  store<f32>(q+12,stored);
 }
 return 0;
}
/** Pickup reads the immutable pre-deposit source. Separate outputs may alias
 * their corresponding private inputs; no pixel reads a neighbor's output. */
export function mixWetPaintFloat(source:usize,carried:usize,mask:usize,output:usize,next:usize,count:i32,flow:f64,wetness:f64,pickup:f64):i32{
 if(!rgba(source,count)||!rgba(carried,count,true)||!unit(flow)||!unit(wetness)||!unit(pickup)||!coverage(mask,count))return 1;
 for(let i=0;i<count;i++){
  const at=<usize>i*16,p=source+at,r=carried+at,q=output+at,n=next+at;
  const strength=flow*<f64>load<f32>(mask+<usize>i*4),deposit=strength*(1-wetness),acquire=strength*pickup;
  const sa=<f64>load<f32>(p+12),ca=<f64>load<f32>(r+12),alpha=sa*(1-deposit)+ca*deposit,na=ca*(1-acquire)+sa*acquire;
  const storedAlpha=<f32>alpha,storedNext=<f32>na;
  if(deposit==0)copy(p,q);
  if(acquire==0)copy(r,n);
  for(let c:usize=0;c<3;c++){
   const old=<f64>load<f32>(p+c*4)*sa,paint=<f64>load<f32>(r+c*4);
   if(deposit>0){const v=storedAlpha==0?<f32>0:<f32>((old*(1-deposit)+paint*deposit)/alpha);if(!isFinite(v))return 3;store<f32>(q+c*4,v);}
   if(acquire>0){const v=storedNext==0?<f32>0:<f32>(paint*(1-acquire)+old*acquire);if(!isFinite(v))return 3;store<f32>(n+c*4,v);}
  }
  if(deposit>0)store<f32>(q+12,storedAlpha);
  if(acquire>0)store<f32>(n+12,storedNext);
 }
 return 0;
}
/** Apply captured selection/stroke opacity once to completed before/after work. */
export function envelopeWetPaintFloat(before:usize,after:usize,mask:usize,output:usize,count:i32,opacity:f64):i32{
 if(!rgba(before,count)||!rgba(after,count)||!unit(opacity)||!coverage(mask,count))return 1;
 for(let i=0;i<count;i++){
  const at=<usize>i*16,p=before+at,r=after+at,q=output+at,amount=opacity*<f64>load<f32>(mask+<usize>i*4);
  if(amount==0){copy(p,q);continue;}if(amount==1){copy(r,q);continue;}
  const a=<f64>load<f32>(p+12)*(1-amount),b=<f64>load<f32>(r+12)*amount,alpha=a+b,stored=<f32>alpha;
  for(let c:usize=0;c<3;c++){const v=stored==0?<f32>0:<f32>((<f64>load<f32>(p+c*4)*a+<f64>load<f32>(r+c*4)*b)/alpha);if(!isFinite(v))return 3;store<f32>(q+c*4,v);}
  store<f32>(q+12,stored);
 }
 return 0;
}

/** Complete prepared replacement: independent removal, already covered pigment.
 * Keep intermediate fields in f64 and store straight destination f32 once. */
export function compositeHdrWetFloat(before:usize,field:usize,output:usize,count:i32,opacity:f64):i32{
 if(!rgba(before,count)||!unit(opacity))return 1;
 for(let i=0;i<count;i++){
  const p=field+<usize>i*40,a=load<f64>(p+24),coverage=load<f64>(p+32);
  if(!unit(a)||!unit(coverage)||a>coverage)return 1;
  for(let c:usize=0;c<3;c++){const v=load<f64>(p+c*8);if(!isFinite(v)||a==0&&v!=0)return 1;}
 }
 for(let i=0;i<count;i++){
  const p=before+<usize>i*16,f=field+<usize>i*40,q=output+<usize>i*16,coverage=load<f64>(f+32);
  if(opacity==0||coverage==0){copy(p,q);continue;}
  const left=1-opacity*coverage,a=left==0?load<f64>(f+24)*opacity:<f64>load<f32>(p+12)*left+load<f64>(f+24)*opacity,stored=<f32>a;
  for(let c:usize=0;c<3;c++){const pigment=load<f64>(f+c*8)*opacity,numerator=left==0?pigment:<f64>load<f32>(p+c*4)*<f64>load<f32>(p+12)*left+pigment,v=stored==0?<f32>0:<f32>(numerator/a);if(!isFinite(v))return 3;store<f32>(q+c*4,v);}
  store<f32>(q+12,stored);
 }
 return 0;
}
