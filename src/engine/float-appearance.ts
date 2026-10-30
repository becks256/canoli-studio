import type{DocumentData}from'../core/model';
import type{AssetStore}from'../core/assets';
import type{FloatSourceWindow}from'../core/float-source/types';
import type{FloatSceneFrame}from'./float-frame';
import{validateFloatWorkerWindow}from'./float-pixels';

interface Plan{key:string;source:symbol;x:number;y:number;local:FloatSourceWindow;world:FloatSourceWindow}
interface Entry{key:string;source:symbol;pixels:Float32Array<ArrayBuffer>}
const identity=(m:{a:number;b:number;c:number;d:number;e:number;f:number}|undefined)=>!m||m.a===1&&m.b===0&&m.c===0&&m.d===1&&m.e===0&&m.f===0;

/** One complete native appearance, at most 4 MiB. No original/blob/asset lease,
 * byte color, document history, or viewport canvas is retained here. A hit is
 * only used after normal scene capture/source preparation/lifetime validation.
 * Export/reference renders explicitly bypass it with cache:false. */
export class FloatAppearanceCache{
 private originals=new WeakMap<Blob,symbol>();private entry?:Entry;
 clear(){this.entry=undefined;}
 plan(document:DocumentData,assets:AssetStore,frame:FloatSceneFrame):Plan|undefined{
  if(![document.width,document.height].every(v=>Number.isSafeInteger(v)&&v>0)||![frame.region.x+frame.width,frame.region.y+frame.height].every(Number.isSafeInteger)||document.children.length!==1||frame.width!==frame.region.width||frame.height!==frame.region.height||!identity(frame.rootTransform)||![frame.region.x,frame.region.y,frame.width,frame.height].every(Number.isSafeInteger)||frame.width<=0||frame.height<=0)return;
  const layer=document.children[0];
  if(layer.kind!=='raster'||!layer.visible||layer.opacity===0||layer.clipped||layer.blendMode!=='normal'||!identity(layer.transform)||![layer.x,layer.y].every(Number.isSafeInteger)||layer.erasures?.length||layer.effects.some(e=>e.enabled&&(e.exposure!==0||e.contrast!==0||e.saturation!==0)))return;
  if(layer.styles?.blendIf.enabled||layer.styles?.colorOverlay.enabled&&layer.styles.colorOverlay.opacity>0)return;
  const asset=assets.get(layer.assetId);
  if(layer.width!==asset.width||layer.height!==asset.height)return;
  const mask=layer.mask;let maskKey:readonly number[]|null=null;
  if(mask?.enabled&&mask.density!==0){
   if(mask.linked===false||mask.kind!=='selection'||mask.inverted||mask.density!==1||mask.feather||mask.strokes?.length||!identity(mask.basis)||![mask.x??0,mask.y??0].every(Number.isSafeInteger)||mask.selection.regions.length!==1)return;
   const r=mask.selection.regions[0];
   if(r.shape!=='rectangle'||r.operation!=='add'||!identity(r.transform)||![r.x,r.y,r.width,r.height].every(Number.isSafeInteger))return;
   maskKey=[mask.x??0,mask.y??0,r.x,r.y,r.width,r.height];
   // Keep Canvas mask coordinates and native sampling exactly representable.
   for(const [offset,start,size,position]of[[mask.x??0,r.x,r.width,layer.x],[mask.y??0,r.y,r.height,layer.y]])for(const end of[start,start+size])if(!Number.isSafeInteger(end+offset)||!Number.isSafeInteger(end+offset+position)||(end+offset+position)-position!==end+offset)return;
  }
  const shadow=layer.styles?.dropShadow,active=!!shadow?.enabled&&shadow.opacity>0,radius=active?Math.ceil(3*shadow.blur):0;
  // Include a transparent safety sample beyond the finite Gaussian/bilinear
  // support, and the full intrinsic source (including hidden RGB).
  const left=active?Math.min(0,Math.floor(shadow.x)-radius-1):0,top=active?Math.min(0,Math.floor(shadow.y)-radius-1):0;
  const right=active?Math.max(layer.width,Math.ceil(layer.width+shadow.x)+radius+1):layer.width,bottom=active?Math.max(layer.height,Math.ceil(layer.height+shadow.y)+radius+1):layer.height;
  const local={x:left,y:top,width:right-left,height:bottom-top};
  if(local.width>2048||local.height>2048||local.width*local.height>262144)return;
  // Near extreme authored coordinates even half-pixels or fractional shadow
  // offsets can lose precision. Such placements use the established renderer.
  for(const [position,start,size,offset]of[[layer.x,left,local.width,active?shadow.x:0],[layer.y,top,local.height,active?shadow.y:0]])for(let p=start-radius-2;p<=start+size+radius+2;p++){
   const world=position+p;
   if(!Number.isSafeInteger(world)||world-position!==p||(world+.5)-position!==p+.5||(world-offset)-position!==p-offset)return;
  }
  let source=this.originals.get(asset.blob);if(!source){source=Symbol('immutable float original');this.originals.set(asset.blob,source);}
  // Only effective appearance fields belong in the key. Unrelated authored
  // metadata/names must not turn a bounded pixel cache into a metadata cache.
  const {x,y}=layer,key=JSON.stringify([layer.opacity,layer.fillOpacity??1,active?shadow:null,maskKey,asset.width,asset.height,asset.tiff,asset.tiffColor?.source]);
  return{key,source,x,y,local,world:{...local,x:x+left,y:y+top}};
 }
 get(plan:Plan){const entry=this.entry;return entry?.key===plan.key&&entry.source===plan.source?entry:undefined;}
 put(plan:Plan,pixels:Float32Array<ArrayBuffer>){
  validateFloatWorkerWindow(pixels);
  if(pixels.length!==plan.local.width*plan.local.height*4)throw new Error('Float appearance differs from complete native support.');
  return this.entry={key:plan.key,source:plan.source,pixels};
 }
 read(plan:Plan,entry:Entry,bounds:FloatSourceWindow,frame:FloatSceneFrame,document:DocumentData):Float32Array<ArrayBuffer>{
  const output=new Float32Array(bounds.width*bounds.height*4),x=frame.region.x+bounds.x,y=frame.region.y+bounds.y;
  const left=Math.max(x,0,plan.world.x),top=Math.max(y,0,plan.world.y),right=Math.min(x+bounds.width,document.width,plan.world.x+plan.world.width),bottom=Math.min(y+bounds.height,document.height,plan.world.y+plan.world.height);
  for(let row=top;row<bottom;row++)if(right>left){const start=((row-plan.world.y)*plan.local.width+left-plan.world.x)*4;output.set(entry.pixels.subarray(start,start+(right-left)*4),((row-y)*bounds.width+left-x)*4);}
  return output;
 }
}
