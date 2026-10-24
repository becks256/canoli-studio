/** Preserve authored CSS tokens while comparing native family names. */
export function fontFamilyParts(value:string):{raw:string;name:string}[]{
  const parts:string[]=[];let part='',quote='';
  for(let i=0;i<value.length;i++){
    const c=value[i];
    if(c==='\\'){part+=c;if(i+1<value.length)part+=value[++i];}
    else if(quote){part+=c;if(c===quote)quote='';}
    else if(c==='"'||c==="'"){quote=c;part+=c;}
    else if(c===','){parts.push(part);part='';}
    else part+=c;
  }
  parts.push(part);
  return parts.map(raw=>({raw,name:raw.trim().replace(/^(['"])(.*)\1$/,'$2').replace(/\\([a-fA-F0-9]{1,6})\s?|\\(.)/g,(_all,hex:string,char:string)=>hex?String.fromCodePoint(Math.min(0x10ffff,parseInt(hex,16))):char).toLowerCase()}));
}
export const fontFamilyNames=(value:string)=>fontFamilyParts(value).map(part=>part.name);
export function replaceFontFamilyToken(value:string,family:string,replacement:string):string{
  const name=family.toLowerCase();
  return fontFamilyParts(value).map(part=>part.name===name?`${part.raw.match(/^\s*/)?.[0]??''}${replacement}${part.raw.match(/\s*$/)?.[0]??''}`:part.raw).join(',');
}
