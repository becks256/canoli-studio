/** Optional independent-reader gate: node --import tsx scripts/check-psd-interoperability.ts.
 * Requires Python 3 with Pillow; does not install packages or modify project files. */
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createDocument, createRaster } from '../src/core/model';
import { documentToPsd } from '../src/core/interchange/psd/bridge';

const directory=mkdtempSync(join(tmpdir(),'luma-psd-reader-'));
try {
  const cases: {path:string;name:string;width:number;height:number;expected:number[];sha256:string}[]=[];
  for(const compression of ['raw','rle'] as const) {
    for(const fixture of ['alpha','layers','multiply'] as const) {
      const width=fixture==='alpha'?3:2,height=2;
      const doc=createDocument('Independent PSD reader',width,height);
      const assets=new Map<string,ImageData>();
      const add=(id:string,pixels:number[],visible=true)=>{
        const layer=createRaster(id,id,width,height);layer.visible=visible;doc.children.push(layer);
        assets.set(layer.assetId,{width,height,data:new Uint8ClampedArray(pixels),colorSpace:'srgb'} as ImageData);
        return layer;
      };
      let expected:number[];
      if(fixture==='alpha') {
        expected=[255,0,0,255,0,255,0,128,0,0,255,255,12,34,56,255,78,90,123,64,210,180,150,255];
        add('Alpha',expected);
      } else {
        add('Background',Array(4).fill([100,150,200,255]).flat());
        const overlay=add('Overlay',Array(4).fill([200,100,50,fixture==='multiply'?255:128]).flat());
        if(fixture==='multiply')overlay.blendMode='multiply';
        add('Hidden',Array(4).fill([0,0,0,255]).flat(),false);
        expected=Array(4).fill(fixture==='multiply'?[78,59,39,255]:[150,125,125,255]).flat();
      }
      const bytes=await documentToPsd(doc,id=>assets.get(id)??null,{compression});
      const name=`${fixture}-${compression}`,path=join(directory,`${name}.psd`);
      writeFileSync(path,bytes);
      cases.push({path,name,width,height,expected,sha256:createHash('sha256').update(bytes).digest('hex')});
    }
  }
  const manifest=join(directory,'cases.json');
  writeFileSync(manifest,JSON.stringify(cases));
  const result=spawnSync('python3',['-c',`
import json,sys
from PIL import Image,__version__
with open(sys.argv[1]) as source: cases=json.load(source)
results=[]
for case in cases:
    with Image.open(case['path']) as image:
        assert image.size==(case['width'],case['height']), case['name']+' dimensions'
        pixels=list(image.convert('RGBA').tobytes())
        expected=case['expected']
        matted=[(round(expected[i]*expected[i-i%4+3]/255+255-expected[i-i%4+3]) if i%4<3 else expected[i]) for i in range(len(expected))]
        assert pixels==matted, case['name']+' white-matted preview channels differ'
        results.append({'fixture':case['name'],'sha256':case['sha256'],'width':image.width,'height':image.height,'exactWhiteMattedMergedChannels':True})
print(json.dumps({'reader':'Pillow','version':__version__,'results':results,'limitations':'Stored white-matted preview channel decoding only; does not prove editable layer semantics, blend modes other than normal/multiply, effects, ICC conversion, or Photoshop compatibility.'},indent=2))
`,manifest],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','pipe']});
  if(result.error)throw result.error;
  if(result.status!==0)throw new Error(result.stderr||'Independent PSD check failed');
  process.stdout.write(result.stdout);
} finally {rmSync(directory,{recursive:true,force:true});}
