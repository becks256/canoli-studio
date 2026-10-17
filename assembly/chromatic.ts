function channel(v:f64):u8{return <u8>Math.round(Math.max(0.0,Math.min(1.0,v))*255.0);}
/** Encoded RGB channel arithmetic; preserve straight alpha exactly. */
export function adjustChromatic(ptr:usize,length:i32,values:usize,vibrance:bool):void{
  let neutral=true;
  const parameterCount=vibrance ? 2 : 9;
  for(let c=0;c<parameterCount;c++)if(load<f64>(values+<usize>(c*8))!=0){neutral=false;break;}
  if(neutral)return;
  for(let i=0;i<length;i+=4){
    const p=ptr+<usize>i;
    const r=<f64>load<u8>(p)/255.0,g=<f64>load<u8>(p+1)/255.0,b=<f64>load<u8>(p+2)/255.0;
    const l=0.3*r+0.59*g+0.11*b;
    let red:f64=0,green:f64=0,blue:f64=0;
    let preserve=true;
    if(vibrance){
      const chroma=Math.max(r,Math.max(g,b))-Math.min(r,Math.min(g,b));
      const scale=Math.max(0.0,1.0+(load<f64>(values+8)+load<f64>(values)*(1.0-chroma))/100.0);
      red=l+(r-l)*scale;green=l+(g-l)*scale;blue=l+(b-l)*scale;
    }else{
      const shadows=Math.max(0.0,1.0-2.0*l),highlights=Math.max(0.0,2.0*l-1.0),midtones=1.0-shadows-highlights;
      red=r+(load<f64>(values)*shadows+load<f64>(values+24)*midtones+load<f64>(values+48)*highlights)/100.0;
      green=g+(load<f64>(values+8)*shadows+load<f64>(values+32)*midtones+load<f64>(values+56)*highlights)/100.0;
      blue=b+(load<f64>(values+16)*shadows+load<f64>(values+40)*midtones+load<f64>(values+64)*highlights)/100.0;
      preserve=load<f64>(values+72)!=0;
    }
    if(preserve){
      const delta=l-(0.3*red+0.59*green+0.11*blue);
      red+=delta;green+=delta;blue+=delta;
      const n=Math.min(red,Math.min(green,blue)),x=Math.max(red,Math.max(green,blue));
      if(n<0){red=l+(red-l)*l/(l-n);green=l+(green-l)*l/(l-n);blue=l+(blue-l)*l/(l-n);}
      if(x>1){red=l+(red-l)*(1-l)/(x-l);green=l+(green-l)*(1-l)/(x-l);blue=l+(blue-l)*(1-l)/(x-l);}
    }
    store<u8>(p,channel(red));store<u8>(p+1,channel(green));store<u8>(p+2,channel(blue));
  }
}
