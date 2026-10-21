function byte(value:f64):u8 {return <u8>Math.round(Math.max(0,Math.min(255,value)));}

/** Full 2D bilateral mean over original samples, preserving center coverage/hidden RGB. */
export function bilateralFilter(input:usize,output:usize,spatial:usize,range:usize,
  width:i32,height:i32,radius:i32,amount:f64):void {
  memory.copy(output,input,<usize>(width*height*4));
  const edge=radius*2+1;
  for(let y:i32=0;y<height;y++)for(let x:i32=0;x<width;x++){
    const at=input+<usize>((y*width+x)*4);
    if(load<u8>(at+3)===0)continue;
    const red=<i32>load<u8>(at),green=<i32>load<u8>(at+1),blue=<i32>load<u8>(at+2);
    let r:f64=0,g:f64=0,b:f64=0,total:f64=0;
    for(let yy=max<i32>(0,y-radius);yy<=min<i32>(height-1,y+radius);yy++)
      for(let xx=max<i32>(0,x-radius);xx<=min<i32>(width-1,x+radius);xx++){
        const sample=input+<usize>((yy*width+xx)*4),alpha=<i32>load<u8>(sample+3);
        if(alpha===0)continue;
        const sr=<i32>load<u8>(sample),sg=<i32>load<u8>(sample+1),sb=<i32>load<u8>(sample+2);
        const dr=sr-red,dg=sg-green,db=sb-blue,distance=dr*dr+dg*dg+db*db;
        const weight=<f64>alpha*load<f64>(spatial+<usize>(((yy-y+radius)*edge+xx-x+radius)*8))*load<f64>(range+<usize>(distance*8));
        r+=<f64>sr*weight;g+=<f64>sg*weight;b+=<f64>sb*weight;total+=weight;
      }
    const target=output+<usize>((y*width+x)*4);
    store<u8>(target,byte(<f64>red+amount*(r/total-<f64>red)));
    store<u8>(target+1,byte(<f64>green+amount*(g/total-<f64>green)));
    store<u8>(target+2,byte(<f64>blue+amount*(b/total-<f64>blue)));
  }
}
