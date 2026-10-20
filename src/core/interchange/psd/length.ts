import {ByteWriter} from './stream';
import {photoshopVersion,type PhotoshopFormat} from './export-plan';

/** Channel, layer-info and layer/mask lengths widen in PSB; resource lengths do not. */
export function photoshopLength(value:number,format:PhotoshopFormat):Uint8Array<ArrayBuffer>{
  const version=photoshopVersion(format);
  if(!Number.isSafeInteger(value)||value<0)throw new Error('Photoshop section length exceeds exact browser addressing.');
  if(version===1&&value>0xffffffff)throw new Error('PSD section exceeds its 32-bit length. Choose PSB.');
  const writer=new ByteWriter();if(version===2)writer.writeUint64(value);else writer.writeUint32(value);
  return new Uint8Array(writer.getBuffer());
}
