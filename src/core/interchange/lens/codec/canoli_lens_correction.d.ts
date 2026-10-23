export interface NativeLensModule {
  HEAPU8:Uint8Array;
  _malloc(bytes:number):number;
  _free(pointer:number):void;
  _canoli_lens_create(maker:number,makerLength:number,model:number,modelLength:number,crop:number,aspect:number,centerX:number,centerY:number,minFocal:number,maxFocal:number):number;
  _canoli_lens_add(kind:number,model:number,focal:number,aperture:number,distance:number,realFocal:number,crop:number,aspect:number,terms:number,count:number):number;
  _canoli_lens_initialize(focal:number,crop:number,width:number,height:number,aperture:number,distance:number,scale:number,flags:number):number;
  _canoli_lens_coordinates(x:number,y:number,width:number,height:number):number;
  _canoli_lens_gains(x:number,y:number,width:number,height:number):number;
  _canoli_lens_data():number;
  _canoli_lens_info():number;
  _canoli_lens_coefficients():number;
  _canoli_lens_error():number;
  _canoli_lens_release():void;
}
export default function createModule(options?:{wasmBinary?:Uint8Array;locateFile?:(path:string)=>string}):Promise<NativeLensModule>;
