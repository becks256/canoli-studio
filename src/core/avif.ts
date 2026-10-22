import {z} from 'zod';

export const avifSettingsSchema=z.object({
  quality:z.number().finite().min(.01).max(1).default(.8),
  lossless:z.boolean().default(false),
  speed:z.number().int().min(0).max(10).default(8),
}).strict();
export type AvifSettings=z.infer<typeof avifSettingsSchema>;
export function avifSettings(value:unknown={}):AvifSettings {
  const settings=avifSettingsSchema.parse(value);
  // The codec selects identity RGB and zero quantization at quality 100.
  if(settings.lossless||settings.quality===1){settings.lossless=true;settings.quality=1;}
  return settings;
}
export function avifGeometry(width:unknown,height:unknown):{width:number;height:number;bytes:number}{
  // The encoder's width/height parameters are signed 32-bit native integers.
  const dimension=(value:unknown):value is number=>typeof value==='number'&&Number.isSafeInteger(value)&&value>0&&value<=0x7fffffff;
  if(!dimension(width)||!dimension(height)||!Number.isSafeInteger(width*height*4))throw new Error('AVIF cannot represent these native image dimensions.');
  return{width,height,bytes:width*height*4};
}
export interface AvifInfo {
  width:number;height:number;alpha:boolean;bitDepth:8;
  colour:{primaries:number;transfer:number;matrix:number;fullRange:boolean;offset:number};
  dataBytes:number;
}

/** Validate the owned encoder's still-image container, without decoding its AV1 payload. */
export function inspectAvif(input:Uint8Array):AvifInfo {
  const bytes=input,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),sizes:{width:number;height:number}[]=[],colours:AvifInfo['colour'][]=[];
  let boxes=0,ftyp=0,meta=0,configurations=0,pixelPlanes=0,dataBytes=0,alpha=false;
  const text=(start:number,length:number)=>String.fromCharCode(...bytes.subarray(start,start+length));
  const invalid=(message:string):never=>{throw new Error(`Invalid AVIF output: ${message}`);};
  const walk=(start:number,end:number,depth:number)=>{
    if(depth>8)invalid('metadata nesting exceeds the validation budget.');
    while(start<end){
      if(++boxes>4096||end-start<8)invalid('invalid box table.');
      let size=view.getUint32(start),header=8;const type=text(start+4,4);
      if(size===1){if(end-start<16)invalid('truncated extended box.');const wide=view.getBigUint64(start+8);if(wide>BigInt(Number.MAX_SAFE_INTEGER))invalid('unsafe box length.');size=Number(wide);header=16;}
      else if(size===0)size=end-start;
      if(size<header||size>end-start)invalid('box extends beyond its parent.');
      const body=start+header,limit=start+size,length=limit-body;
      if(depth===0&&type==='ftyp'){
        if(++ftyp!==1||length<8||length>1024||length%4)invalid('invalid file type.');
        const brands=[text(body,4)];for(let i=body+8;i<limit;i+=4)brands.push(text(i,4));
        if(!brands.includes('avif')||brands.includes('avis'))invalid('not a still AVIF image.');
      }else if(depth===0&&type==='meta'){
        if(++meta!==1||length<4||view.getUint32(body)!==0)invalid('unsupported metadata header.');walk(body+4,limit,depth+1);
      }else if(depth===0&&type==='mdat')dataBytes+=length;
      else if(type==='iprp'&&depth===1||type==='ipco'&&depth===2)walk(body,limit,depth+1);
      else if(depth===3){
        if(type==='ispe'){
          if(length!==12||view.getUint32(body)!==0)invalid('invalid image geometry.');
          const width=view.getUint32(body+4),height=view.getUint32(body+8);if(!width||!height)invalid('empty image geometry.');sizes.push({width,height});
        }else if(type==='pixi'){
          if(length<6||view.getUint32(body)!==0)invalid('invalid pixel depth.');const channels=bytes[body+4];
          if(![1,3].includes(channels)||length!==5+channels||!bytes.subarray(body+5,limit).every(value=>value===8))invalid('expected 8-bit colour/alpha planes.');pixelPlanes++;
        }else if(type==='av1C'){
          if(length<4||bytes[body]!==0x81)invalid('invalid AV1 configuration.');configurations++;
        }else if(type==='auxC'){
          if(length<5||length>256||view.getUint32(body)!==0||bytes[limit-1]!==0)invalid('invalid auxiliary plane.');
          if(text(body+4,length-5)==='urn:mpeg:mpegB:cicp:systems:auxiliary:alpha')alpha=true;
        }else if(type==='colr'){
          if(length!==11||text(body,4)!=='nclx')invalid('expected explicit colour identification.');
          colours.push({primaries:view.getUint16(body+4),transfer:view.getUint16(body+6),matrix:view.getUint16(body+8),fullRange:bytes[body+10]===0x80,offset:body+4});
        }
      }
      start=limit;
    }
  };
  walk(0,bytes.length,0);
  if(ftyp!==1||meta!==1||dataBytes===0||!sizes.length||!configurations||!pixelPlanes||colours.length!==1)invalid('missing image properties or payload.');
  if(alpha&&(pixelPlanes<2||configurations<2))invalid('missing alpha configuration.');
  const {width,height}=sizes[0];if(sizes.some(size=>size.width!==width||size.height!==height))invalid('inconsistent plane geometry.');
  return{width,height,alpha,bitDepth:8,colour:colours[0],dataBytes};
}

/** libavif defaults to unspecified primaries/transfer. Identify our known sRGB input in place. */
export function identifyAvifSrgb(bytes:Uint8Array):AvifInfo {
  const info=inspectAvif(bytes),colour=info.colour;
  if(![1,2].includes(colour.primaries)||![2,13].includes(colour.transfer)||![0,6].includes(colour.matrix)||!colour.fullRange)throw new Error('The AVIF encoder returned an unexpected colour space.');
  const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);view.setUint16(colour.offset,1);view.setUint16(colour.offset+2,13);
  return inspectAvif(bytes);
}
export function assertAvifResult(info:AvifInfo,width:number,height:number,requiresAlpha:boolean):void{
  if(info.width!==width||info.height!==height)throw new Error('AVIF encoder returned different image dimensions.');
  if(requiresAlpha&&!info.alpha)throw new Error('AVIF encoder omitted required transparency.');
  if(info.colour.primaries!==1||info.colour.transfer!==13||![0,6].includes(info.colour.matrix)||!info.colour.fullRange)throw new Error('AVIF output does not identify the expected sRGB colour.');
}
