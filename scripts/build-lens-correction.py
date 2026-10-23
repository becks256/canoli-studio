"""Build the private Lensfun correction core from pinned local sources.

Normal application builds consume the checked JS/WASM. This script downloads
nothing, changes no upstream source, and exposes no XML/filesystem API.
"""
from pathlib import Path
import argparse,hashlib,json,re,shutil,subprocess

parser=argparse.ArgumentParser()
parser.add_argument('--lensfun',type=Path,required=True)
parser.add_argument('--emsdk',type=Path,required=True)
parser.add_argument('--build',type=Path,required=True)
args=parser.parse_args()
root=Path(__file__).resolve().parents[1];source=args.lensfun.resolve();build=args.build.resolve();build.mkdir(parents=True,exist_ok=True)
pins={'lensfun':'b98997f7f1c020d0fac3136c2abbf06126385971','emsdk':'62a853cd3b3134398ce85cde8bb5cbb2ef0194cb'}
for name,path in [('lensfun',source),('emsdk',args.emsdk)]:
    revision=subprocess.check_output(['git','-C',str(path),'rev-parse','HEAD'],text=True).strip()
    dirty=subprocess.check_output(['git','-C',str(path),'diff','--name-only'],text=True).strip()
    if revision!=pins[name]or dirty:raise SystemExit(f'Unexpected or modified {name} source: {revision} {dirty}')
compiler=args.emsdk.resolve()/'upstream/emscripten/em++'
version=subprocess.check_output([str(compiler),'--version'],text=True).splitlines()[0]
if '4.0.10 'not in version:raise SystemExit('Expected Emscripten 4.0.10')
header=(source/'include/lensfun/lensfun.h.in').read_text()
for name,value in [('MAJOR',0),('MINOR',3),('MICRO',99),('BUGFIX',0)]:header=header.replace('@VERSION_'+name+'@',str(value))
(build/'lensfun.h').write_text(header)
(build/'config.h').write_text('#define CONF_LENSFUN_STATIC\n#define CONF_COMPILER_GCC\n#define CONF_LENSFUN_INTERNAL\n#define HAVE_ENDIAN_H\n')
shutil.copyfile(root/'scripts/lens-correction/glib.h',build/'glib.h')
# This is the unmodified upstream Hermite interpolation function, not a port.
# Other auxfun.cpp services (locale, XML, fuzzy matching) are outside this ABI.
auxiliary=(source/'libs/lensfun/auxfun.cpp').read_text();start=auxiliary.index('float _lf_interpolate (');end=auxiliary.index('\n}',start)+2
interpolate=auxiliary[start:end]
if interpolate.count('{')!=1 or interpolate.count('}')!=1:raise SystemExit('Review changed upstream interpolation function')
(build/'aux-core.cpp').write_text('/* Lensfun auxfun.cpp; Copyright (C) 2007 Andrew Zabolotny. See bundled COPYING.LESSER. */\n#include "lensfun.h"\n#include <cfloat>\n'+interpolate+'\n')
units=['lens.cpp','modifier.cpp','mod-coord.cpp','mod-subpix.cpp','mod-color.cpp']
symbols=['malloc','free','canoli_lens_create','canoli_lens_add','canoli_lens_initialize','canoli_lens_coordinates','canoli_lens_gains','canoli_lens_data','canoli_lens_info','canoli_lens_coefficients','canoli_lens_error','canoli_lens_release']
command=[str(compiler),'-std=c++17','-O3','-fexceptions','-ffunction-sections','-fdata-sections','-ffp-contract=off','-DCANOLI_LENS_CORE_WASM','-Wno-deprecated-declarations','-I'+str(build),'-I'+str(source/'libs/lensfun'),str(root/'scripts/lens-correction/core.cpp'),str(build/'aux-core.cpp'),*[str(source/'libs/lensfun'/name)for name in units],
    '-sMODULARIZE=1','-sEXPORT_ES6=1','-sEXPORT_NAME=createCanoliLensCorrection','-sENVIRONMENT=web,worker,node','-sFILESYSTEM=0','-sALLOW_MEMORY_GROWTH=1','-sMAXIMUM_MEMORY=2147483648','-sINITIAL_MEMORY=16777216','-sSTACK_SIZE=1048576','-sDISABLE_EXCEPTION_CATCHING=0','-sABORTING_MALLOC=0','-sEXPORTED_RUNTIME_METHODS=["HEAPU8"]','-sEXPORTED_FUNCTIONS='+json.dumps(['_'+name for name in symbols]),'-o',str(build/'canoli_lens_correction.js')]
subprocess.run(command,check=True)
destination=root/'src/core/interchange/lens/codec';destination.mkdir(parents=True,exist_ok=True)
artifacts={}
for name in ['canoli_lens_correction.js','canoli_lens_correction.wasm']:
    body=(build/name).read_bytes();(destination/name).write_bytes(body);artifacts[name]={'bytes':len(body),'sha256':hashlib.sha256(body).hexdigest()}
for name in ['COPYING','COPYING.LESSER']:
    shutil.copyfile(source/name,root/'public/licenses'/('lensfun-b98997f7-'+name+'.txt'))
owned=[root/'scripts/build-lens-correction.py',*sorted((root/'scripts/lens-correction').glob('*'))]
upstream=[source/'libs/lensfun'/name for name in [*units,'auxfun.cpp','lensfunprv.h']]+[source/'include/lensfun/lensfun.h.in']
metadata={'protocolVersion':1,'lensfun':'0.3.99.0','emscripten':version,'sourceRevisions':pins,'sourceFiles':{str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest()for p in owned if p.is_file()},'upstreamFiles':{str(p.relative_to(source)):hashlib.sha256(p.read_bytes()).hexdigest()for p in upstream},'generatedInterpolationSha256':hashlib.sha256(interpolate.encode()).hexdigest(),'artifacts':artifacts,
    'included':['upstream scalar calibration interpolation','upstream distortion/TCA/vignette coordinate and gain models','owned checked C ABI, scratch budgets and output lifetime'],
    'excluded':['GLib runtime, parser, locale and container services','database XML parsing/matching/loading','projection/perspective API','network and filesystem','SSE/SSE2'],
    'geometry':'Native original geometry is independent of bounded coordinate/gain scratch requests. Actual WASM representation and allocation failures remain.'}
(destination/'build.json').write_text(json.dumps(metadata,indent=2)+'\n')
print(json.dumps(metadata,indent=2))
