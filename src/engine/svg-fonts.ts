import type {DocumentData} from '../core/model';
import type {AssetStore} from '../core/assets';
import {documentFontFiles} from '../core/font-files';
import {sameFontResource} from '../fonts/resources';
import {fontFamilyNames} from '../core/font-families';

/** Explicit SVG delivery embeds complete selected native faces, never a source
 * collection or system font. Check owned identity before and after each read. */
export function captureSvgFonts(document:DocumentData,assets:AssetStore,families:readonly string[]){
  const requested=new Set(families.flatMap(fontFamilyNames));
  const sources=documentFontFiles(document).filter(file=>requested.has(file.resource.report.faces[0].cssFamily.toLowerCase())).map(file=>{
    const check=assets.fonts.capture(file.id),resource=assets.fonts.get(file.id);check();
    if(!sameFontResource(file.resource,resource.descriptor))throw new Error('An SVG font declaration differs from its owned source.');
    return{check,resource};
  });
  const check=()=>{for(const source of sources)source.check();};
  return{check,async definitions(current:()=>void):Promise<string>{
    const rules:string[]=[],formats={ttf:'truetype',otf:'opentype',woff:'woff',woff2:'woff2'};
    for(const{resource}of sources){
      current();check();
      const data=await new Promise<string>((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(String(reader.result));reader.onerror=()=>reject(reader.error??new Error('Cannot encode an SVG font.'));reader.onabort=()=>reject(new Error('SVG font encoding was aborted.'));reader.readAsDataURL(resource.renderBlob);});
      current();check();
      const face=resource.descriptor.report.faces[0];
      for(const descriptor of face.descriptors)rules.push(`@font-face{font-family:"${face.cssFamily}";src:url("${data}") format("${formats[resource.descriptor.render.format]}");font-style:${descriptor.style};font-weight:${descriptor.weight};font-stretch:${descriptor.stretch};}`);
    }
    return rules.length?`<defs><style type="text/css">${rules.join('\n')}</style></defs>\n`:'';
  }};
}
