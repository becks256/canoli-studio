import {readFile,writeFile,readdir,access} from 'node:fs/promises';
import path from 'node:path';
const root=process.cwd(),seen=new Map();
async function locate(name,from){
  for(let at=from;;at=path.dirname(at)){
    const candidate=path.join(at,'node_modules',name);try{await access(path.join(candidate,'package.json'));return candidate;}catch{}
    if(at===path.dirname(at))throw new Error(`Missing font dependency ${name}`);
  }
}
async function collect(directory){
  if(seen.has(directory))return;const pkg=JSON.parse(await readFile(path.join(directory,'package.json'),'utf8'));seen.set(directory,pkg);
  for(const name of Object.keys(pkg.dependencies??{}))await collect(await locate(name,directory));
}
await collect(path.join(root,'node_modules/fontkit'));
const mit=await readFile(path.join(root,'node_modules/restructure/LICENSE'),'utf8');
const permission=mit.slice(mit.indexOf('Permission is hereby granted'));
if(!permission.startsWith('Permission is hereby granted'))throw new Error('Missing standard MIT license text.');
const sections=['Canoli Studio font-source parser notices\n\nThe parser is loaded only in the font-source worker. These notices cover its dependency tree. Font-file copyright/embedding declarations are separate source metadata.'];
for(const [directory,pkg]of [...seen].sort((a,b)=>(a[1].name+'@'+a[1].version).localeCompare(b[1].name+'@'+b[1].version))){
  const files=(await readdir(directory)).filter(name=>/^licen[sc]e(?:\.|$)|^copying(?:\.|$)/i.test(name));
  let text=files.length?(await Promise.all(files.map(file=>readFile(path.join(directory,file),'utf8')))).join('\n\n'):'';
  if(!text){
    if(pkg.license!=='MIT')throw new Error(`Missing license text for ${pkg.name}`);
    const author=typeof pkg.author==='string'?pkg.author:pkg.author?.name;
    if(!author)throw new Error(`Missing declared font dependency author: ${pkg.name}`);
    text=`Declared author: ${author}\nDeclared license: MIT (package metadata/README).\n\n${permission}`;
  }
  sections.push(`${pkg.name} ${pkg.version} — ${pkg.license}\n${pkg.homepage??pkg.repository?.url??''}\n\n${text}`);
}
sections.push('Brotli decoder upstream notice\n\n'+await readFile(path.join(root,'node_modules/brotli/dec/bit_reader.js'),'utf8').then(text=>text.slice(0,text.indexOf('*/')+2)));
await writeFile(path.join(root,'public/font-parser-notices.txt'),(sections.join('\n\n'+'='.repeat(72)+'\n\n')+'\n').replace(/\r\n?/g,'\n'));
console.log(`Built font-parser notices for ${seen.size} dependencies, including upstream Brotli attribution.`);
