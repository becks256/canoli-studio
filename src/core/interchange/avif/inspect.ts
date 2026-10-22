import {avifRgbKind,avifUnidentifiedColorWarning,type AvifImportReport} from './types';

interface Box {type:string;body:number;end:number}
interface Location {method:number;dataReference:number;extents:{start:number;length:number}[]}
interface Association {index:number;essential:boolean}
interface Item {type:string;protected:boolean}
export interface AvifInspection {report:AvifImportReport;icc?:Uint8Array}
const ascii=(bytes:Uint8Array,start:number,length:number)=>String.fromCharCode(...bytes.subarray(start,start+length));
const invalid=(message:string):never=>{throw new Error(`Invalid AVIF input: ${message}`);};

/** Read only container metadata. Budgets bound metadata work, never source resolution/file size. */
export async function inspectAvifInput(blob:Blob,check:()=>void=()=>{}):Promise<AvifInspection>{
  let boxCount=0;
  const read=async(start:number,length:number)=>{
    check();if(!Number.isSafeInteger(start)||!Number.isSafeInteger(length)||start<0||length<0||start+length>blob.size)invalid('box data is outside the source.');
    const bytes=new Uint8Array(await blob.slice(start,start+length).arrayBuffer());check();if(bytes.length!==length)invalid('truncated source.');return bytes;
  };
  const boxHeader=(bytes:Uint8Array,at:number,end:number):Box=>{
    if(++boxCount>16384)invalid('metadata box budget exceeded.');
    if(end-at<8||bytes.length-at<8)invalid('truncated box header.');
    const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);let size=view.getUint32(at),header=8;
    if(size===1){if(end-at<16||bytes.length-at<16)invalid('truncated extended box.');const wide=view.getBigUint64(at+8);if(wide>BigInt(Number.MAX_SAFE_INTEGER))invalid('unsafe box size.');size=Number(wide);header=16;}
    else if(size===0)size=end-at;
    if(size<header||size>end-at)invalid('box extends beyond its parent.');
    return{type:ascii(bytes,at+4,4),body:at+header,end:at+size};
  };
  const children=(bytes:Uint8Array,start:number,end:number)=>{const result:Box[]=[];while(start<end){const box=boxHeader(bytes,start,end);result.push(box);start=box.end;}return result;};
  const exactly=(boxes:Box[],type:string,required=true)=>{const found=boxes.filter(box=>box.type===type);if(found.length>1||required&&found.length!==1)invalid(`expected one ${type} box.`);return found[0];};
  let metaBytes:Uint8Array|undefined,metaOffset=0,brands:string[]=[];
  for(let at=0;at<blob.size;){
    const header=await read(at,Math.min(16,blob.size-at));
    const local=boxHeader(header,0,blob.size-at),body=at+local.body,end=at+local.end;
    if(local.type==='ftyp'){
      if(brands.length||end-body<8||(end-body)%4||end-body>4096)invalid('invalid file type.');
      const bytes=await read(body,end-body);brands=[ascii(bytes,0,4)];for(let i=8;i<bytes.length;i+=4)brands.push(ascii(bytes,i,4));
    }else if(local.type==='meta'){
      if(metaBytes)invalid('duplicate metadata.');if(end-body>32*1024*1024)invalid('metadata exceeds the 32 MiB inspection budget.');metaOffset=body;metaBytes=await read(body,end-body);
    }
    at=end;
  }
  if(!brands.includes('avif')&&!brands.includes('avis'))invalid('missing AVIF file brand.');
  if(!metaBytes)invalid('missing image metadata.');
  const bytes=metaBytes!,view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const range=(at:number,length:number,end=bytes.length)=>{if(at<0||!Number.isSafeInteger(at+length)||at+length>end)invalid('truncated image metadata.');};
  const u16=(at:number,end=bytes.length)=>{range(at,2,end);return view.getUint16(at);};
  const u32=(at:number,end=bytes.length)=>{range(at,4,end);return view.getUint32(at);};
  const full=(box:Box,versions:number[],allowedFlags=0)=>{range(box.body,4,box.end);const version=bytes[box.body],flags=u32(box.body)&0xffffff;if(!versions.includes(version)||flags&~allowedFlags)invalid(`unsupported ${box.type} header.`);return{version,flags,at:box.body+4};};
  if(u32(0)!==0)invalid('unsupported metadata header.');
  const table=children(bytes,4,bytes.length),pitm=exactly(table,'pitm')!,pit=full(pitm,[0,1]);
  const primary=pit.version===0?u16(pit.at,pitm.end):u32(pit.at,pitm.end);
  if(!primary||pit.at+(pit.version===0?2:4)!==pitm.end)invalid('invalid primary item.');
  const unsupported:string[]=[],warnings:string[]=[];
  if(brands.includes('avis'))unsupported.push('Animated AVIF sequences require a frame/timeline import workflow.');
  const items=new Map<number,Item>(),iinf=exactly(table,'iinf')!,info=full(iinf,[0,1]);
  const count=info.version===0?u16(info.at,iinf.end):u32(info.at,iinf.end),entries=children(bytes,info.at+(info.version===0?2:4),iinf.end);
  if(count!==entries.length||count>4096)invalid('invalid item table or item budget exceeded.');
  for(const entry of entries){
    if(entry.type!=='infe')invalid('unexpected item table entry.');const header=full(entry,[2,3],1),size=header.version===2?2:4,id=size===2?u16(header.at,entry.end):u32(header.at,entry.end),at=header.at+size;
    range(at,7,entry.end);if(!id||items.has(id))invalid('duplicate or zero item ID.');
    if(!bytes.subarray(at+6,entry.end).includes(0))invalid('unterminated item name.');
    items.set(id,{type:ascii(bytes,at+2,4),protected:u16(at,entry.end)!==0});
  }
  if(!items.has(primary))invalid('primary item does not exist.');
  const iprp=exactly(table,'iprp')!,propertyTable=children(bytes,iprp.body,iprp.end),ipco=exactly(propertyTable,'ipco')!;
  const properties=children(bytes,ipco.body,ipco.end),associations=new Map<number,Association[]>();
  if(properties.length>32767)invalid('too many image properties.');
  const ipmas=propertyTable.filter(box=>box.type==='ipma');if(!ipmas.length)invalid('missing property associations.');
  for(const ipma of ipmas){const header=full(ipma,[0,1],1),count=u32(header.at,ipma.end);let at=header.at+4;
    if(count>4096)invalid('property association budget exceeded.');
    for(let i=0;i<count;i++){
      const id=header.version===0?u16(at,ipma.end):u32(at,ipma.end);at+=header.version===0?2:4;range(at,1,ipma.end);const n=bytes[at++];
      if(!items.has(id)||associations.has(id))invalid('duplicate or missing property item.');const list:Association[]=[];
      for(let j=0;j<n;j++){range(at,header.flags&1?2:1,ipma.end);const value=header.flags&1?u16(at,ipma.end):bytes[at],mask=header.flags&1?0x7fff:0x7f;at+=header.flags&1?2:1;const index=value&mask;if(index>properties.length)invalid('property reference is outside the table.');if(index){if(list.some(item=>item.index===index))invalid('duplicate property association.');list.push({index,essential:!!(value&(mask+1))});}}
      associations.set(id,list);
    }if(at!==ipma.end)invalid('trailing property associations.');
  }
  const refs=new Map<string,Map<number,number[]>>(),iref=exactly(table,'iref',false);
  if(iref){const header=full(iref,[0,1]),size=header.version===0?2:4;
    for(const ref of children(bytes,header.at,iref.end)){let at=ref.body;const id=size===2?u16(at,ref.end):u32(at,ref.end);at+=size;const count=u16(at,ref.end);at+=2;const to:number[]=[];
      if(!items.has(id)||count>4096)invalid('invalid item reference.');for(let i=0;i<count;i++){const target=size===2?u16(at,ref.end):u32(at,ref.end);at+=size;if(!items.has(target))invalid('referenced item does not exist.');to.push(target);}if(at!==ref.end)invalid('trailing item references.');
      let map=refs.get(ref.type);if(!map)refs.set(ref.type,map=new Map());if(map.has(id))invalid('duplicate item reference.');map.set(id,to);
    }
  }
  const locations=new Map<number,Location>(),iloc=exactly(table,'iloc')!,loc=full(iloc,[0,1,2]);let at=loc.at;
  range(at,2,iloc.end);const offsetSize=bytes[at]>>4,lengthSize=bytes[at++]&15,baseSize=bytes[at]>>4,indexSize=loc.version?bytes[at]&15:0;at++;
  if([offsetSize,lengthSize,baseSize,indexSize].some(size=>![0,4,8].includes(size)))invalid('unsupported item offset width.');
  const integer=(size:number)=>{range(at,size,iloc.end);let value=0;if(size===4)value=u32(at,iloc.end);else if(size===8){const wide=view.getBigUint64(at);if(wide>BigInt(Number.MAX_SAFE_INTEGER))invalid('unsafe item offset.');value=Number(wide);}at+=size;return value;};
  const locationCount=loc.version===2?integer(4):u16(at,iloc.end);if(loc.version!==2)at+=2;
  if(locationCount>4096)invalid('item location budget exceeded.');
  const idat=exactly(table,'idat',false);
  for(let i=0;i<locationCount;i++){
    const id=loc.version===2?integer(4):u16(at,iloc.end);if(loc.version!==2)at+=2;
    let method=0;if(loc.version){const value=u16(at,iloc.end);at+=2;if(value&0xfff0)invalid('invalid construction method.');method=value&15;}
    const dataReference=u16(at,iloc.end);at+=2;const base=integer(baseSize),count=u16(at,iloc.end);at+=2;
    if(!items.has(id)||locations.has(id)||count>4096)invalid('invalid item locations.');
    const extents:Location['extents']=[];
    for(let j=0;j<count;j++){
      if(indexSize)integer(indexSize);const offset=integer(offsetSize),length=integer(lengthSize);
      const start=base+offset+(method===1?metaOffset+(idat?.body??0):0);
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(start+length))invalid('unsafe item extent.');
      if(dataReference===0&&method===0&&(start<0||start+length>blob.size)||dataReference===0&&method===1&&(!idat||start<metaOffset+idat.body||start+length>metaOffset+idat.end))invalid('item extent is outside its data source.');
      extents.push({start,length});
    }
    locations.set(id,{method,dataReference,extents});
  }if(at!==iloc.end)invalid('trailing item locations.');
  const grids=new Map<number,{rows:number;columns:number;width:number;height:number}>();
  for(const [id,item]of items){if(item.type!=='grid')continue;const location=locations.get(id);if(!location||location.method>1||location.dataReference)continue;
    const parts:Uint8Array[]=[];let remaining=12;for(const extent of location.extents){const n=Math.min(remaining,extent.length);if(n){parts.push(await read(extent.start,n));remaining-=n;}if(!remaining)break;}
    const data=new Uint8Array(12-remaining);let offset=0;for(const part of parts){data.set(part,offset);offset+=part.length;}
    if(data.length<8||data[0]!==0||data[1]&0xfe)invalid('invalid grid descriptor.');const wide=!!(data[1]&1);if(wide&&data.length<12)invalid('truncated grid descriptor.');const v=new DataView(data.buffer),width=wide?v.getUint32(4):v.getUint16(4),height=wide?v.getUint32(8):v.getUint16(6);
    grids.set(id,{rows:data[2]+1,columns:data[3]+1,width,height});
  }
  const associated=(id:number)=>{
    const result=(associations.get(id)??[]).map(a=>({...properties[a.index-1],essential:a.essential}));
    const known=new Set(['ispe','pixi','av1C','colr','auxC','clap','irot','imir','pasp','clli','mdcv']);
    for(const p of result)if(p.essential&&!known.has(p.type))unsupported.push(`Essential ${p.type} property requires a newer AVIF reader.`);
    const unique=new Set<string>();for(const p of result)if(p.type!=='colr'){if(unique.has(p.type))invalid(`duplicate ${p.type} property.`);unique.add(p.type);}return result;
  };
  const geometry=(props:Box[])=>{const ispe=exactly(props,'ispe')!;if(ispe.end-ispe.body!==12||u32(ispe.body)!==0)invalid('invalid image geometry.');const width=u32(ispe.body+4),height=u32(ispe.body+8);if(!width||!height||width>0x7fffffff||height>0x7fffffff||!Number.isSafeInteger(width*height*4))invalid('unrepresentable image geometry.');return{width,height};};
  const visited=new Set<number>(),usedImages=new Set<number>();
  const image=(id:number):{width:number;height:number;depth:8|10|12|null;channels:number;grid:boolean;subsampled:boolean}=>{
    if(visited.has(id)||visited.size>4096)invalid('cyclic or excessive derived image graph.');visited.add(id);usedImages.add(id);
    const item=items.get(id)!,props=associated(id),size=geometry(props),location=locations.get(id);
    if(item.protected)unsupported.push('Protected AVIF image items are unsupported.');
    if(!location||!location.extents.length||!location.extents.some(extent=>extent.length>0))invalid('missing image payload.');
    if(location!.dataReference!==0)unsupported.push('External AVIF item data references are unsupported.');
    if(location!.method>1)unsupported.push('Item-offset construction requires a newer AVIF reader.');
    let depth:8|10|12|null=null,channels=3,subsampled=false;
    if(item.type==='av01'){
      const config=exactly(props,'av1C')!;if(config.end-config.body<4||bytes[config.body]!==0x81)invalid('invalid AV1 configuration.');
      const profile=bytes[config.body+1]>>5,flags=bytes[config.body+2];depth=flags&0x40?(flags&0x20?12:10):8;channels=flags&0x10?1:3;
      subsampled=channels===3&&!!(flags&12);
      if(profile>2||depth===12&&profile!==2||flags&0x20&&!(flags&0x40))invalid('invalid AV1 bit depth/profile.');
    }else if(item.type==='grid'){
      const tiles=refs.get('dimg')?.get(id)??[];if(!tiles.length)invalid('missing grid tile references.');
      let first:ReturnType<typeof image>|undefined;for(const tile of tiles){if(items.get(tile)?.type!=='av01')invalid('grid tiles must be AV1 image items.');const decoded=image(tile);if(first&&(first.depth!==decoded.depth||first.channels!==decoded.channels||first.width!==decoded.width||first.height!==decoded.height))invalid('inconsistent grid tiles.');first??=decoded;}
      const grid=grids.get(id);if(!grid){if(!location!.dataReference&&location!.method<=1)invalid('missing grid descriptor.');}
      else if(grid.rows*grid.columns!==tiles.length||grid.width!==size.width||grid.height!==size.height||grid.columns*first!.width<size.width||grid.rows*first!.height<size.height||(grid.columns-1)*first!.width>=size.width||(grid.rows-1)*first!.height>=size.height)invalid('grid descriptor disagrees with its tiles or dimensions.');
      depth=first!.depth;channels=first!.channels;subsampled=first!.subsampled;
    }else unsupported.push(`Primary/derived item type ${item.type} requires a newer AVIF reader.`);
    const pixi=exactly(props,'pixi',false);if(pixi){const at=pixi.body;range(at,5,pixi.end);const planes=bytes[at+4];if(!planes||pixi.end-at!==5+planes||u32(at)!==0)invalid('invalid pixel information.');if(depth!==null&&(planes!==channels||!bytes.subarray(at+5,pixi.end).every(value=>value===depth)))invalid('pixel depth disagrees with the AV1 configuration.');if(depth===null)channels=planes;}
    visited.delete(id);return{...size,depth,channels,subsampled,grid:item.type==='grid'};
  };
  const primaryImage=image(primary),props=associated(primary);let alpha=false;
  for(const [id,targets]of refs.get('auxl')??[]){if(!targets.includes(primary))continue;const aux=exactly(associated(id),'auxC',false);if(!aux)continue;full(aux,[0]);const terminated=bytes.subarray(aux.body+4,Math.min(aux.end,aux.body+1028)).indexOf(0);if(terminated<0)invalid('unterminated or excessive auxiliary type.');const type=ascii(bytes,aux.body+4,terminated);if(type!=='urn:mpeg:mpegB:cicp:systems:auxiliary:alpha')continue;
    if(alpha)invalid('duplicate alpha plane.');const plane=image(id);if(plane.width!==primaryImage.width||plane.height!==primaryImage.height||plane.depth!==null&&primaryImage.depth!==null&&plane.depth!==primaryImage.depth||plane.channels!==1)invalid('alpha plane disagrees with the primary image.');alpha=true;
  }
  if(refs.get('prem')?.has(primary))warnings.push('Premultiplied source alpha is converted to unassociated editing samples.');
  let rotation=0,mirror:0|1|null=null,crop={x:0,y:0,width:primaryImage.width,height:primaryImage.height};
  for(const prop of props){
    if(prop.type==='irot'){if(prop.end-prop.body!==1||bytes[prop.body]&0xfc)invalid('invalid rotation.');rotation=bytes[prop.body];}
    if(prop.type==='imir'){if(prop.end-prop.body!==1||bytes[prop.body]&0xfe)invalid('invalid mirror axis.');mirror=bytes[prop.body] as 0|1;}
    if(prop.type==='pasp'){if(prop.end-prop.body!==8||!u32(prop.body)||!u32(prop.body+4))invalid('invalid pixel aspect ratio.');if(u32(prop.body)!==u32(prop.body+4))unsupported.push('Non-square AVIF pixels require an explicit aspect-ratio conversion.');}
    if(prop.type==='clap'){
      if(prop.end-prop.body!==32)invalid('invalid clean aperture.');const values=Array.from({length:8},(_,i)=>i===4||i===6?view.getInt32(prop.body+i*4):u32(prop.body+i*4));
      if([1,3,5,7].some(i=>!values[i]))invalid('zero clean-aperture denominator.');const width=values[0]/values[1],height=values[2]/values[3],x=(primaryImage.width-width)/2+values[4]/values[5],y=(primaryImage.height-height)/2+values[6]/values[7];
      if(![width,height,x,y].every(Number.isSafeInteger)||width<=0||height<=0||x<0||y<0||x+width>primaryImage.width||y+height>primaryImage.height)unsupported.push('Fractional or out-of-bounds clean apertures cannot be imported losslessly.');else crop={x,y,width,height};
    }
  }
  // HEIF transformative properties are applied in association order. Our output addresses crop,
  // then anticlockwise rotation, then mirroring. Reject a different ordering rather than misplace pixels.
  const transforms=props.filter(p=>['clap','irot','imir'].includes(p.type)).map(p=>['clap','irot','imir'].indexOf(p.type));
  if(transforms.some((value,i)=>i>0&&value<transforms[i-1]))unsupported.push('This AVIF transform order requires an ordered-transform reader.');
  let icc:Uint8Array|undefined,nclx:AvifImportReport['color']={kind:'unspecified',primaries:null,transfer:null,matrix:null,fullRange:null};
  for(const colr of props.filter(p=>p.type==='colr')){
    range(colr.body,4,colr.end);const type=ascii(bytes,colr.body,4);
    if(type==='nclx'){
      if(colr.end-colr.body!==11||nclx.primaries!==null||bytes[colr.body+10]&0x7f)invalid('invalid or duplicate colour identification.');
      const primaries=u16(colr.body+4),transfer=u16(colr.body+6),matrix=u16(colr.body+8),kind=avifRgbKind(primaries,transfer);
      nclx={kind,primaries,transfer,matrix,fullRange:!!(bytes[colr.body+10]&0x80)};
    }else if(type==='prof'||type==='rICC'){
      if(icc||colr.end-colr.body-4>16*1024*1024)invalid('invalid ICC profile or ICC metadata budget exceeded.');const profile=bytes.subarray(colr.body+4,colr.end),v=new DataView(profile.buffer,profile.byteOffset,profile.byteLength);
      if(profile.length<132||v.getUint32(0)!==profile.length||ascii(profile,36,4)!=='acsp'||ascii(profile,16,4)!=='RGB ')invalid('expected a complete RGB ICC profile.');
      const count=v.getUint32(128);if(count>4096||132+count*12>profile.length)invalid('invalid ICC tag table.');
      for(let i=0;i<count;i++){const at=132+i*12,offset=v.getUint32(at+4),length=v.getUint32(at+8);if(offset<132+count*12||offset+length>profile.length)invalid('ICC tag is outside its profile.');}
      icc=profile.slice();
    }else unsupported.push(`Colour property ${type} is unsupported.`);
  }
  const color={...nclx,kind:icc?'icc' as const:nclx.kind};
  if(color.transfer===16||color.transfer===18)unsupported.push('HDR PQ/HLG requires an explicit supported tone-mapping pipeline, including ICC-bearing sources.');
  if(!icc&&color.kind==='unsupported')unsupported.push(`CICP primaries ${color.primaries}, transfer ${color.transfer} require a supported display conversion (HDR is not tone-mapped).`);
  if(color.matrix!==null&&(![0,1,2,4,5,6,7,8,9,12].includes(color.matrix)||color.matrix===8&&color.fullRange===false))unsupported.push(`CICP matrix ${color.matrix} / range is unsupported by this reader.`);
  if(color.matrix===0&&primaryImage.subsampled)unsupported.push('Identity RGB requires 4:4:4 or monochrome AV1 planes.');
  if(color.kind==='unspecified')warnings.push(avifUnidentifiedColorWarning);
  if(icc||color.kind==='display-p3'||color.kind==='linear-srgb')warnings.push('The decoded PNG retains an RGB ICC profile for browser conversion to the current 8-bit editing space; wide-gamut/HDR editing is not implied.');
  if(primaryImage.depth!==null&&primaryImage.depth>8)warnings.push(`${primaryImage.depth}-bit source samples are converted to 8-bit editing pixels only with explicit consent. Original AVIF bytes must be retained.`);
  if(items.size>usedImages.size)warnings.push('Only the primary image and its required tile/alpha items are decoded; other images and metadata remain in the original source.');
  const swapped=rotation%2===1;
  return{report:{version:1,primaryItem:primary,width:primaryImage.width,height:primaryImage.height,grid:primaryImage.grid,bitDepth:primaryImage.depth,alpha,rotation,mirror,crop,
    displayWidth:swapped?crop.height:crop.width,displayHeight:swapped?crop.width:crop.height,color,
    requiresPrecisionLoss:primaryImage.depth!==null&&primaryImage.depth>8,requiresColorAssumption:color.kind==='unspecified',canDecode:unsupported.length===0,
    unsupported:[...new Set(unsupported)],warnings:[...new Set(warnings)]},...(icc?{icc}:{})};
}
