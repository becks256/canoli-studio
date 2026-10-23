"""Build owned RAW decoding from explicit pinned local sources; no downloads.

Normal npm builds use checked-in artifacts and do not run this script.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import re
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--emsdk', type=Path, required=True)
parser.add_argument('--libraw', type=Path, required=True)
parser.add_argument('--zlib', type=Path, required=True)
parser.add_argument('--tools', type=Path, required=True)
parser.add_argument('--build', type=Path, required=True)
parser.add_argument('--native-build', type=Path)
parser.add_argument('--jobs', type=int, default=2)
args = parser.parse_args()
if args.jobs < 1:
    parser.error('--jobs must be positive')
root = Path(__file__).resolve().parents[1]
pins = {'emsdk': '62a853cd3b3134398ce85cde8bb5cbb2ef0194cb',
        'libraw': 'b93f6e45c194f5df9b02a43b1af9a54b4f41f33f',
        'zlib': 'da607da739fa6047df13e66a2af6b8bec7c2a498'}
for name, source in [('emsdk', args.emsdk), ('libraw', args.libraw), ('zlib', args.zlib)]:
    actual = subprocess.check_output(['git', '-C', str(source), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = subprocess.check_output(['git', '-C', str(source), 'diff', '--name-only'], text=True).strip()
    if actual != pins[name] or dirty:
        raise SystemExit(f'Unexpected/modified {name} source: {actual} {dirty}')
version = subprocess.check_output([str(args.emsdk/'upstream/emscripten/emcc'), '--version'], text=True).splitlines()[0]
if '4.0.10 ' not in version:
    raise SystemExit('Expected Emscripten 4.0.10: '+version)
manifest = (args.libraw/'Makefile.am').read_text().split('lib_libraw_a_SOURCES =', 1)[1].split('\n\n', 1)[0]
sources = re.findall(r'src/[\w/]+\.cpp', manifest)
if len(sources) < 60 or len(sources) != len(set(sources)):
    raise SystemExit('Pinned LibRaw source manifest changed; review before building.')
build = args.build.resolve()
build.mkdir(parents=True, exist_ok=True)
source_list = build/'canoli_sources.cmake'
source_list.write_text('set(CANOLI_RAW_SOURCES\n'+''.join(f'  "{(args.libraw/p).resolve()}"\n' for p in sources)+')\n')
env = {**os.environ, 'PATH': str(args.tools.resolve())+os.pathsep+os.environ['PATH']}
common = ['-S', str(root/'scripts/raw-decoder'), '-G', 'Ninja', '-DCMAKE_BUILD_TYPE=Release',
          '-DCANOLI_RAW_SOURCE='+str(args.libraw.resolve()), '-DCANOLI_ZLIB_SOURCE='+str(args.zlib.resolve()),
          '-DCANOLI_RAW_SOURCES_FILE='+str(source_list)]
subprocess.run([str(args.emsdk/'upstream/emscripten/emcmake'), 'cmake', *common, '-B', str(build)], env=env, check=True)
subprocess.run(['cmake', '--build', str(build), '--parallel', str(args.jobs)], env=env, check=True)
if args.native_build:
    subprocess.run(['cmake', *common, '-B', str(args.native_build.resolve())], env=env, check=True)
    subprocess.run(['cmake', '--build', str(args.native_build.resolve()), '--parallel', str(args.jobs)], env=env, check=True)
destination = root/'src/core/interchange/raw/codec'
destination.mkdir(parents=True, exist_ok=True)
artifacts = {}
for name in ['canoli_raw_decoder.js', 'canoli_raw_decoder.wasm']:
    data = (build/name).read_bytes(); (destination/name).write_bytes(data)
    artifacts[name] = {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}
for source, name in [(args.libraw/'COPYRIGHT', 'libraw-0.22.2-COPYRIGHT.txt'),
                     (args.libraw/'LICENSE.LGPL', 'libraw-0.22.2-LICENSE.LGPL.txt'),
                     (args.libraw/'LICENSE.CDDL', 'libraw-0.22.2-LICENSE.CDDL.txt'),
                     (args.zlib/'LICENSE', 'zlib-1.3.2-LICENSE.txt')]:
    shutil.copyfile(source, root/'public/licenses'/name)
# Retain the upstream source notices, including bundled BSD/MIT components.
notices = []
for source in sorted(args.libraw.rglob('*')):
    if source.is_file() and source.suffix in {'.h', '.cpp'}:
        prefix = source.read_text(errors='replace').split('#include', 1)[0]
        comments = re.findall(r'/\*.*?\*/', prefix, flags=re.S)
        legal = [comment for comment in comments if any(word in comment.lower() for word in ['copyright', 'licensed', 'license', 'redistribution'])]
        if legal:
            notices.append(str(source.relative_to(args.libraw))+'\n'+'\n'.join(legal))
(root/'public/licenses/libraw-0.22.2-NOTICES.txt').write_text('\n\n'.join(notices)+'\n')
own = [root/'scripts/build-raw-decoder.py', *sorted((root/'scripts/raw-decoder').glob('*'))]
metadata = {'protocolVersion': 2, 'libraw': '0.22.2', 'zlib': '1.3.2', 'emscripten': version,
            'sourceRevisions': pins, 'sourceFiles': {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest() for p in own if p.is_file()},
            'librawSources': sources, 'artifacts': artifacts, 'output': 'Owned full-resolution linear sRGB RGB16 or grayscale16; separate explicit working-space conversion',
            'features': ['single private worker', 'zlib', 'internal X3F decoder', 'native demosaicing', 'recorded lens and shooting metadata'],
            'excluded': ['DNG SDK', 'RawSpeed', 'external lossy JPEG DNG', 'external camera/output ICC files', 'OpenMP', 'network/filesystem access'],
            'geometry': 'Optional native memory default lifted; native overflow/representation checks, pre-unpack PTRDIFF geometry, WASM address space and actual allocation limits remain.'}
(destination/'build.json').write_text(json.dumps(metadata, indent=2)+'\n')
print(json.dumps(metadata, indent=2))
