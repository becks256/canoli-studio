import {strokeBounds,type BrushStrokeData,type Rect} from '../core/drawing';
import {strokeCaptureRegion,strokeIntersectsRegion} from './stroke-region';

/** Match live source reconstruction and completed TIFF geometry. The existing
 * 4096-reference stroke budget is separate from original image dimensions. */
export function floatCloneCaptureRegions(stroke:BrushStrokeData):readonly Rect[]{
 const bounds=strokeBounds(stroke),left=Math.floor(bounds.x),top=Math.floor(bounds.y),right=Math.ceil(bounds.x+bounds.width),bottom=Math.ceil(bounds.y+bounds.height),regions:Rect[]=[];
 if(![left,top,right,bottom].every(Number.isSafeInteger))throw new Error('Native clone footprint exceeds coordinate precision.');
 for(let y=top;y<bottom;y+=512)for(let x=left;x<right;x+=512){
  const cell={x,y,width:Math.min(512,right-x),height:Math.min(512,bottom-y)};if(!strokeIntersectsRegion(stroke,cell))continue;const region=strokeCaptureRegion(stroke,cell);if(!region)continue;
  regions.push(Object.freeze(region));if(regions.length>4096)throw new Error('Clone stroke exceeds its 4096 native source-tile metadata budget.');
 }
 return Object.freeze(regions);
}
