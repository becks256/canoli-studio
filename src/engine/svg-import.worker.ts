import {inspectSvgSource} from '../core/svg-import';

self.onmessage=async(event:MessageEvent<{file:File}>)=>{
 try{
  const file=event.data.file;
  if(!(file instanceof Blob))throw new Error('Choose an SVG file.');
  self.postMessage({progress:{phase:'reading',fraction:null}});
  const bytes=new Uint8Array(await file.arrayBuffer());
  let encoding='utf-8';
  if(bytes[0]===0xff&&bytes[1]===0xfe)encoding='utf-16le';
  else if(bytes[0]===0xfe&&bytes[1]===0xff)encoding='utf-16be';
  else if(bytes[0]===0&&bytes[1]===60)encoding='utf-16be';
  else if(bytes[0]===60&&bytes[1]===0)encoding='utf-16le';
  else{const declaration=new TextDecoder('ascii').decode(bytes.subarray(0,256)).match(/^\s*<\?xml[^>]*encoding\s*=\s*['"]([^'"]+)['"]/i);if(declaration)encoding=declaration[1];}
  const source=new TextDecoder(encoding,{fatal:true}).decode(bytes);
  self.postMessage({progress:{phase:'inspecting',fraction:null}});
  self.postMessage({inspection:inspectSvgSource(source,file.name.replace(/\.svg$/i,''))});
 }catch(error){self.postMessage({error:error instanceof Error?error.message:String(error)});}
};
