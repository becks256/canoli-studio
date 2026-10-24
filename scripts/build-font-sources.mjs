import {build} from 'esbuild';
import {readFile,writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';

// Compile the private parser independently. Sharing its dependency optimizer
// with the editor can change the editor's startup graph before fonts are used.
const output='src/generated/font-source-worker.js';
const result=await build({entryPoints:['src/fonts/worker.ts'],bundle:true,outfile:output,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline',metafile:true});
const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),inputs={};
for(const path of [...Object.keys(result.metafile.inputs),'scripts/build-font-sources.mjs','package.json','package-lock.json'])inputs[path]=digest(await readFile(path));
const bytes=await readFile(output),manifest={version:1,entry:output,bytes:bytes.length,sha256:digest(bytes),inputs,externalImports:Object.values(result.metafile.outputs).flatMap(value=>value.imports.filter(item=>item.external).map(item=>item.path))};
if(manifest.externalImports.length)throw new Error('The font parser worker must be self-contained.');
await writeFile('src/generated/font-source-worker.manifest.json',JSON.stringify(manifest,null,2)+'\n');
console.log(`Built private font-source worker: ${bytes.length} bytes, ${Object.keys(inputs).length} inputs, no external imports.`);
