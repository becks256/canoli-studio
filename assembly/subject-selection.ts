// Allocation-free source saliency. Parameters: border RGB, visible count, maximum score.
function luminance(pixels: usize, index: i32): f64 {
  const p = pixels + <usize>index * 4;
  if (!load<u8>(p+3)) return 0;
  return .299 * load<u8>(p) + .587 * load<u8>(p+1) + .114 * load<u8>(p+2);
}
function score(pixels: usize, width: i32, height: i32, index: i32, values: usize): f64 {
  const p = pixels + <usize>index * 4;
  if (!load<u8>(p+3)) return 0;
  if (load<f64>(values+24) == 0) return 1; // Majority-transparent border: intrinsic alpha is evidence.
  const x = index % width, y = index / width;
  const dr = <f64>load<u8>(p)-load<f64>(values), dg = <f64>load<u8>(p+1)-load<f64>(values+8), db = <f64>load<u8>(p+2)-load<f64>(values+16);
  const distance = Math.sqrt(dr*dr+dg*dg+db*db)/441.6729559300637;
  let edge: f64 = 0;
  if (x>0 && x<width-1 && y>0 && y<height-1) {
    const gx = -luminance(pixels,index-width-1)+luminance(pixels,index-width+1)-2*luminance(pixels,index-1)+2*luminance(pixels,index+1)-luminance(pixels,index+width-1)+luminance(pixels,index+width+1);
    const gy = -luminance(pixels,index-width-1)-2*luminance(pixels,index-width)-luminance(pixels,index-width+1)+luminance(pixels,index+width-1)+2*luminance(pixels,index+width)+luminance(pixels,index+width+1);
    edge = Math.sqrt(gx*gx+gy*gy)/1020;
  }
  const dx = <f64>x-<f64>width/2, dy = <f64>y-<f64>height/2, sigma = <f64>Math.max(width,height)*.45;
  return (.7*distance+.3*edge)*(.3+.7*Math.exp(-(dx*dx+dy*dy)/(2*sigma*sigma)));
}
export function subjectModel(pixels: usize, width: i32, height: i32, values: usize): void {
  const border:i32 = <i32>Math.max(1,Math.min(16,Math.min(width,height)/20));
  let r:f64=0,g:f64=0,b:f64=0,n:f64=0;
  for (let y=0;y<height;y++) for (let x=0;x<width;x++) {
    if (x>=border && x<width-border && y>=border && y<height-border) {x=width-border-1;continue;}
    const p=pixels+<usize>(y*width+x)*4;
    if (load<u8>(p+3)) {r+=load<u8>(p);g+=load<u8>(p+1);b+=load<u8>(p+2);n++;}
  }
  const perimeter=<f64>width*<f64>height-<f64>Math.max(0,width-2*border)*<f64>Math.max(0,height-2*border);
  store<f64>(values,n?r/n:0);store<f64>(values+8,n?g/n:0);store<f64>(values+16,n?b/n:0);store<f64>(values+24,n*2<perimeter?0:n);store<f64>(values+32,0);
}
export function subjectMaximum(pixels: usize, width:i32, height:i32, start:i32, count:i32, values:usize):void {
  let maximum=load<f64>(values+32);
  for(let i=start;i<start+count;i++) maximum=Math.max(maximum,score(pixels,width,height,i,values));
  store<f64>(values+32,maximum);
}
export function subjectAlpha(pixels:usize,width:i32,height:i32,start:i32,count:i32,values:usize,threshold:f64,output:usize):void {
  const maximum=load<f64>(values+32);
  for(let n=0;n<count;n++) {
    const i=start+n, value=score(pixels,width,height,i,values);
    store<u8>(output+<usize>n,maximum>1e-12 && value>0 && value/maximum>=threshold?load<u8>(pixels+<usize>i*4+3):0);
  }
}
