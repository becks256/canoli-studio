import {z} from 'zod';
import {captureFieldBounds} from './projective-field';
import {validateFloatWetTilePair,type FloatWetTileControl} from './float-wet-tile';
import type {WetAssetProvider,WetImageSource} from './wet-assets';
import type {WetPaintTileData} from './wet-operation';
import type {FloatSourceWindow} from './float-source/types';

const reference=z.object({assetId:z.string().min(1).max(240)}).strict();
const tileSchema=z.object({x:z.number(),y:z.number(),width:z.number(),height:z.number(),assetId:reference.shape.assetId,coverage:reference}).strict();
export interface HdrWetAssetTile {readonly region:Readonly<FloatSourceWindow>;readonly pixels:Blob;readonly coverage:Blob}
export interface CapturedHdrWetAssets {
  readonly tiles:readonly HdrWetAssetTile[];
  check():void;
  dispose():void;
}

/** Private shared host boundary for the versioned HDR document contract.
 * Pin all ordered metadata and original identities before the first
 * await, then validate complete TIFF pairs independently of any display decoder. */
export async function captureHdrWetAssets(input:readonly WetPaintTileData[],provider:Pick<WetAssetProvider,'get'|'check'>,control:FloatWetTileControl={}):Promise<CapturedHdrWetAssets>{
  const signal=control.signal,pins=new Map<string,Readonly<WetImageSource>>();let external=control.check,host:Pick<WetAssetProvider,'get'|'check'>|undefined=provider,closed=false;
  const pin=(id:string)=>{
    let source=pins.get(id);if(!source){source=Object.freeze({...host!.get(id,'float32')});pins.set(id,source);}return source;
  };
  const alive=()=>{signal?.throwIfAborted();if(closed)throw new Error('HDR wet asset capture is disposed.');};
  const check=()=>{
    alive();host!.check?.();alive();external?.();alive();
    for(const[id,source]of pins){const current=host!.get(id,'float32');alive();if(current.blob!==source.blob||current.width!==source.width||current.height!==source.height||current.identity!==source.identity||current.pixels!==source.pixels)throw new Error('A prepared HDR wet asset changed during validation or rendering.');}
    alive();
  };
  const dispose=()=>{closed=true;pins.clear();tiles=[];host=undefined;external=undefined;};
  let tiles:readonly HdrWetAssetTile[]=[];
  try{
    check();if(!Array.isArray(input)||!input.length)throw new Error('An HDR wet asset capture requires prepared native tiles.');
    tiles=Object.freeze(input.map(value=>{
      const tile=tileSchema.parse(value),region=Object.freeze(captureFieldBounds({x:tile.x,y:tile.y,width:tile.width,height:tile.height}));
      const pixels=pin(tile.assetId),coverage=pin(tile.coverage.assetId);
      if([pixels,coverage].some(source=>source.width!==region.width||source.height!==region.height))throw new Error('HDR wet image and coverage dimensions must match the native tile.');
      return Object.freeze({region,pixels:pixels.blob,coverage:coverage.blob});
    }));check();
    for(const tile of tiles){await validateFloatWetTilePair(tile.pixels,tile.coverage,tile.region.width,tile.region.height,{check});check();}
    return Object.freeze({get tiles(){check();return tiles;},check,dispose});
  }catch(error){dispose();throw error;}
}
