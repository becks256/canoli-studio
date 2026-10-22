export interface NativeAvifModule {
  readonly HEAPU8:Uint8Array<ArrayBuffer>;
  _malloc(length:number):number;
  _free(pointer:number):void;
  _canoli_avif_decode(pointer:number,length:number):number;
  _canoli_avif_info():number;
  _canoli_avif_error():number;
  _canoli_avif_release():void;
}
export default function createCanoliAvifDecoder(options:{wasmBinary?:Uint8Array;locateFile?:(path:string)=>string}):Promise<NativeAvifModule>;
