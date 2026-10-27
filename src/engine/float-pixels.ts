import{z}from'zod';
import{BLEND_MODES,type BlendMode}from'../core/model';
import{forkPixelKernel,type PixelKernel}from'./wasm';
export const floatCompositeOptionsSchema=z.object({mode:z.enum(BLEND_MODES).default('normal'),opacity:z.number().finite().min(0).max(1).default(1),mask:z.instanceof(Float32Array).optional()}).strict();
export interface FloatCompositeOptions{mode?:BlendMode;opacity?:number;mask?:Float32Array}
const WINDOW=65536;
function samples(value:Float32Array,label:string){
 if(!(value instanceof Float32Array)||!(value.buffer instanceof ArrayBuffer)||('resizable'in value.buffer&&value.buffer.resizable)||('detached'in value.buffer&&value.buffer.detached)||value.length%4)throw new Error(label+' must be owned, fixed straight RGBA float32 samples.');
}
export function validateFloatWorkerWindow(value:Float32Array){samples(value,'Float window');if(value.length>262144*4)throw new Error('Split float work into windows of at most 262144 pixels; this is a working-buffer budget.');for(let i=0;i<value.length;i++)if(!Number.isFinite(value[i])||i%4===3&&(value[i]<0||value[i]>1))throw new Error('Float window samples or alpha are invalid.');}
function checked(status:number){if(status===1)throw new Error('Float pixels, alpha, coverage or matrix are invalid.');if(status===2)throw new Error('Artistic float blending currently requires normalized RGB [0,1]; use normal for finite extended RGB.');if(status!==0)throw new Error('Float processing output is not finite float32.');}
/** Private native precision dependency. Does not change the document renderer
 * or expose another public mutation API. Callers supply one common RGB encoding.
 * Private memory and owned outputs prevent ordinary byte work from overwriting it. */
export class FloatPixelProcessor{
 private kernel:PixelKernel|null;
 constructor(seed:PixelKernel){const kernel=forkPixelKernel(seed);if(typeof kernel.compositeFloat!=='function'||typeof kernel.affineFloat!=='function')throw new Error('Float pixel kernel exports are unavailable.');this.kernel=kernel;}
 dispose(){this.kernel=null;}
 private owner(){if(!this.kernel)throw new Error('Float pixel processor is disposed.');return this.kernel;}
 private layout(pixels:number,masked=false){
  const kernel=this.owner(),base=Math.ceil(kernel.bufferOffset()/8)*8,bytes=pixels*16,source=base,backdrop=source+bytes,output=backdrop+bytes,mask=output+bytes,scratch=Math.ceil((mask+(masked?pixels*4:0))/8)*8,matrix=scratch+24,required=matrix+96;
  if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));return{kernel,source,backdrop,output,mask:masked?mask:0,scratch,matrix};
 }
 composite(source:Float32Array,backdrop:Float32Array,options:FloatCompositeOptions={}):Float32Array<ArrayBuffer>{
  this.owner();const settings=floatCompositeOptionsSchema.parse(options);samples(source,'Source');samples(backdrop,'Backdrop');if(source.length!==backdrop.length)throw new Error('Float source and backdrop geometry differ.');
  const coverage=settings.mask;if(coverage&&(!(coverage.buffer instanceof ArrayBuffer)||('resizable'in coverage.buffer&&coverage.buffer.resizable)||('detached'in coverage.buffer&&coverage.buffer.detached)||coverage.length!==source.length/4))throw new Error('Float coverage must contain one fixed sample per pixel.');
  const result=new Float32Array(source.length),mode=BLEND_MODES.indexOf(settings.mode);
  for(let at=0;at<source.length;at+=WINDOW*4){const count=Math.min(WINDOW,(source.length-at)/4),p=this.layout(count,!!coverage),memory=p.kernel.memory.buffer;
   new Float32Array(memory,p.source,count*4).set(source.subarray(at,at+count*4));new Float32Array(memory,p.backdrop,count*4).set(backdrop.subarray(at,at+count*4));if(coverage)new Float32Array(memory,p.mask,count).set(coverage.subarray(at/4,at/4+count));
   checked(p.kernel.compositeFloat(p.source,p.backdrop,p.output,p.mask,p.scratch,count,settings.opacity,mode));result.set(new Float32Array(p.kernel.memory.buffer,p.output,count*4),at);
  }return result;
 }
 affine(pixels:Float32Array,matrix:readonly number[]):Float32Array<ArrayBuffer>{
  this.owner();samples(pixels,'Input');if(!Array.isArray(matrix)||matrix.length!==12||![...matrix].every(Number.isFinite))throw new Error('Use twelve finite RGB affine coefficients.');const coefficients=new Float64Array(matrix),result=new Float32Array(pixels.length);
  for(let at=0;at<pixels.length;at+=WINDOW*4){const count=Math.min(WINDOW,(pixels.length-at)/4),p=this.layout(count);new Float32Array(p.kernel.memory.buffer,p.source,count*4).set(pixels.subarray(at,at+count*4));new Float64Array(p.kernel.memory.buffer,p.matrix,12).set(coefficients);checked(p.kernel.affineFloat(p.source,p.output,p.matrix,count));result.set(new Float32Array(p.kernel.memory.buffer,p.output,count*4),at);}return result;
 }
}
