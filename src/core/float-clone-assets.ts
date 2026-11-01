import {z} from 'zod';
import type {BrushStrokeData,CloneTile} from './drawing';
import type {DocumentData,LayerData} from './model';
import type {WetAssetProvider,WetImageSource} from './wet-assets';
import {captureFieldBounds} from './projective-field';
import {validateFloatWetTile,type FloatWetTileControl} from './float-wet-tile';
import type {FloatSourceWindow} from './float-source/types';

export function* floatCloneLayerOperations(layer:LayerData):Generator<BrushStrokeData>{
 if(layer.kind==='paint')for(const stroke of layer.strokes)if(stroke.kind==='clone'&&stroke.precision==='float32')yield stroke;
 if(layer.kind==='group')for(const child of layer.children)yield* floatCloneLayerOperations(child);
}
export function* floatCloneDocumentOperations(document:DocumentData,seen=new Set<DocumentData>()):Generator<BrushStrokeData>{
 if(seen.has(document))return;seen.add(document);
 for(const layer of document.children)yield* floatCloneLayerOperations(layer);
 for(const definition of document.components??[])if(definition.source.kind==='document')yield* floatCloneDocumentOperations(definition.source.document,seen);
}
const tileSchema=z.object({x:z.number(),y:z.number(),width:z.number(),height:z.number(),assetId:z.string().min(1).max(240)}).strict();
export interface FloatCloneAssetTile {readonly region:Readonly<FloatSourceWindow>;readonly original:Blob}
export interface CapturedFloatCloneAssets {readonly tiles:readonly FloatCloneAssetTile[];check():void;dispose():void}
/** Pin every original before awaiting complete canonical RGBA32 validation.
 * Alpha is source alpha, never wet removal coverage or a display thumbnail. */
export async function captureFloatCloneAssets(input:readonly CloneTile[],provider:Pick<WetAssetProvider,'get'|'check'>,control:FloatWetTileControl={}):Promise<CapturedFloatCloneAssets>{
 const pins=new Map<string,Readonly<WetImageSource>>(),signal=control.signal;let external=control.check,host:typeof provider|undefined=provider,closed=false,tiles:readonly FloatCloneAssetTile[]=[];
 const alive=()=>{signal?.throwIfAborted();if(closed)throw new Error('Float clone asset capture is disposed.');};
 const check=()=>{alive();host!.check?.();alive();external?.();alive();for(const[id,pin]of pins){const now=host!.get(id,'float32');alive();if(now.blob!==pin.blob||now.width!==pin.width||now.height!==pin.height||now.identity!==pin.identity||now.pixels!==pin.pixels)throw new Error('A prepared float clone source changed.');}alive();};
 const dispose=()=>{closed=true;pins.clear();tiles=[];host=undefined;external=undefined;};
 try{
  check();if(!Array.isArray(input)||!input.length)throw new Error('Float clone capture requires native source tiles.');
  const metadata=input.map(tile=>tileSchema.parse(tile));
  tiles=Object.freeze(metadata.map(tile=>{const region=Object.freeze(captureFieldBounds({x:tile.x,y:tile.y,width:tile.width,height:tile.height}));if(typeof tile.assetId!=='string'||!tile.assetId||tile.assetId.length>240)throw new Error('Invalid float clone source reference.');let source=pins.get(tile.assetId);if(!source){source=Object.freeze({...host!.get(tile.assetId,'float32')});pins.set(tile.assetId,source);}if(source.width!==region.width||source.height!==region.height)throw new Error('Float clone source dimensions must match the native tile.');return Object.freeze({region,original:source.blob});}));check();
  for(const tile of tiles){await validateFloatWetTile(tile.original,tile.region.width,tile.region.height,{check});check();}
  return Object.freeze({get tiles(){check();return tiles;},check,dispose});
 }catch(error){dispose();throw error;}
}
export async function validateFloatCloneAssets(document:DocumentData,provider:Pick<WetAssetProvider,'get'|'check'>):Promise<void>{
 const tiles=[...floatCloneDocumentOperations(document)].flatMap(stroke=>stroke.tiles);if(!tiles.length)return;
 const capture=await captureFloatCloneAssets(tiles,provider);capture.dispose();
}
