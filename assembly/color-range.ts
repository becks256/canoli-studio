function labF(value:f64):f64 {return value>216.0/24389.0?Math.pow(value,1.0/3.0):(24389.0/27.0*value+16.0)/116.0;}
function match(samples:usize,count:i32,packed:f64,l:f64,a:f64,b:f64,fuzziness:f64):f64 {
  let best=Infinity;
  for(let i=0;i<count;i++){
    const p=samples+<usize>i*32;
    if(fuzziness==0){if(load<f64>(p)==packed)return 1;continue;}
    const dl=l-load<f64>(p+8),da=a-load<f64>(p+16),db=b-load<f64>(p+24);
    best=Math.min(best,dl*dl+da*da+db*db);
  }
  return fuzziness==0||count==0?0:Math.max(0,1-Math.sqrt(best)/fuzziness);
}
/** Parameters: normalized D50 XYZ matrix, 256 decode values, [packed RGB, Lab] samples. */
export function selectColorRange(ptr:usize,length:i32,values:usize,includes:i32,excludes:i32,fuzziness:f64,invert:bool):void {
  const samples=values+265*8;
  let previous:f64=-1,previousCoverage:f64=0;
  for(let i=0;i<length;i+=4){
    const p=ptr+<usize>i,alpha=load<u8>(p+3);if(alpha==0)continue;
    const red=load<u8>(p),green=load<u8>(p+1),blue=load<u8>(p+2);
    const packed=<f64>red*65536+<f64>green*256+<f64>blue;
    if(packed==previous){store<u8>(p+3,<u8>Math.round(<f64>alpha*previousCoverage));continue;}
    let l:f64=0,a:f64=0,b:f64=0;
    if(fuzziness>0){
      const r=load<f64>(values+72+<usize>red*8),g=load<f64>(values+72+<usize>green*8),c=load<f64>(values+72+<usize>blue*8);
      const x=labF(load<f64>(values)*r+load<f64>(values+8)*g+load<f64>(values+16)*c);
      const y=labF(load<f64>(values+24)*r+load<f64>(values+32)*g+load<f64>(values+40)*c);
      const z=labF(load<f64>(values+48)*r+load<f64>(values+56)*g+load<f64>(values+64)*c);
      l=116*y-16;a=500*(x-y);b=200*(y-z);
    }
    const coverage=match(samples,includes,packed,l,a,b,fuzziness)*(1-match(samples+<usize>includes*32,excludes,packed,l,a,b,fuzziness));
    previous=packed;previousCoverage=invert?1-coverage:coverage;
    store<u8>(p+3,<u8>Math.round(<f64>alpha*previousCoverage));
  }
}
