/** Encode a detail or precision plane from exactly the same rounded low plane. */
export function encodeFrequencyBand(source: usize, low: usize, length: i32, correction: bool): void {
  for(let i=0;i<length;i+=4){
    for(let c:usize=0;c<3;c++){
      const pixel=source+<usize>i+c,original=<i32>load<u8>(pixel),blurred=<i32>load<u8>(low+<usize>i+c);
      store<u8>(pixel,correction?<u8>(255-(original<255&&((original-blurred)&1)==0?1:0)):<u8>Math.round(127.5+<f64>(original-blurred)/2.0));
    }
    store<u8>(source+<usize>i+3,255);
  }
}
