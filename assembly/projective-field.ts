/** Infinite scalar field, unlike image sampling: no quad clip or image-edge
 * clamp. Outside finite support (including the inverse horizon) is background. */
export function sampleProjectiveFieldFloat(source:usize,output:usize,settings:usize):i32 {
  return sampleField(source,output,settings,1);
}
/** Coupled premultiplied replacement and its independent removal coverage. */
export function sampleProjectiveWetFloat(source:usize,output:usize,settings:usize):i32 {
  return sampleField(source,output,settings,5);
}
function sampleField(source:usize,output:usize,settings:usize,channels:i32):i32 {
  for(let i=0;i<24;i++)if(!isFinite(load<f64>(settings+<usize>(i*8))))return 1;
  const originX=load<f64>(settings+72),originY=load<f64>(settings+80);
  const fieldX=load<f64>(settings+88),fieldY=load<f64>(settings+96),fieldW=load<f64>(settings+104),fieldH=load<f64>(settings+112);
  const sx=load<f64>(settings+120),sy=load<f64>(settings+128),sw=<i32>load<f64>(settings+136),sh=<i32>load<f64>(settings+144);
  const ox=load<f64>(settings+152),oy=load<f64>(settings+160),ow=<i32>load<f64>(settings+168),oh=<i32>load<f64>(settings+176),background=load<f64>(settings+184);
  if(fieldW<1||fieldH<1||sw<1||sh<1||ow<1||oh<1||<i64>sw*sh>262144||<i64>ow*oh>262144||background<0||background>1)return 1;
  if(channels==5&&background!=0)return 1;
  for(let i=0;i<sw*sh*channels;i++){const value=load<f32>(source+<usize>(i*4));if(!isFinite(value)||value<0||value>1)return 1;}
  if(channels==5)for(let i=0;i<sw*sh;i++){
    const p=source+<usize>(i*20),a=load<f32>(p+12),coverage=load<f32>(p+16);
    if(a>coverage||load<f32>(p)>a||load<f32>(p+4)>a||load<f32>(p+8)>a)return 1;
  }
  for(let row=0;row<oh;row++)for(let col=0;col<ow;col++){
    const x=(ox+col-originX)+.5,y=(oy+row-originY)+.5;
    const w=load<f64>(settings+48)*x+load<f64>(settings+56)*y+load<f64>(settings+64);
    const nu=load<f64>(settings)*x+load<f64>(settings+8)*y+load<f64>(settings+16),nv=load<f64>(settings+24)*x+load<f64>(settings+32)*y+load<f64>(settings+40);
    if(!isFinite(w)||!isFinite(nu)||!isFinite(nv))return 1;
    const out=output+<usize>((row*ow+col)*channels*4);
    if(w==0){for(let c=0;c<channels;c++)store<f32>(out+<usize>(c*4),<f32>background);continue;}
    const u=nu/w-.5,v=nv/w-.5;
    // Overflowed quotients lie beyond every finite support rectangle.
    if(u<fieldX-1||v<fieldY-1||u>=fieldX+fieldW||v>=fieldY+fieldH){for(let c=0;c<channels;c++)store<f32>(out+<usize>(c*4),<f32>background);continue;}
    if(!isFinite(u)||!isFinite(v))return 1;
    const ix=Math.floor(u),iy=Math.floor(v),fx=u-ix,fy=v-iy;
    for(let c=0;c<channels;c++){
    let value=0.0;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
      const weight=(dx==1?fx:1-fx)*(dy==1?fy:1-fy);if(weight==0)continue;
      const px=ix+dx,py=iy+dy;let sample=background;
      if(px>=fieldX&&py>=fieldY&&px<fieldX+fieldW&&py<fieldY+fieldH){
        const rx=px-sx,ry=py-sy;if(rx<0||ry<0||rx>=sw||ry>=sh)return 3;
        sample=load<f32>(source+<usize>(((<i32>ry*sw+<i32>rx)*channels+c)*4));
      }
      value+=sample*weight;
    }
    if(!isFinite(value))return 2;
    store<f32>(out+<usize>(c*4),<f32>Math.max(0.0,Math.min(1.0,value)));
    }
  }
  return 0;
}
