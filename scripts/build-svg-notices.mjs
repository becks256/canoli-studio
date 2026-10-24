import {build} from 'esbuild';
import {readFile,writeFile,access} from 'node:fs/promises';
import path from 'node:path';

// Resolve the parser-only browser graph, excluding unused lexer/MDN data.
const {metafile}=await build({entryPoints:['src/core/svg-css-import.ts'],bundle:true,write:false,metafile:true,platform:'browser',format:'esm',logLevel:'silent'});
const packages=new Map();
for(const input of Object.keys(metafile.inputs).filter(name=>name.includes('node_modules/'))){
 let directory=path.dirname(path.resolve(input));
 for(;;directory=path.dirname(directory)){
  try{await access(path.join(directory,'package.json'));break;}catch{}
  if(directory===path.dirname(directory))throw new Error('Cannot locate SVG parser dependency metadata.');
 }
 if(!packages.has(directory))packages.set(directory,JSON.parse(await readFile(path.join(directory,'package.json'),'utf8')));
}
if(![...packages.values()].some(pkg=>pkg.name==='css-tree')||[...packages.values()].some(pkg=>pkg.name==='mdn-data'))throw new Error('SVG parser graph unexpectedly includes unused validation data.');
const sections=['Canoli Studio SVG CSS parser notices\n\nThe SVG import worker uses the parser, generator, walker and identifier utilities. Unused lexer/validation dictionaries are not included. Supplied font-file declarations and rights remain separate source metadata.'];
for(const[directory,pkg]of [...packages].sort((a,b)=>a[1].name.localeCompare(b[1].name))){
 sections.push(`${pkg.name} ${pkg.version} — ${pkg.license}\n\n`+await readFile(path.join(directory,'LICENSE'),'utf8'));
}
await writeFile('public/svg-parser-notices.txt',sections.join('\n\n'+'='.repeat(72)+'\n\n').replace(/\r\n?/g,'\n')+'\n');
console.log('Built SVG parser notices for '+[...packages.values()].map(pkg=>pkg.name+'@'+pkg.version).join(', ')+'.');
