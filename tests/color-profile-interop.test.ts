import {it,expect} from 'vitest';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {buildStandardIccProfile} from '../src/core/color/icc';

it('exported sRGB ICC retains dark and saturated samples through independent LittleCMS',async()=>{
 const directory=await mkdtemp(join(tmpdir(),'canoli-icc-'));
 try{
  const path=join(directory,'output.icc');await writeFile(path,new Uint8Array(buildStandardIccProfile('srgb','sRGB IEC61966-2.1')));
  const checked=spawnSync('python3',['-c',`from PIL import Image,ImageCms
import numpy as np,sys,json,itertools
values=[0,1,2,3,4,5,8,10,12,16,20,24,32,48,64,96,128,192,224,255]
a=np.array(list(itertools.product(values,repeat=3)),dtype=np.uint8).reshape(80,100,3)
source=ImageCms.getOpenProfile(sys.argv[1]);target=ImageCms.createProfile('sRGB')
result=ImageCms.profileToProfile(Image.fromarray(a,'RGB'),source,target,renderingIntent=1,outputMode='RGB')
error=np.abs(np.asarray(result).astype(int)-a.astype(int));maximum=int(error.max())
assert maximum<=1,maximum
print(json.dumps({'samples':8000,'maximumRgbError':maximum,'engine':ImageCms.core.littlecms_version}))`,path],{encoding:'utf8',timeout:15000});
  expect(checked.status,checked.stderr||checked.stdout).toBe(0);expect(JSON.parse(checked.stdout).samples).toBe(8000);
 }finally{await rm(directory,{recursive:true,force:true});}
});
