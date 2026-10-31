/** Premultiplied encoded RGB, replacement alpha, and independent coverage.
 * Replacement is already masked; coverage must never multiply it again. */
export function validateWetField(value:unknown,pixels:number):asserts value is Float32Array<ArrayBuffer>{
 if(!(value instanceof Float32Array)||!(value.buffer instanceof ArrayBuffer)||
  ('resizable'in value.buffer&&value.buffer.resizable)||('detached'in value.buffer&&value.buffer.detached)||
  !Number.isSafeInteger(pixels)||pixels<1||value.length!==pixels*5)throw new Error('Invalid native wet field geometry.');
 for(let i=0;i<value.length;i+=5){
  const a=value[i+3],coverage=value[i+4];
  if(!Number.isFinite(a)||!Number.isFinite(coverage)||a<0||coverage>1||a>coverage||
   !Number.isFinite(value[i])||!Number.isFinite(value[i+1])||!Number.isFinite(value[i+2])||
   value[i]<0||value[i+1]<0||value[i+2]<0||value[i]>a||value[i+1]>a||value[i+2]>a)
   throw new Error('Wet replacement colors/alpha must be premultiplied and bounded by coverage.');
 }
}
