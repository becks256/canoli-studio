function familyNames(value:string):string[]{
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
  return parts.map(p=>p.trim().replace(/^(['"])(.*)\1$/,'$2').replace(/\\([a-fA-F0-9]{1,6})\s?|\\(.)/g,(_all,hex:string,char:string)=>hex?String.fromCodePoint(Math.min(0x10ffff,parseInt(hex,16))):char).toLowerCase());
}

/** Pin only referenced families: unrelated UI web-font loads cannot invalidate output. */
export function captureExportFonts(families:readonly string[],operation='SVG export'):()=>void{
  if(typeof globalThis.document==='undefined')return()=>{};
  const names=new Set(families.flatMap(familyNames));
  const descriptors=['family','style','weight','stretch','unicodeRange','status','ascentOverride','descentOverride','lineGapOverride','featureSettings','variationSettings','display','sizeAdjust'];
  const entries=()=>new Map([...globalThis.document.fonts??[]].filter(face=>familyNames(face.family).some(name=>names.has(name))).map(face=>[face,JSON.stringify(descriptors.map(key=>(face as unknown as Record<string,unknown>)[key]))]));
  const pinned=entries();
  return()=>{const now=entries();if(now.size!==pinned.size||[...pinned].some(([face,value])=>now.get(face)!==value))throw new Error(`A referenced font family changed during ${operation}. Retry after fonts are ready.`);};
}
