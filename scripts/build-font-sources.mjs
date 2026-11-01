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

// Full HarfBuzz runtime; all compiled bytes are owned inputs, with no fetches.
const codec=JSON.parse(await readFile('src/fonts/codec/build.json','utf8'));
for(const [file,sha]of Object.entries(codec.sourceFiles))if(digest(await readFile(file))!==sha)throw new Error('Full HarfBuzz build input differs: '+file);
for(const [name,entry]of Object.entries(codec.artifacts))if(digest(await readFile('src/fonts/codec/'+name))!==entry.sha256)throw new Error('Full HarfBuzz artifact differs: '+name);
const fullPlugin={name:'owned-full-harfbuzz',setup(b){b.onLoad({filter:/harfbuzzjs\/dist\/index\.mjs$/},async args=>{
 let text=await readFile(args.path,'utf8');const from='import createHarfBuzz from "./harfbuzz.js";',init='init(await createHarfBuzz());';if(text.split(from).length!==2||text.split(init).length!==2)throw new Error('Pinned HarfBuzz wrapper initialization changed.');
 const base=process.cwd()+'/src/fonts/codec/';text=text.replace(from,'import createHarfBuzz from '+JSON.stringify(base+'canoli_harfbuzz.js')+';\nimport ownedWasm from '+JSON.stringify(base+'canoli_harfbuzz.wasm')+';').replace(init,'init(await createHarfBuzz({wasmBinary:ownedWasm}));');return{contents:text,loader:'js',resolveDir:args.path.slice(0,args.path.lastIndexOf('/'))};
});}};
const runtimeOutput='src/generated/font-shaper-runtime.mjs';
const runtimeBuild=await build({entryPoints:['node_modules/harfbuzzjs/dist/index.mjs'],bundle:true,outfile:runtimeOutput,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline',metafile:true,loader:{'.wasm':'binary'},plugins:[fullPlugin]});
await writeFile('src/generated/font-shaper-runtime.d.mts','export * from "harfbuzzjs";\n');
const shapingOutput='src/generated/font-shaping-worker.js';
const shapingBuild=await build({entryPoints:['src/fonts/shaping-worker.ts'],bundle:true,outfile:shapingOutput,format:'esm',platform:'browser',target:'es2022',minify:true,legalComments:'inline',metafile:true});
const shapingInputs={};for(const file of [...new Set([...Object.keys(runtimeBuild.metafile.inputs),...Object.keys(shapingBuild.metafile.inputs),'src/fonts/codec/build.json','scripts/build-font-sources.mjs','package.json','package-lock.json'])])shapingInputs[file]=digest(await readFile(file));
const shapingBytes=await readFile(shapingOutput),shapingManifest={version:1,profile:'full-harfbuzz-15.0.0',entry:shapingOutput,bytes:shapingBytes.length,sha256:digest(shapingBytes),runtime:{path:runtimeOutput,sha256:digest(await readFile(runtimeOutput))},inputs:shapingInputs,externalImports:[...Object.values(runtimeBuild.metafile.outputs),...Object.values(shapingBuild.metafile.outputs)].flatMap(value=>value.imports.filter(item=>item.external).map(item=>item.path))};
if(shapingManifest.externalImports.length)throw new Error('The shaping worker must have no external imports.');await writeFile('src/generated/font-shaping-worker.manifest.json',JSON.stringify(shapingManifest,null,2)+'\n');console.log(`Built full private shaping worker: ${shapingBytes.length} bytes, no external imports.`);
