import {DOMParser,type Element as XmlElement,type Node as XmlNode} from '@xmldom/xmldom';
import {z} from 'zod';
import {lensProfileSchema} from './schema';
import {lensCatalogSchema,lensDatabaseSourceSchema,type LensDatabaseSource,type LensCatalog} from './catalog';

const decimal=/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
function number(text:string,context:string,positive=false){
  const value=Number(text.trim());if(!decimal.test(text.trim())||!Number.isFinite(value)||!Number.isFinite(Math.fround(value))||positive&&Math.fround(value)<=0)throw new Error(`Invalid ${context}.`);return value;
}
function attributes(element:XmlElement,allowed:readonly string[]){
  for(let i=0;i<element.attributes.length;i++){const attribute=element.attributes.item(i)!;if(!allowed.includes(attribute.name))throw new Error(`Unsupported ${element.tagName} attribute: ${attribute.name}.`);}
}
function children(element:XmlNode):XmlElement[]{
  const result:XmlElement[]=[];
  for(let node=element.firstChild;node;node=node.nextSibling){
    if(node.nodeType===1){const child=node as XmlElement;if(child.namespaceURI||child.tagName.includes(':'))throw new Error('Namespaced lens database records are unsupported.');result.push(child);}
    else if(node.nodeType!==8&&!(node.nodeType===3&&!node.nodeValue?.trim()))throw new Error('Unexpected lens database content.');
  }
  return result;
}
function text(element:XmlElement,allowLanguage=false){
  attributes(element,allowLanguage?['lang']:[]);let result='';
  for(let node=element.firstChild;node;node=node.nextSibling){if(node.nodeType===3||node.nodeType===4)result+=node.nodeValue??'';else if(node.nodeType!==8)throw new Error(`Unexpected markup in ${element.tagName}.`);}
  return result.trim();
}
function labels(nodes:XmlElement[],tag:string,required=false){
  const values=nodes.filter(node=>node.tagName===tag).map(node=>({language:node.getAttribute('lang')??'',value:text(node,true)}));
  if(values.some(row=>!row.value)||new Set(values.map(row=>row.language)).size!==values.length)throw new Error(`Empty or duplicate ${tag} labels.`);
  if(!values.length&&required)throw new Error(`Missing ${tag}.`);
  const primary=values.find(row=>!row.language)?.value??values[0]?.value??'';
  return {primary,aliases:[...new Set(values.map(row=>row.value))].filter(value=>value!==primary)};
}
function one(nodes:XmlElement[],tag:string){const found=nodes.filter(node=>node.tagName===tag);if(found.length>1)throw new Error(`Duplicate ${tag}.`);return found[0];}
function scalar(nodes:XmlElement[],tag:string,fallback:number,ratio=false){
  const node=one(nodes,tag);if(!node)return fallback;const value=text(node);
  if(ratio&&value.includes(':')){const parts=value.split(':');if(parts.length!==2)throw new Error(`Invalid ${tag}.`);return number(parts[0],tag,true)/number(parts[1],tag,true);}
  return number(value,tag,true);
}
function range(nodes:XmlElement[],tag:string){
  const node=one(nodes,tag);if(!node)return {min:0,max:0};attributes(node,['min','max','value']);if(children(node).length)throw new Error(`Unexpected ${tag} content.`);
  const fixed=node.getAttribute('value'),min=node.getAttribute('min'),max=node.getAttribute('max');
  if(fixed!==null&&(min!==null||max!==null))throw new Error(`Ambiguous ${tag} range.`);
  const result=fixed!==null?{min:number(fixed,tag),max:number(fixed,tag)}:{min:min===null?0:number(min,tag),max:max===null?0:number(max,tag)};
  if(result.min<0||result.max<0||result.min&&result.max&&result.min>result.max)throw new Error(`Invalid ${tag} range.`);return result;
}
function coefficient(element:XmlElement,names:string[],fallback:number){
  const found=names.filter(name=>element.hasAttribute(name));if(found.length>1)throw new Error(`Ambiguous ${element.tagName} coefficient: ${names[0]}.`);
  return found.length?number(element.getAttribute(found[0])!,names[0]):fallback;
}
function point(element:XmlElement){
  const model=element.getAttribute('model');if(children(element).length)throw new Error('Calibration points cannot contain elements.');
  const focalLength=number(element.getAttribute('focal')??'','calibration focal length',true);
  const kind=element.tagName;
  let names:string[][]=[],defaults:number[]=[];
  if(kind==='distortion'){
    if(model==='poly3')names=[['k1','a']];else if(model==='poly5')names=[['k1','a'],['k2','b']];else if(model==='ptlens')names=[['a','k1'],['b','k2'],['c','k3']];else if(model!=='none')throw new Error(`Unsupported distortion model: ${model??'(missing)'}.`);
  }else if(kind==='tca'){
    if(model==='linear')names=[['kr','vr','alpha0'],['kb','vb','beta0']];else if(model==='poly3')names=[['vr','kr','alpha0'],['vb','kb','beta0'],['cr','alpha1'],['cb','beta1'],['br','alpha2'],['bb','beta2']];else if(model!=='none')throw new Error(`Unsupported chromatic model: ${model??'(missing)'}.`);
    defaults=[1,1];
  }else if(kind==='vignetting'){
    if(model!=='pa')throw new Error(`Unsupported vignette model: ${model??'(missing)'}.`);names=[['k1','alpha1'],['k2','alpha2'],['k3','alpha3']];
  }else throw new Error(`Unsupported calibration operation: ${kind}.`);
  attributes(element,['model','focal',...(kind==='distortion'&&model!=='none'?['real-focal']:[]),...(kind==='vignetting'?['aperture','distance']:[]),...names.flat()]);
  const terms=names.map((aliases,index)=>coefficient(element,aliases,defaults[index]??0));
  return {model,focalLength,terms,...(kind==='distortion'&&element.hasAttribute('real-focal')?{realFocalLength:number(element.getAttribute('real-focal')!,'real focal length',true)}:{}),...(kind==='vignetting'?{aperture:number(element.getAttribute('aperture')??'','calibration aperture',true),focusDistance:number(element.getAttribute('distance')??'','calibration distance',true)}:{})};
}
function uniquePoints(points:ReturnType<typeof point>[]){
  const seen=new Map<string,string>(),result:typeof points=[];let repeated=0;
  for(const value of points){
    const key=[value.focalLength,value.aperture??0,value.focusDistance??0].map(Math.fround).join(':'),identity=JSON.stringify(value,(_key,item)=>typeof item==='number'?Math.fround(item):item),prior=seen.get(key);
    if(prior!==undefined){if(prior!==identity)throw new Error('Conflicting duplicate native calibration coordinates.');repeated++;}
    else{seen.set(key,identity);result.push(value);}
  }
  return {points:result,repeated};
}
function comments(node:XmlNode,recursive:boolean){const found:string[]=[];for(let child=node.firstChild;child;child=child.nextSibling){if(child.nodeType===8&&child.nodeValue?.trim())found.push(child.nodeValue.trim());else if(recursive&&child.nodeType===1)found.push(...comments(child,true));}return found;}
const message=(error:unknown)=>String(error instanceof z.ZodError?error.issues[0]?.message:error instanceof Error?error.message:error).slice(0,1024)||'Invalid database record.';
function preview(nodes:XmlElement[],tag:string,fallback:string){const value=nodes.find(node=>node.tagName===tag)?.textContent?.trim();return(value||fallback).slice(0,512);}
function declarations(source:string){
  for(let start=source.indexOf('<');start>=0;start=source.indexOf('<',start+1)){
    const skip=source.startsWith('<!--',start)?'-->':source.startsWith('<![CDATA[',start)?']]>':null;
    if(skip){const end=source.indexOf(skip,start+1);if(end<0)throw new Error('Unclosed XML comment or CDATA.');start=end+skip.length-1;continue;}
    if(/^<!ENTITY\b/i.test(source.slice(start,start+12)))throw new Error('Lens databases cannot declare entities or internal DTD subsets.');
    if(!/^<!DOCTYPE\b/i.test(source.slice(start,start+12)))continue;
    let quote='';let end=start+9;
    for(;end<source.length;end++){const char=source[end];if(quote){if(char===quote)quote='';}else if(char==='"'||char==="'")quote=char;else if(char==='[')throw new Error('Lens databases cannot declare entities or internal DTD subsets.');else if(char==='>')break;}
    if(end===source.length)throw new Error('Unclosed XML document type.');start=end;
  }
}

/** Inert strict data parsing. External DTD identifiers are retained, never fetched. */
export function parseLensDatabaseXml(source:string,input:LensDatabaseSource):LensCatalog{
  const descriptor=lensDatabaseSourceSchema.parse(input);
  declarations(source);
  const encoding=source.match(/^\s*<\?xml\s[^?]*\bencoding\s*=\s*['"]([^'"]+)['"]/i)?.[1];if(encoding&&!/^utf-?8$/i.test(encoding))throw new Error('Lens databases require UTF-8 XML.');
  const xml=new DOMParser({onError:(_level,detail)=>{throw new Error(detail);}}).parseFromString(source,'application/xml'),root=xml.documentElement;
  if(!root||root.tagName!=='lensdatabase'||root.namespaceURI)throw new Error('Expected a Lensfun lensdatabase.');attributes(root,['version']);
  const databaseVersion=Number(root.getAttribute('version'));if(!['1','2'].includes(root.getAttribute('version')??''))throw new Error('Unsupported lens database version.');
  for(let child=xml.firstChild;child;child=child.nextSibling){if(child===root||child.nodeType===8||child.nodeType===3&&!child.nodeValue?.trim()||child.nodeType===7&&child.nodeName==='xml')continue;if(child.nodeType===10&&child.nodeName==='lensdatabase')continue;throw new Error('Unexpected lens database declaration.');}
  const globalNotices=[...comments(xml,false),...comments(root,false)];
  const result:LensCatalog={version:1,databaseVersion:databaseVersion as 1|2,source:descriptor,lenses:[],cameras:[],mounts:[]};
  for(const element of children(root)){
    const kind=element.tagName;if(!['lens','camera','mount'].includes(kind))throw new Error(`Unsupported database operation: ${kind}.`);
    // One bad record is unavailable as a whole; it never becomes a partial profile.
    let nodes:XmlElement[]=[];
    try{nodes=children(element);attributes(element,[]);}catch(error){
      const issue=message(error);
      if(kind==='lens')result.lenses.push({index:result.lenses.length,maker:'',model:'Unreadable lens',makerAliases:[],modelAliases:[],mounts:[],apertureRange:{min:0,max:0},definition:null,issues:[issue]});
      else if(kind==='camera')result.cameras.push({index:result.cameras.length,maker:'',model:'Unreadable camera',variant:'',makerAliases:[],modelAliases:[],mount:'',cropFactor:null,issues:[issue]});
      else result.mounts.push({index:result.mounts.length,name:'Unreadable mount',aliases:[],compatible:[],issues:[issue]});continue;
    }
    if(kind==='lens'){
      const index=result.lenses.length,row:LensCatalog['lenses'][number]={index,maker:preview(nodes,'maker',''),model:preview(nodes,'model','Unnamed lens'),makerAliases:[],modelAliases:[],mounts:[],apertureRange:{min:0,max:0},definition:null,issues:[]};
      try{
        for(const node of nodes)if(!['maker','model','mount','focal','aperture','type','center','cropfactor','aspect-ratio','calibration'].includes(node.tagName))throw new Error(`Unsupported lens field: ${node.tagName}.`);
        const maker=labels(nodes,'maker'),model=labels(nodes,'model',true),mounts=nodes.filter(node=>node.tagName==='mount').map(node=>text(node));if(!mounts.length||mounts.some(value=>!value))throw new Error('A lens requires a mount.');
        const typeNode=one(nodes,'type');if(typeNode&&text(typeNode).toLowerCase()!=='rectilinear')throw new Error(`Unsupported lens projection: ${text(typeNode)}.`);
        const centerNode=one(nodes,'center');let center={x:0,y:0};if(centerNode){attributes(centerNode,['x','y']);if(children(centerNode).length)throw new Error('Unexpected center content.');center={x:centerNode.hasAttribute('x')?number(centerNode.getAttribute('x')!,'center x'):0,y:centerNode.hasAttribute('y')?number(centerNode.getAttribute('y')!,'center y'):0};}
        // Validate singleton declarations, but preserve the upstream sequential
        // calibration-frame inheritance across sibling calibration elements.
        scalar(nodes,'cropfactor',1);scalar(nodes,'aspect-ratio',1.5,true);
        let cropFactor=1,aspectRatio=1.5;const frames=new Map<string,{cropFactor:number;aspectRatio:number;distortion:ReturnType<typeof point>[];chromatic:ReturnType<typeof point>[];vignette:ReturnType<typeof point>[]}>();
        for(const node of nodes){
          if(node.tagName==='cropfactor')cropFactor=number(text(node),'lens crop factor',true);
          else if(node.tagName==='aspect-ratio')aspectRatio=scalar([node],'aspect-ratio',1.5,true);
          else if(node.tagName==='calibration'){
            attributes(node,['cropfactor','aspect-ratio']);if(node.hasAttribute('cropfactor'))cropFactor=number(node.getAttribute('cropfactor')!,'calibration crop factor',true);if(node.hasAttribute('aspect-ratio'))aspectRatio=number(node.getAttribute('aspect-ratio')!,'calibration aspect ratio',true);
            const key=`${Math.fround(cropFactor)}:${Math.fround(aspectRatio)}`;let frame=frames.get(key);if(!frame){frame={cropFactor,aspectRatio,distortion:[],chromatic:[],vignette:[]};frames.set(key,frame);}
            for(const operation of children(node)){const value=point(operation);frame[operation.tagName==='distortion'?'distortion':operation.tagName==='tca'?'chromatic':'vignette'].push(value);}
          }
        }
        let repeated=0;for(const frame of frames.values())for(const family of ['distortion','chromatic','vignette']as const){const normalized=uniquePoints(frame[family]);frame[family]=normalized.points;repeated+=normalized.repeated;}
        const notices=[...globalNotices,...comments(element,true),...(repeated?[`Normalized ${repeated} identical repeated calibration declaration${repeated===1?'':'s'}; original XML retained.`]:[])].join('\n\n');
        const definition=lensProfileSchema.parse({maker:maker.primary,model:model.primary,mounts,aliases:model.aliases,center,focalRange:range(nodes,'focal'),calibrations:[...frames.values()],source:{name:descriptor.name,sha256:descriptor.sha256,index,...(notices?{notices}:{})}});
        if(!definition.calibrations.some(frame=>[...frame.distortion,...frame.chromatic,...frame.vignette].some(point=>point.model!=='none')))throw new Error('No correction calibration is declared.');
        Object.assign(row,{maker:maker.primary,model:model.primary,makerAliases:maker.aliases,modelAliases:model.aliases,mounts,apertureRange:range(nodes,'aperture'),definition});
      }catch(error){row.definition=null;row.issues=[message(error)];}result.lenses.push(row);
    }else if(kind==='camera'){
      const row:LensCatalog['cameras'][number]={index:result.cameras.length,maker:preview(nodes,'maker',''),model:preview(nodes,'model','Unnamed camera'),variant:'',makerAliases:[],modelAliases:[],mount:'',cropFactor:null,issues:[]};
      try{
        for(const node of nodes)if(!['maker','model','variant','mount','cropfactor','aspect-ratio'].includes(node.tagName))throw new Error(`Unsupported camera field: ${node.tagName}.`);
        const maker=labels(nodes,'maker',true),model=labels(nodes,'model',true),variant=labels(nodes,'variant'),mountNode=one(nodes,'mount'),cropNode=one(nodes,'cropfactor');if(!mountNode||!cropNode)throw new Error('Camera mount and calibrated crop factor are required.');
        const mount=text(mountNode);if(!mount)throw new Error('Camera mount is empty.');scalar(nodes,'aspect-ratio',1.5,true);
        Object.assign(row,{maker:maker.primary,model:model.primary,variant:variant.primary,makerAliases:maker.aliases,modelAliases:model.aliases,mount,cropFactor:number(text(cropNode),'camera crop factor',true)});
      }catch(error){row.cropFactor=null;row.issues=[message(error)];}result.cameras.push(row);
    }else{
      const row:LensCatalog['mounts'][number]={index:result.mounts.length,name:preview(nodes,'name','Unnamed mount'),aliases:[],compatible:[],issues:[]};
      try{for(const node of nodes)if(!['name','compat'].includes(node.tagName))throw new Error(`Unsupported mount field: ${node.tagName}.`);const name=labels(nodes,'name',true),compatible=nodes.filter(node=>node.tagName==='compat').map(node=>text(node));if(compatible.some(value=>!value))throw new Error('Empty compatible mount.');Object.assign(row,{name:name.primary,aliases:name.aliases,compatible});}catch(error){row.issues=[message(error)];}result.mounts.push(row);
    }
  }
  return lensCatalogSchema.parse(result);
}
