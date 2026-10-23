import {build} from 'esbuild';
import {readFile,writeFile,mkdir,readdir,stat} from 'node:fs/promises';
import {dirname,resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const root=resolve('.'),output=resolve('dist-site');await mkdir(output,{recursive:true});
const built=await build({entryPoints:['server/site/index.ts'],outfile:join(output,'index.mjs'),bundle:true,format:'esm',platform:'node',target:'node24',minify:true,legalComments:'eof',metafile:true,banner:{js:"import { createRequire as canoliCreateRequire } from 'node:module'; const require = canoliCreateRequire(import.meta.url);"}});
const dependencies=new Map<string,{name:string;version:string;license:string;text:string}>();
for(const path of Object.keys(built.metafile!.inputs)){
 if(!path.includes('node_modules/'))continue;let directory=dirname(resolve(path));while(directory!==root){
  try{const data=JSON.parse(await readFile(join(directory,'package.json'),'utf8'));if(typeof data.name==='string'&&typeof data.version==='string'){
   const key=data.name+'@'+data.version;if(!dependencies.has(key)){let text='';for(const file of(await readdir(directory)).filter(file=>/^(?:licen[cs]e|copying|copyright)(?:[.-].*)?$/i.test(file)))if((await stat(join(directory,file))).isFile())text+='\n'+file+'\n'+await readFile(join(directory,file),'utf8');if(!text.trim())throw new Error('Missing runtime license for '+key);dependencies.set(key,{name:data.name,version:data.version,license:typeof data.license==='string'?data.license:'See license text',text});}break;}}
  catch(error){if(error instanceof Error&&error.message.startsWith('Missing runtime license'))throw error;}directory=dirname(directory);
 }
}
const digest=(bytes:Uint8Array)=>createHash('sha256').update(bytes).digest('hex'),sourceInputs:Record<string,string>={};
for(const path of [...Object.keys(built.metafile!.inputs).filter(path=>!path.includes('node_modules/')),'scripts/build-site.ts','package.json','package-lock.json'])sourceInputs[path]=digest(await readFile(path));
const notices='Canoli Studio optional site/identity host — bundled third-party software\n\n'+[...dependencies.values()].sort((a,b)=>a.name.localeCompare(b.name)).map(data=>data.name+' '+data.version+'\nLicense: '+data.license+'\n'+data.text).join('\n\n');await writeFile(join(output,'THIRD_PARTY_NOTICES.txt'),notices);
const bytes=await readFile(join(output,'index.mjs')),notice=await readFile(join(output,'THIRD_PARTY_NOTICES.txt')),manifest={version:1,node:'>=24',entry:'index.mjs',bytes:bytes.length,sha256:digest(bytes),noticeSha256:digest(notice),sourceInputs,dependencies:[...dependencies.values()].map(({name,version,license})=>({name,version,license})),externalImports:Object.values(built.metafile!.outputs).flatMap(file=>file.imports.filter(item=>item.external).map(item=>item.path))};
await writeFile(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');console.log(JSON.stringify({siteRuntimeBytes:bytes.length,sha256:manifest.sha256,dependencies:dependencies.size}));
