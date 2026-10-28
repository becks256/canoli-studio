import{captureLutHeader,lutValues,type LutAdjustmentData}from'./lut';
/** A mathematically exact identity, rather than an approximate f32 ramp. The
 * declared domain still clips coordinates outside its range. */
export function exactFloatLutIdentity(settings:LutAdjustmentData,values:Float32Array):boolean{
 const{lut}=settings,n=lut.size;
 for(let at=0;at<values.length;at++){
  const c=at%3,row=Math.floor(at/3),coordinate=lut.dimension===1?row:c===0?row%n:c===1?Math.floor(row/n)%n:Math.floor(row/(n*n));
  if(values[at]!==lut.domainMin[c]+(lut.domainMax[c]-lut.domainMin[c])*coordinate/(n-1))return false;
 }
 return true;
}
export function compileFloatLookup(input:LutAdjustmentData){
 const settings=captureLutHeader(input),values=lutValues(settings.lut);return{settings,values,identity:exactFloatLutIdentity(settings,values)};
}
