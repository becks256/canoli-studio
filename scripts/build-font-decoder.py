"""Compile pinned, memory-only WOFF2/Brotli decode. Never download inputs."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess
p=argparse.ArgumentParser();p.add_argument('--emsdk',type=Path,required=True);p.add_argument('--woff2',type=Path,required=True);p.add_argument('--brotli',type=Path,required=True);p.add_argument('--build',type=Path,required=True);a=p.parse_args();root=Path(__file__).resolve().parents[1]
pins={'emsdk':'62a853cd3b3134398ce85cde8bb5cbb2ef0194cb','woff2':'7b67e12355fe7da148db5c19d4261f0a498a9537','brotli':'db24a98aed38a16de78cc05ca15cdd8dc2a0d92d'}
for name in pins:
 path=getattr(a,name).resolve()
 if subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip()!=pins[name]or subprocess.check_output(['git','-C',str(path),'diff','--name-only','HEAD'],text=True).strip()or subprocess.check_output(['git','-C',str(path),'ls-files','--others','--exclude-standard'],text=True).strip():raise SystemExit('Expected unchanged pinned '+name+' source.')
a.build.mkdir(parents=True,exist_ok=True);toolchain=a.emsdk.resolve()/'upstream/emscripten';cc=toolchain/'emcc';cxx=toolchain/'em++';env={**os.environ,'EM_CONFIG':str(a.emsdk.resolve()/'.emscripten'),'EM_CACHE':str(toolchain/'cache')};version=subprocess.check_output([str(cxx),'--version'],text=True).splitlines()[0]
if '4.0.10 'not in version:raise SystemExit('Expected Emscripten 4.0.10')
commands=[];objects=[]
for file in sorted([*(a.brotli/'c/common').glob('*.c'),*(a.brotli/'c/dec').glob('*.c')]):
 out=a.build.resolve()/(file.parent.name+'-'+file.stem+'.o');cmd=[str(cc),'-Oz','-flto','-DNDEBUG','-I'+str(a.brotli.resolve()/'c/include'),'-c',str(file.resolve()),'-o',str(out)];subprocess.run(cmd,env=env,check=True);commands.append(cmd);objects.append(str(out))
exports=['_malloc','_free','_canoli_woff2_decode','_canoli_font_data','_canoli_font_size','_canoli_font_release'];source=[a.woff2/'src'/name for name in ['table_tags.cc','variable_length.cc','woff2_common.cc','woff2_dec.cc','woff2_out.cc']]
command=[str(cxx),'-std=c++17','-fno-exceptions','-fno-rtti','-Oz','-flto','-DNDEBUG','-I'+str(a.woff2.resolve()/'include'),'-I'+str(a.woff2.resolve()/'src'),'-I'+str(a.brotli.resolve()/'c/include'),'--no-entry','-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createFontDecoder','-sENVIRONMENT=web,worker','-sFILESYSTEM=0','-sEXPORTED_FUNCTIONS='+json.dumps(exports),'-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]','-sINITIAL_MEMORY=16777216','-sALLOW_MEMORY_GROWTH=1','-sABORTING_MALLOC=0','-o',str(a.build.resolve()/'canoli_font_decoder.js'),str(root/'src/fonts/decode-codec/bridge.cc'),*[str(s.resolve())for s in source],*objects]
subprocess.run(command,env=env,check=True);commands.append(command);destination=root/'src/fonts/decode-codec';artifacts={}
for name in ['canoli_font_decoder.js','canoli_font_decoder.wasm']:
 data=(a.build/name).read_bytes();(destination/name).write_bytes(data);artifacts[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
inputs={str(file.relative_to(root)):hashlib.sha256(file.read_bytes()).hexdigest()for file in [Path(__file__),destination/'bridge.cc']}
metadata={'version':1,'profile':'WOFF2 complete decoder; Brotli 1.2.1; memory-only, original tables/hints retained','sourceRevisions':pins,'emscripten':version,'commands':commands,'sourceFiles':inputs,'artifacts':artifacts,'limits':'No wrapper source/output size tier; writer max is native size_t. Upstream format/compression-ratio validation and actual WASM/browser memory remain. Host controls time and cancellation.'}
(destination/'build.json').write_text(json.dumps(metadata,indent=2)+'\n');print(json.dumps(metadata,indent=2))
