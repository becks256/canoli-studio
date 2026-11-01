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

// Glyph selectors use a small, separate binary worker and do not load Fontkit.
const glyphOutput='src/generated/glyph-selector-worker.js';
const glyphBuild=await build({entryPoints:['src/fonts/glyph-worker.ts'],bundle:true,outfile:glyphOutput,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline',metafile:true});
const glyphInputs={};
for(const file of [...Object.keys(glyphBuild.metafile.inputs),'scripts/build-font-sources.mjs','package.json','package-lock.json'])glyphInputs[file]=digest(await readFile(file));
const glyphBytes=await readFile(glyphOutput),glyphManifest={version:1,entry:glyphOutput,bytes:glyphBytes.length,sha256:digest(glyphBytes),inputs:glyphInputs,externalImports:Object.values(glyphBuild.metafile.outputs).flatMap(value=>value.imports.filter(item=>item.external).map(item=>item.path))};
if(glyphManifest.externalImports.length)throw new Error('The glyph-selector worker must be self-contained.');
await writeFile('src/generated/glyph-selector-worker.manifest.json',JSON.stringify(glyphManifest,null,2)+'\n');
console.log(`Built private glyph-selector worker: ${glyphBytes.length} bytes, no external imports.`);
