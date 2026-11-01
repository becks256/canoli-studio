"""Build a pinned full, worker-only HarfBuzz runtime. Never download inputs."""
from pathlib import Path
import argparse,hashlib,json,os,subprocess,shutil
p=argparse.ArgumentParser();p.add_argument('--emsdk',type=Path,required=True);p.add_argument('--source',type=Path,required=True);p.add_argument('--build',type=Path,required=True);a=p.parse_args();root=Path(__file__).resolve().parents[1]
pins={'emsdk':'62a853cd3b3134398ce85cde8bb5cbb2ef0194cb','harfbuzz':'35f656a1a2bab548ea7f54a6dd3fba2b09680d14'}
for name,path in [('emsdk',a.emsdk),('harfbuzz',a.source)]:
 rev=subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip()
 if rev!=pins[name] or subprocess.check_output(['git','-C',str(path),'diff','--name-only','HEAD'],text=True).strip() or subprocess.check_output(['git','-C',str(path),'ls-files','--others','--exclude-standard'],text=True).strip():raise SystemExit('Expected unchanged pinned '+name+' source.')
a.build.mkdir(parents=True,exist_ok=True);compiler=a.emsdk.resolve()/'upstream/emscripten/em++';version=subprocess.check_output([str(compiler),'--version'],text=True).splitlines()[0]
if '4.0.10 'not in version:raise SystemExit('Expected Emscripten 4.0.10: '+version)
command=[str(compiler),'-std=c++17','-fno-exceptions','-fno-rtti','-fno-threadsafe-statics','-fvisibility-inlines-hidden','-Oz','-flto','-DHB_USE_INTERNAL_QSORT','--no-entry','-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createHarfBuzz','-sENVIRONMENT=web,worker','-sFILESYSTEM=0','-sEXPORTED_FUNCTIONS=@'+str(root/'scripts/harfbuzz/harfbuzz.symbols'),'-sEXPORTED_RUNTIME_METHODS=@'+str(root/'scripts/harfbuzz/em.runtime'),'-sINITIAL_MEMORY=16777216','-sALLOW_MEMORY_GROWTH=1','-sALLOW_TABLE_GROWTH=1','-lexports.js','-o',str(a.build.resolve()/'canoli_harfbuzz.js'),str(a.source.resolve()/'src/harfbuzz.cc')]
env={**os.environ,'EM_CONFIG':str(a.emsdk.resolve()/'.emscripten'),'EM_CACHE':str(a.emsdk.resolve()/'upstream/emscripten/cache')}
subprocess.run(command,env=env,check=True)
destination=root/'src/fonts/codec';destination.mkdir(parents=True,exist_ok=True);artifacts={}
for name in ['canoli_harfbuzz.js','canoli_harfbuzz.wasm']:
 data=(a.build/name).read_bytes();(destination/name).write_bytes(data);artifacts[name]={'bytes':len(data),'sha256':hashlib.sha256(data).hexdigest()}
inputs={str(file.relative_to(root)):hashlib.sha256(file.read_bytes()).hexdigest()for file in [Path(__file__),*sorted((root/'scripts/harfbuzz').glob('*'))] if file.is_file()}
metadata={'version':1,'harfbuzz':'15.0.0','profile':'full: no HB_TINY/HB_LEAN/HB_NO_VERTICAL defines','emscripten':version,'sourceRevisions':pins,'command':command,'sourceFiles':inputs,'artifacts':artifacts,'scope':'Private memory-only shaping, glyph/cluster/metric and font-table access. No filesystem, native plugins, threads or source uploads; source/font ownership and native layout verification belong to the host.'}
(destination/'build.json').write_text(json.dumps(metadata,indent=2)+'\n');print(json.dumps(metadata,indent=2))
