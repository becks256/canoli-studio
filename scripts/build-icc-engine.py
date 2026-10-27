"""Rebuild the local ICC engine from verified inputs; never fetch implicitly."""
from pathlib import Path
import argparse,hashlib,json,os,shutil,subprocess
p=argparse.ArgumentParser();p.add_argument('--emsdk',required=True,type=Path);p.add_argument('--lcms',required=True,type=Path);p.add_argument('--tools',required=True,type=Path);p.add_argument('--build',required=True,type=Path);p.add_argument('--jobs',type=int,default=2);a=p.parse_args()
if a.jobs<1:p.error('--jobs must be positive')
root=Path(__file__).resolve().parents[1]
pins={'emsdk':'62a853cd3b3134398ce85cde8bb5cbb2ef0194cb','lcms':'21c582a594fe5279f90c0b93437c398f93bf62b0'}
for name,path in [('emsdk',a.emsdk),('lcms',a.lcms)]:
 revision=subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip()
 if revision!=pins[name]:raise SystemExit(f'Unexpected {name} revision: {revision}')
 changes=subprocess.check_output(['git','-C',str(path),'diff','--name-only'],text=True).strip()
 if changes:raise SystemExit(f'Modified {name} source inputs: {changes}')
version=subprocess.check_output([str(a.emsdk/'upstream/emscripten/emcc'),'--version'],text=True).splitlines()[0]
if '4.0.10 'not in version:raise SystemExit('Expected Emscripten 4.0.10: '+version)
env={**os.environ,'PATH':str(a.tools.resolve())+os.pathsep+os.environ['PATH']}
for command in [[str(a.emsdk/'upstream/emscripten/emcmake'),'cmake','-S',str(root/'scripts/icc-engine'),'-B',str(a.build.resolve()),'-G','Ninja','-DCMAKE_BUILD_TYPE=Release','-DCANOLI_LCMS_SOURCE='+str(a.lcms.resolve())],['cmake','--build',str(a.build.resolve()),'--parallel',str(a.jobs)]]:subprocess.run(command,env=env,check=True)
destination=root/'src/core/color/codec';destination.mkdir(parents=True,exist_ok=True);artifacts={}
for name in ['canoli_icc.js','canoli_icc.wasm']:
 data=(a.build/name).read_bytes();(destination/name).write_bytes(data);artifacts[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
shutil.copyfile(a.lcms/'LICENSE',root/'public/licenses/lcms-2.19.1-LICENSE.txt')
inputs={str(path.relative_to(root)):hashlib.sha256(path.read_bytes()).hexdigest()for path in(root/'scripts/icc-engine').rglob('*')if path.is_file()and path.suffix in {'.cpp','.txt'}}
inputs['scripts/build-icc-engine.py']=hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
metadata={'protocolVersion':1,'lcms':'2.19.1','emscripten':version,'sourceRevisions':pins,'sourceFiles':inputs,'artifacts':artifacts,'scope':'Private memory-only ICC inspection, sRGB RGBA8 to RGB output, and device-profile proofing to display sRGB. Separate source/output/proof intent and black-point compensation; alpha copied unchanged. No filesystem, network, native plugins, threads or shared memory. This does not implement high-precision scene editing or CMYK delivery.'}
(destination/'build.json').write_text(json.dumps(metadata,indent=2)+'\n');print(json.dumps(metadata,indent=2))
