export interface NativeIccModule {
 readonly HEAPU8:Uint8Array<ArrayBuffer>;
 _malloc(bytes:number):number;
 _free(pointer:number):void;
 _canoli_icc_close():void;
 _canoli_icc_error():number;
 _canoli_icc_info():number;
 _canoli_icc_text(index:number):number;
 _canoli_icc_version():number;
 _canoli_icc_inspect(pointer:number,length:number):number;
 _canoli_icc_begin(pointer:number,length:number,mode:number,intent:number,proofIntent:number,bpc:number,gamut:number,alarmRgb:number):number;
 _canoli_icc_apply(input:number,output:number,pixels:number):number;
}
export default function createCanoliIcc(options:{wasmBinary?:Uint8Array;locateFile?:(path:string)=>string}):Promise<NativeIccModule>;
