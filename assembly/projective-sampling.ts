/** Private source-native perspective sampler. All geometry/weights use f64;
 * straight signed/HDR float32 colors are filtered through premultiplied alpha.
 * Host supplies a checked convex image quad, inverse map and complete ROI. */
export function sampleProjectiveFloat(source:usize,output:usize,settings:usize,scratch:usize):i32 {
  for(let i=0;i<27;i++)if(!isFinite(load<f64>(settings+<usize>(i*8))))return 1;
  const fullW=load<f64>(settings+136),fullH=load<f64>(settings+144),sx=load<f64>(settings+152),sy=load<f64>(settings+160);
  const sw=<i32>load<f64>(settings+168),sh=<i32>load<f64>(settings+176),ox=load<f64>(settings+184),oy=load<f64>(settings+192),ow=<i32>load<f64>(settings+200),oh=<i32>load<f64>(settings+208);
  if(fullW<1||fullH<1||sw<1||sh<1||ow<1||oh<1||<i64>sw*sh>262144||<i64>ow*oh>262144)return 1;
  for(let i=0;i<sw*sh*4;i++){
    const v=load<f32>(source+<usize>(i*4));if(!isFinite(v)||(i%4==3&&(v<0||v>1)))return 1;
  }
  const bufferA=scratch,bufferB=scratch+256;
  memory.fill(output,0,<usize>(ow*oh*16));
  for(let row=0;row<oh;row++)for(let col=0;col<ow;col++){
    const px=ox+col,py=oy+row;
    for(let i=0;i<4;i++){
      store<f64>(bufferA+<usize>(i*16),load<f64>(settings+<usize>(72+i*16))-px);
      store<f64>(bufferA+<usize>(i*16+8),load<f64>(settings+<usize>(80+i*16))-py);
    }
    let count=4,current=bufferA,next=bufferB;
    for(let edge=0;edge<4&&count>0;edge++){
      const axis=edge<2?0:8,limit=edge%2==0?0.0:1.0,lower=edge%2==0;
      let used=0;
      for(let i=0;i<count;i++){
        const a=current+<usize>(i*16),b=current+<usize>(((i+1)%count)*16),av=load<f64>(a+<usize>axis)-limit,bv=load<f64>(b+<usize>axis)-limit;
        const insideA=lower?av>=0:av<=0,insideB=lower?bv>=0:bv<=0;
        if(insideA){if(used>=16)return 1;store<f64>(next+<usize>(used*16),load<f64>(a));store<f64>(next+<usize>(used*16+8),load<f64>(a+8));used++;}
        if(insideA!=insideB){
          if(used>=16)return 1;const t=av/(av-bv),x=load<f64>(a)+(load<f64>(b)-load<f64>(a))*t,y=load<f64>(a+8)+(load<f64>(b+8)-load<f64>(a+8))*t;
          if(!isFinite(x)||!isFinite(y))return 1;store<f64>(next+<usize>(used*16),x);store<f64>(next+<usize>(used*16+8),y);used++;
        }
      }
      count=used;const previous=current;current=next;next=previous;
    }
    if(count<3)continue;
    let area=0.0,cx=0.0,cy=0.0;
    for(let i=0;i<count;i++){
      const a=current+<usize>(i*16),b=current+<usize>(((i+1)%count)*16),ax=load<f64>(a),ay=load<f64>(a+8),bx=load<f64>(b),by=load<f64>(b+8),cross=ax*by-bx*ay;
      area+=cross;cx+=(ax+bx)*cross;cy+=(ay+by)*cross;
    }
    if(area==0)continue;
    const coverage=Math.min(1.0,Math.abs(area)*.5),x=(px-load<f64>(settings+72))+cx/(3*area),y=(py-load<f64>(settings+80))+cy/(3*area);
    const w=load<f64>(settings+48)*x+load<f64>(settings+56)*y+load<f64>(settings+64);
    const u=(load<f64>(settings)*x+load<f64>(settings+8)*y+load<f64>(settings+16))/w-.5;
    const v=(load<f64>(settings+24)*x+load<f64>(settings+32)*y+load<f64>(settings+40))/w-.5;
    if(!isFinite(u)||!isFinite(v)||!isFinite(coverage))return 1;
    const nx=Math.max(0.0,Math.min(fullW-1,u)),ny=Math.max(0.0,Math.min(fullH-1,v)),ix=Math.floor(nx),iy=Math.floor(ny),fx=nx-ix,fy=ny-iy;
    let alpha=0.0,r=0.0,g=0.0,b=0.0;
    for(let dy=0;dy<2;dy++)for(let dx=0;dx<2;dx++){
      const weight=(dx==1?fx:1-fx)*(dy==1?fy:1-fy);if(weight==0)continue;
      const rx=Math.min(fullW-1,ix+dx)-sx,ry=Math.min(fullH-1,iy+dy)-sy;
      if(rx<0||ry<0||rx>=sw||ry>=sh)return 3;
      const at=source+<usize>((<i32>ry*sw+<i32>rx)*16),a=<f64>load<f32>(at+12)*weight;
      alpha+=a;r+=<f64>load<f32>(at)*a;g+=<f64>load<f32>(at+4)*a;b+=<f64>load<f32>(at+8)*a;
    }
    const oa=<f32>(alpha*coverage);if(oa==0)continue;
    const red=<f32>(r/alpha),green=<f32>(g/alpha),blue=<f32>(b/alpha);
    if(!isFinite(red)||!isFinite(green)||!isFinite(blue)||!isFinite(oa)||oa<0||oa>1)return 2;
    const out=output+<usize>((row*ow+col)*16);store<f32>(out,red);store<f32>(out+4,green);store<f32>(out+8,blue);store<f32>(out+12,oa);
  }
  return 0;
}
