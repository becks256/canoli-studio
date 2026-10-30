import{floatConvolutionSchema,floatConvolutionLength,validateFloatAlpha,type FloatConvolutionOptions}from'../core/float-shadow';
import {floatTonalOptionsSchema, type FloatTonalOptions} from '../core/float-tonal';
import{gaussianWeights}from'../core/smart/spatial-filter';
import{compileFloatStyle}from'../core/float-style';
import type{LayerStyleData}from'../core/drawing';
import{compileFloatColor,type FloatColorAdjustment}from'../core/float-color';
import{compileFloatGradient}from'../core/float-gradient';
import type{GradientMapAdjustmentData}from'../core/gradient-map';
import{compileFloatTransfer,FLOAT_TRANSFER_VALUES,type FloatTransferAdjustment}from'../core/float-transfer';
import{z}from'zod';
import{BLEND_MODES,type BlendMode}from'../core/model';
import{forkPixelKernel,type PixelKernel}from'./wasm';
import{TONE_LIMITS}from'../core/tone';
export const floatToneOptionsSchema=z.object({exposure:z.number().finite().min(TONE_LIMITS.exposure.min).max(TONE_LIMITS.exposure.max).default(0),contrast:z.number().finite().min(TONE_LIMITS.contrast.min).max(TONE_LIMITS.contrast.max).default(0),saturation:z.number().finite().min(TONE_LIMITS.saturation.min).max(TONE_LIMITS.saturation.max).default(0)}).strict();
export type FloatToneOptions=z.input<typeof floatToneOptionsSchema>;
export const floatCompositeOptionsSchema=z.object({mode:z.enum(BLEND_MODES).default('normal'),opacity:z.number().finite().min(0).max(1).default(1),mask:z.instanceof(Float32Array).optional()}).strict();
export interface FloatCompositeOptions{mode?:BlendMode;opacity?:number;mask?:Float32Array}
export interface FloatStyleResult{pixels:Float32Array;coverage:Float32Array}
export function validateFloatStyleResult(value:unknown,length:number,alpha:Uint32Array):asserts value is FloatStyleResult{
 if(!value||typeof value!=='object'||Object.keys(value).length!==2||!('pixels'in value)||!('coverage'in value))throw new Error('Invalid float style worker result.');
 const {pixels,coverage}=value as FloatStyleResult;validateFloatWorkerWindow(pixels);
 if(pixels.length!==length||!(coverage instanceof Float32Array)||!(coverage.buffer instanceof ArrayBuffer)||('resizable'in coverage.buffer&&coverage.buffer.resizable)||('detached'in coverage.buffer&&coverage.buffer.detached)||coverage.length!==length/4)throw new Error('Float style result geometry differs.');
 const words=new Uint32Array(pixels.buffer,pixels.byteOffset,pixels.length);
 for(let i=0;i<coverage.length;i++)if(!Number.isFinite(coverage[i])||coverage[i]<0||coverage[i]>1||words[i*4+3]!==alpha[i])throw new Error('Float style coverage or alpha differs.');
}
const WINDOW=65536;
function samples(value:Float32Array,label:string){
 if(!(value instanceof Float32Array)||!(value.buffer instanceof ArrayBuffer)||('resizable'in value.buffer&&value.buffer.resizable)||('detached'in value.buffer&&value.buffer.detached)||value.length%4)throw new Error(label+' must be owned, fixed straight RGBA float32 samples.');
}
export function validateFloatWorkerWindow(value:Float32Array){samples(value,'Float window');if(value.length>262144*4)throw new Error('Split float work into windows of at most 262144 pixels; this is a working-buffer budget.');for(let i=0;i<value.length;i++)if(!Number.isFinite(value[i])||i%4===3&&(value[i]<0||value[i]>1))throw new Error('Float window samples or alpha are invalid.');}
function checked(status:number){if(status===1)throw new Error('Float pixels, alpha, coverage or matrix are invalid.');if(status===2)throw new Error('This blend mode requires normalized RGB [0,1]. Choose Normal for signed or extended-range colors.');if(status!==0)throw new Error('Float processing output is not finite float32.');}
/** Private native precision dependency. Does not change the document renderer
 * or expose another public mutation API. Callers supply one common RGB encoding.
 * Private memory and owned outputs prevent ordinary byte work from overwriting it. */
export class FloatPixelProcessor{
 private kernel:PixelKernel|null;
 constructor(seed:PixelKernel){const kernel=forkPixelKernel(seed);if(typeof kernel.convolveAlphaFloat!=='function'||typeof kernel.styleFloat!=='function'||typeof kernel.compositeFloat!=='function'||typeof kernel.affineFloat!=='function'||typeof kernel.toneFloat!=='function'||typeof kernel.transferFloat!=='function'||typeof kernel.colorFloat!=='function'||typeof kernel.gradientFloat!=='function')throw new Error('Float pixel kernel exports are unavailable.');this.kernel=kernel;}
 dispose(){this.kernel=null;}
 tonal(pixels:Float32Array,coverage:Float32Array,input:FloatTonalOptions):Float32Array<ArrayBuffer>{
  const kernel=this.owner();if(typeof kernel.tonalFloat!=='function')throw new Error('Float tonal kernel export is unavailable.');const options=floatTonalOptionsSchema.parse(input);samples(pixels,'Input');validateFloatAlpha(coverage,pixels.length/4);
  const result=new Float32Array(pixels.length);
  for(let at=0;at<pixels.length;at+=WINDOW*4){
   const count=Math.min(WINDOW,(pixels.length-at)/4),p=this.layout(count,true),memory=p.kernel.memory.buffer;
   new Float32Array(memory,p.source,count*4).set(pixels.subarray(at,at+count*4));new Float32Array(memory,p.mask,count).set(coverage.subarray(at/4,at/4+count));
   checked(p.kernel.tonalFloat(p.source,p.output,p.mask,count,options.exposure,options.flow,options.mode==='dodge'?0:1,['shadows','midtones','highlights'].indexOf(options.range),options.protectTones));
   result.set(new Float32Array(p.kernel.memory.buffer,p.output,count*4),at);
  }
  return result;
 }
 private owner(){if(!this.kernel)throw new Error('Float pixel processor is disposed.');return this.kernel;}
 convolveAlpha(alpha:Float32Array,input:FloatConvolutionOptions):Float32Array<ArrayBuffer>{
  const kernel=this.owner(),settings=floatConvolutionSchema.parse(input),length=floatConvolutionLength(settings);validateFloatAlpha(alpha,settings.width*settings.height);
  const weights=gaussianWeights(settings.sigma),source=Math.ceil(kernel.bufferOffset()/8)*8,output=source+alpha.length*4,coefficients=Math.ceil((output+length*4)/8)*8,required=coefficients+weights.byteLength;
  if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));
  new Float32Array(kernel.memory.buffer,source,alpha.length).set(alpha);new Float64Array(kernel.memory.buffer,coefficients,weights.length).set(weights);
  checked(kernel.convolveAlphaFloat(source,output,coefficients,settings.width,settings.height,Math.ceil(settings.sigma*3),settings.axis==='horizontal'?0:1));
  const result=new Float32Array(new Float32Array(kernel.memory.buffer,output,length));validateFloatAlpha(result,length);return result;
 }
 private layout(pixels:number,masked=false,extra=0){
  const kernel=this.owner(),base=Math.ceil(kernel.bufferOffset()/8)*8,bytes=pixels*16,source=base,backdrop=source+bytes,output=backdrop+bytes,mask=output+bytes,scratch=Math.ceil((mask+(masked?pixels*4:0))/8)*8,matrix=scratch+24,required=matrix+96+extra;
  if(required>kernel.memory.buffer.byteLength)kernel.memory.grow(Math.ceil((required-kernel.memory.buffer.byteLength)/65536));return{kernel,source,backdrop,output,mask:masked?mask:0,scratch,matrix};
 }
 style(source:Float32Array,backdrop:Float32Array,input:LayerStyleData):FloatStyleResult{
  this.owner();const {values,channel}=compileFloatStyle(input);samples(source,'Source');samples(backdrop,'Backdrop');if(source.length!==backdrop.length)throw new Error('Float style source and backdrop geometry differ.');
  const result=new Float32Array(source.length),coverage=new Float32Array(source.length/4);
  for(let at=0;at<source.length;at+=WINDOW*4){
   const count=Math.min(WINDOW,(source.length-at)/4),p=this.layout(count,true,values.length*8),memory=p.kernel.memory.buffer;
   new Float32Array(memory,p.source,count*4).set(source.subarray(at,at+count*4));new Float32Array(memory,p.backdrop,count*4).set(backdrop.subarray(at,at+count*4));new Float64Array(memory,p.matrix,values.length).set(values);
   checked(p.kernel.styleFloat(p.source,p.backdrop,p.output,p.mask,p.matrix,count,channel));result.set(new Float32Array(p.kernel.memory.buffer,p.output,count*4),at);coverage.set(new Float32Array(p.kernel.memory.buffer,p.mask,count),at/4);
  }
  return{pixels:result,coverage};
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
 color(pixels:Float32Array,adjustment:FloatColorAdjustment):Float32Array<ArrayBuffer>{
  this.owner();const{kind,values}=compileFloatColor(adjustment);samples(pixels,'Input');const result=new Float32Array(pixels.length);
  for(let at=0;at<pixels.length;at+=WINDOW*4){const count=Math.min(WINDOW,(pixels.length-at)/4),p=this.layout(count);new Float32Array(p.kernel.memory.buffer,p.source,count*4).set(pixels.subarray(at,at+count*4));new Float64Array(p.kernel.memory.buffer,p.matrix,values.length).set(values);const status=p.kernel.colorFloat(p.source,p.output,p.matrix,count,kind);if(status===2)throw new Error('This color adjustment requires normalized linear RGB [0,1]. Use neutral settings or an explicit Levels range for extended colors.');checked(status);result.set(new Float32Array(p.kernel.memory.buffer,p.output,count*4),at);}return result;
 }
 gradient(pixels:Float32Array,input:GradientMapAdjustmentData):Float32Array<ArrayBuffer>{
  this.owner();const{adjustment,values}=compileFloatGradient(input);samples(pixels,'Input');const result=new Float32Array(pixels.length);
  for(let at=0;at<pixels.length;at+=WINDOW*4){const count=Math.min(WINDOW,(pixels.length-at)/4),p=this.layout(count,false,values.length*8);new Float32Array(p.kernel.memory.buffer,p.source,count*4).set(pixels.subarray(at,at+count*4));new Float64Array(p.kernel.memory.buffer,p.matrix,values.length).set(values);checked(p.kernel.gradientFloat(p.source,p.output,p.matrix,count,adjustment.stops.length,adjustment.reverse));result.set(new Float32Array(p.kernel.memory.buffer,p.output,count*4),at);}return result;
 }
 transfer(pixels:Float32Array,adjustment:FloatTransferAdjustment):Float32Array<ArrayBuffer>{
  this.owner();const{values}=compileFloatTransfer(adjustment);samples(pixels,'Input');const result=new Float32Array(pixels.length);
  for(let at=0;at<pixels.length;at+=WINDOW*4){const count=Math.min(WINDOW,(pixels.length-at)/4),p=this.layout(count,false,FLOAT_TRANSFER_VALUES*8);new Float32Array(p.kernel.memory.buffer,p.source,count*4).set(pixels.subarray(at,at+count*4));new Float64Array(p.kernel.memory.buffer,p.matrix,FLOAT_TRANSFER_VALUES).set(values);checked(p.kernel.transferFloat(p.source,p.output,p.matrix,count));result.set(new Float32Array(p.kernel.memory.buffer,p.output,count*4),at);}return result;
 }
 tone(pixels:Float32Array,options:FloatToneOptions={}):Float32Array<ArrayBuffer>{
  this.owner();const settings=floatToneOptionsSchema.parse(options);samples(pixels,'Input');const result=new Float32Array(pixels.length);
  for(let at=0;at<pixels.length;at+=WINDOW*4){const count=Math.min(WINDOW,(pixels.length-at)/4),p=this.layout(count);new Float32Array(p.kernel.memory.buffer,p.source,count*4).set(pixels.subarray(at,at+count*4));checked(p.kernel.toneFloat(p.source,p.output,count,settings.exposure,settings.contrast,settings.saturation));result.set(new Float32Array(p.kernel.memory.buffer,p.output,count*4),at);}
  return result;
 }
 affine(pixels:Float32Array,matrix:readonly number[]):Float32Array<ArrayBuffer>{
  this.owner();samples(pixels,'Input');if(!Array.isArray(matrix)||matrix.length!==12||![...matrix].every(Number.isFinite))throw new Error('Use twelve finite RGB affine coefficients.');const coefficients=new Float64Array(matrix),result=new Float32Array(pixels.length);
  for(let at=0;at<pixels.length;at+=WINDOW*4){const count=Math.min(WINDOW,(pixels.length-at)/4),p=this.layout(count);new Float32Array(p.kernel.memory.buffer,p.source,count*4).set(pixels.subarray(at,at+count*4));new Float64Array(p.kernel.memory.buffer,p.matrix,12).set(coefficients);checked(p.kernel.affineFloat(p.source,p.output,p.matrix,count));result.set(new Float32Array(p.kernel.memory.buffer,p.output,count*4),at);}return result;
 }
}
