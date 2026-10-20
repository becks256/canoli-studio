import {SCHEMA_VERSION,type BlendMode,type LayerBlendMode,type DocumentData,type LayerData,type GroupLayerData} from '../../model';
import {AffineTransform} from '../../affine';
import {localBounds,localTransform} from '../../spatial';
import {maskTransform,type LayerMaskData} from '../../masks';
import {captureFrequencyRadius} from '../../frequency-separation';

export type PsdExportMode='layers'|'flatten';
export type PhotoshopFormat='psd'|'psb';
export function photoshopVersion(format:PhotoshopFormat):1|2{
 if(format!=='psd'&&format!=='psb')throw new Error('Choose PSD or PSB for Photoshop export.');
 return format==='psb'?2:1;
}
export interface PsdRenderedMask {
 id:string;mask:LayerMaskData;world:AffineTransform;enabled:boolean;
 left:number;top:number;width:number;height:number;document:DocumentData;
}
export interface PsdRenderedLayer {
 name:string;visible:boolean;opacity:number;blendMode:BlendMode;fillOpacity?:number;locked?:boolean;
 left:number;top:number;width:number;height:number;document:DocumentData;merged:boolean;mask?:PsdRenderedMask;
}
export interface PsdGroupRecord {
 name:string;visible:boolean;opacity:number;fillOpacity:number;blendMode:LayerBlendMode;locked:boolean;
 left:number;top:number;width:0;height:0;mask?:PsdRenderedMask;
}
export type PsdExportRecord={kind:'pixels';layer:PsdRenderedLayer}|{kind:'group';group:PsdGroupRecord}|{kind:'group-end';group:PsdGroupRecord};
export interface PsdExportPlan {
 layers:PsdRenderedLayer[];records:PsdExportRecord[];masks:PsdRenderedMask[];
 mergedThrough:number;reuseComposite:boolean;scopedMerges:string[];bakedGroups:string[];foldedGroupFill:string[];bakedLayerFill:string[];
}

/** Format bounds are independent of editor/import geometry and working buffers. */
export function validatePsdDimensions(width:number,height:number,format:PhotoshopFormat='psd'):void{
 const maximum=photoshopVersion(format)===2?300000:30000;
 if(![width,height].every(value=>Number.isSafeInteger(value)&&value>=1&&value<=maximum))
  throw new Error(`${format.toUpperCase()} supports dimensions from 1 to ${maximum.toLocaleString('en-US')} pixels. ${format==='psd'?'Choose PSB for larger Photoshop documents.':'Save a Canoli Studio project or choose another supported output.'}`);
}

/** Pass-through carries unsupported backdrop dependencies outward; ordinary
 * groups stop them. Native Photoshop adjustment serialization remains separate. */
function backdropDependent(node:LayerData):boolean{
 return node.kind==='adjustment'||!!node.styles?.blendIf.enabled||
  (node.kind==='group'&&node.blendMode==='pass-through'&&node.children.some(backdropDependent));
}
function styled(node:LayerData):boolean{return !!(node.styles?.dropShadow.enabled||node.styles?.colorOverlay.enabled);}

/** Keep native groups/children/modes. Bake only unsupported effects or backdrop
 * prefixes, using private render snapshots in the complete document plane. */
export function planPsdExport(document:DocumentData,mode:PsdExportMode='layers',format:PhotoshopFormat='psd'):PsdExportPlan{
 const maximum=photoshopVersion(format)===2?300000:30000;
 if(mode!=='layers'&&mode!=='flatten')throw new Error('Choose layers or flatten for Photoshop export.');
 const canvas={left:0,top:0,width:document.width,height:document.height};
 const layers:PsdRenderedLayer[]=[],records:PsdExportRecord[]=[],masks:PsdRenderedMask[]=[],scopedMerges:string[]=[],bakedGroups:string[]=[],foldedGroupFill:string[]=[],bakedLayerFill:string[]=[];
 const doc=(children:LayerData[]):DocumentData=>({...document,schemaVersion:SCHEMA_VERSION,children});
 const pixel=(layer:PsdRenderedLayer)=>{layers.push(layer);records.push({kind:'pixels',layer});};
 const linear=(world:AffineTransform)=>({a:world.a,b:world.b,c:world.c,d:world.d,e:0,f:0});
 const placed=(node:LayerData,world:AffineTransform):LayerData=>({...captureFrequencyRadius(document,node),x:world.e,y:world.f,transform:linear(world)});
 const scopeDoc=(nodes:LayerData[],world:AffineTransform,parent?:GroupLayerData):DocumentData=>{
  if(!parent)return doc(nodes);
  return doc([{...captureFrequencyRadius(document,parent),kind:'group',children:nodes,visible:true,opacity:1,fillOpacity:1,blendMode:'normal',mask:undefined,styles:undefined,x:world.e,y:world.f,transform:linear(world)}]);
 };
 const makeMask=(node:LayerData,world:AffineTransform):PsdRenderedMask|undefined=>{
  if(!node.mask)return;
  const pin:GroupLayerData={kind:'group',id:node.id,name:node.name,x:0,y:0,visible:true,locked:false,opacity:1,blendMode:'normal',children:[],mask:{...node.mask,enabled:true,density:1}};
  const value:PsdRenderedMask={...canvas,id:node.id,mask:node.mask,world:maskTransform(node.mask,world),enabled:node.mask.enabled,document:doc([pin])};
  masks.push(value);return value;
 };
 const merge=(nodes:LayerData[],name:string,world:AffineTransform,parent?:GroupLayerData)=>pixel({...canvas,name,visible:true,opacity:1,blendMode:'normal',document:scopeDoc(nodes,world,parent),merged:true});
 if(mode==='flatten'||document.children.length===0){
  merge(document.children,document.name,new AffineTransform());
  return{layers,records,masks,mergedThrough:document.children.length-1,reuseComposite:true,scopedMerges,bakedGroups,foldedGroupFill,bakedLayerFill};
 }
 let mergedThrough=-1;
 const scope=(nodes:LayerData[],world:AffineTransform,parent?:GroupLayerData)=>{
  let through=-1;nodes.forEach((node,index)=>{if(backdropDependent(node))through=index;});
  if(!parent)mergedThrough=through;
  if(through>=0){const name=`Merged through ${nodes[through].name}`;scopedMerges.push(name);merge(nodes.slice(0,through+1),name,world,parent);}
  for(const node of nodes.slice(through+1)){
   const full=world.multiply(localTransform(node));
   if(node.kind==='group'){
    const bake=styled(node);
    if(!bake&&(node.fillOpacity??1)!==1)foldedGroupFill.push(node.name);
    const origin=(value:number)=>Number.isSafeInteger(value)&&value>=-0x80000000&&value<=0x7fffffff?value:0;
    const group:PsdGroupRecord={name:node.name,visible:node.visible,opacity:node.opacity*(bake?1:node.fillOpacity??1),fillOpacity:1,blendMode:node.blendMode,locked:node.locked,left:origin(full.e),top:origin(full.f),width:0,height:0,mask:bake?undefined:makeMask(node,full)};
    // PSD records are bottom-to-top: divider, children, then folder header.
    records.push({kind:'group-end',group:{...group,name:'</Layer group>',visible:false,opacity:1,fillOpacity:1,blendMode:'normal',locked:false,left:0,top:0,mask:undefined}});
    if(bake){
     bakedGroups.push(node.name);
     const content=placed({...node,visible:true,opacity:1,blendMode:'normal'},full);
     pixel({...canvas,name:`Rendered ${node.name}`,visible:true,opacity:1,blendMode:'normal',document:doc([content]),merged:false});
    }else scope(node.children,full,node);
    records.push({kind:'group',group});
   }else{
    const fillNeedsBaking=node.blendMode!=='normal'&&(node.fillOpacity??1)!==1;
    if(fillNeedsBaking)bakedLayerFill.push(node.name);
    const bounds=node.kind==='raster'?localBounds(node):undefined;
    const nativeRect=bounds?{left:full.e+Math.floor(bounds.x),top:full.f+Math.floor(bounds.y),width:Math.ceil(bounds.x+bounds.width)-Math.floor(bounds.x),height:Math.ceil(bounds.y+bounds.height)-Math.floor(bounds.y)}:undefined;
    const bake=styled(node)||fillNeedsBaking,native=node.kind==='raster'&&nativeRect&&full.a===1&&full.b===0&&full.c===0&&full.d===1&&!node.styles?.dropShadow.enabled&&
     Object.values(nativeRect).every(Number.isSafeInteger)&&nativeRect.width<=maximum&&nativeRect.height<=maximum&&
     Math.min(nativeRect.left,nativeRect.top)>=-0x80000000&&Math.max(nativeRect.left+nativeRect.width,nativeRect.top+nativeRect.height)<=0x7fffffff;
    const rect=native?nativeRect:canvas;
    const content=placed({...node,visible:true,opacity:1,blendMode:'normal',fillOpacity:bake?node.fillOpacity:1,mask:bake?node.mask:undefined},full);
    pixel({...rect,name:node.name,visible:node.visible,opacity:node.opacity,fillOpacity:bake?1:node.fillOpacity??1,blendMode:node.blendMode,locked:node.locked,mask:bake?undefined:makeMask(node,full),document:doc([content]),merged:false});
   }
  }
 };
 scope(document.children,new AffineTransform());
 return{layers,records,masks,mergedThrough,reuseComposite:records.length===1&&layers[0]?.merged===true&&mergedThrough===document.children.length-1,scopedMerges,bakedGroups,foldedGroupFill,bakedLayerFill};
}
