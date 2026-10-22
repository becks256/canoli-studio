"""Build the checked local decoder from pinned sources; never download implicitly.

See scripts/avif-decoder/README.md for the isolated tool/source setup.
"""
from pathlib import Path
import argparse
import hashlib
import json
import os
import shutil
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument("--emsdk", type=Path, required=True)
parser.add_argument("--libavif", type=Path, required=True)
parser.add_argument("--tools", type=Path, required=True, help="Directory containing cmake/ninja")
parser.add_argument("--build", type=Path, required=True)
parser.add_argument("--jobs", type=int, default=2)
args = parser.parse_args()
if args.jobs < 1:
    parser.error("--jobs must be positive")
root = Path(__file__).resolve().parents[1]
pins = {"emsdk": "62a853cd3b3134398ce85cde8bb5cbb2ef0194cb",
        "libavif": "1aadfad932c98c069a1204261b1856f81f3bc199",
        "aom": "10aece4157eb79315da205f39e19bf6ab3ee30d0"}
for name, path in [("emsdk", args.emsdk), ("libavif", args.libavif), ("aom", args.libavif / "ext/aom")]:
    commit = subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()
    if commit != pins[name]:
        raise SystemExit(f"Unexpected {name} source revision: {commit}")
    changes = subprocess.check_output(["git", "-C", str(path), "diff", "--name-only"], text=True).strip()
    if changes:
        raise SystemExit(f"Modified tracked {name} inputs: {changes}")
emcc = args.emsdk / "upstream/emscripten/emcc"
version = subprocess.check_output([str(emcc), "--version"], text=True).splitlines()[0]
if "4.0.10 " not in version:
    raise SystemExit("Expected Emscripten 4.0.10: " + version)
env = {**os.environ, "PATH": str(args.tools.resolve()) + os.pathsep + os.environ["PATH"]}
commands = [
    [str(args.emsdk / "upstream/emscripten/emcmake"), "cmake", "-S", str(root / "scripts/avif-decoder"),
     "-B", str(args.build.resolve()), "-G", "Ninja", "-DCANOLI_AVIF_SOURCE=" + str(args.libavif.resolve()), "-DCMAKE_BUILD_TYPE=Release"],
    ["cmake", "--build", str(args.build.resolve()), "--parallel", str(args.jobs)],
]
for command in commands:
    subprocess.run(command, env=env, check=True)
destination = root / "src/core/interchange/avif/codec"
destination.mkdir(parents=True, exist_ok=True)
artifacts = {}
for name in ["canoli_avif_decoder.js", "canoli_avif_decoder.wasm"]:
    data = (args.build / name).read_bytes()
    (destination / name).write_bytes(data)
    artifacts[name] = {"bytes": len(data), "sha256": hashlib.sha256(data).hexdigest()}
licenses = [(args.libavif / "LICENSE", "libavif-1.3.0-LICENSE.txt"),
            (args.libavif / "ext/aom/LICENSE", "aom-3.12.1-LICENSE.txt"),
            (args.libavif / "ext/aom/PATENTS", "aom-3.12.1-PATENTS.txt"),
            (args.emsdk / "upstream/emscripten/LICENSE", "emscripten-4.0.10-LICENSE.txt"),
            (args.emsdk / "upstream/emscripten/system/lib/libc/musl/COPYRIGHT", "emscripten-musl-COPYRIGHT.txt")]
for source, name in licenses:
    shutil.copyfile(source, root / "public/licenses" / name)
inputs = {str(p.relative_to(root)): hashlib.sha256(p.read_bytes()).hexdigest()
          for p in (root / "scripts/avif-decoder").rglob("*") if p.is_file() and p.suffix in {".cpp", ".txt"}}
inputs["scripts/build-avif-decoder.py"] = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()
metadata = dict(protocolVersion=1, emscripten=version, sourceRevisions=pins, sourceFiles=inputs,
                avif="1.3.0", aom="3.12.1", rgba="8-bit unassociated, built-in bilinear YUV conversion",
                threading="single worker, no shared memory", artifacts=artifacts,
                geometry="Optional axis guard disabled; pixel guard uint32 maximum with the pinned upper-default check patched. Pre-decode RGBA PTRDIFF, native plane allocation, WASM address space and real allocation limits remain.")
(destination / "build.json").write_text(json.dumps(metadata, indent=2) + "\n")
print(json.dumps(metadata, indent=2))
