export interface NativeRawModule {
  readonly HEAPU8:Uint8Array;
  canoliRawProgress?:(stage:number,iteration:number,expected:number)=>void;
  _malloc(bytes:number):number;
  _free(pointer:number):void;
  _canoli_raw_process(pointer:number,length:number,mode:number,image:number,wb:number,quality:number,highlights:number,exposure:number,preservation:number,red:number,green:number,blue:number):number;
  _canoli_raw_info():number;
  _canoli_raw_pixels():number;
  _canoli_raw_text(index:number):number;
  _canoli_raw_error():number;
  _canoli_raw_release():void;
}
export default function createCanoliRawDecoder(options?:{wasmBinary?:ArrayBuffer|Uint8Array;locateFile?:(name:string)=>string;print?:(text:string)=>void;printErr?:(text:string)=>void}):Promise<NativeRawModule>;
