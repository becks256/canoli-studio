import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {dirname,join,relative,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {createZipArchive} from '../src/ai/batch/zip';

const root=resolve('.'),marketplace=join(root,'integrations/chatgpt/marketplace'),plugin=join(marketplace,'plugins/canoli-studio'),output=join(plugin,'server/index.mjs');
await mkdir(dirname(output),{recursive:true});
const compiled=await build({entryPoints:['server/chatgpt/index.ts'],bundle:true,outfile:output,format:'esm',platform:'node',target:'node22',minify:true,metafile:true,legalComments:'eof',banner:{js:"import { createRequire as canoliCreateRequire } from 'node:module'; const require = canoliCreateRequire(import.meta.url);"}});
const packages=new Map<string,{name:string;version:string;license:string;text:string}>();
for(const input of Object.keys(compiled.metafile!.inputs)){
 if(!input.includes('node_modules/'))continue;let directory=dirname(resolve(input));
 while(directory!==root){
  try{
   const data=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));
   if(typeof data.name==='string'&&typeof data.version==='string'){
    const key=data.name+'@'+data.version;
    if(!packages.has(key)){
     const files=(await readdir(directory)).filter(name=>/^(?:licen[cs]e|copying|copyright)(?:[.-].*)?$/i.test(name));let text='';
     for(const file of files)if((await stat(join(directory,file))).isFile())text+='\n'+file+'\n'+await readFile(join(directory,file),'utf8');
     if(!text.trim())throw new Error('Missing bundled dependency license text for '+key);
     packages.set(key,{name:data.name,version:data.version,license:typeof data.license==='string'?data.license:'See license text',text});
    }
    break;
   }
  }catch(cause){if(cause instanceof Error&&cause.message.startsWith('Missing bundled'))throw cause;}
  directory=dirname(directory);
 }
}
const notices='Canoli Studio local MCP server — bundled third-party software\n\n'+[...packages.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(data=>data.name+' '+data.version+'\nLicense: '+data.license+'\n'+data.text).join('\n\n');
await writeFile(join(plugin,'THIRD_PARTY_NOTICES.txt'),notices);
async function files(directory:string):Promise<string[]>{const result:string[]=[];for(const name of(await readdir(directory)).sort()){const path=join(directory,name);if((await stat(path)).isDirectory())result.push(...await files(path));else result.push(path);}return result;}
const entries=await Promise.all((await files(marketplace)).map(async path=>({name:'canoli-studio-chatgpt/'+relative(marketplace,path).replaceAll('\\','/'),data:new Uint8Array(await readFile(path))})));
const archive=createZipArchive(entries),bytes=new Uint8Array(await archive.arrayBuffer()),sha=(value:Uint8Array)=>createHash('sha256').update(value).digest('hex');
const sourceInputs:Record<string,string>={};for(const path of [...Object.keys(compiled.metafile!.inputs).filter(path=>!path.includes('node_modules/')),'scripts/build-chatgpt-plugin.ts','package-lock.json'])sourceInputs[path]=sha(new Uint8Array(await readFile(path)));
const manifest={version:1,sourceInputs,plugin:'canoli-studio',pluginVersion:'0.1.0',node:'>=22',sdk:JSON.parse(await readFile('node_modules/@modelcontextprotocol/sdk/package.json','utf8')).version,bytes:bytes.length,sha256:sha(bytes),entries:entries.map(entry=>({path:entry.name,bytes:entry.data.length,sha256:sha(entry.data)})),dependencies:[...packages.values()].map(({name,version,license})=>({name,version,license}))};
await mkdir('public/plugins',{recursive:true});await writeFile('public/plugins/canoli-studio-chatgpt.zip',bytes);await writeFile('public/plugins/canoli-studio-chatgpt.json',JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({plugin:manifest.plugin,sdk:manifest.sdk,bytes:bytes.length,sha256:manifest.sha256,entries:entries.length,dependencies:packages.size}));
