# Local ICC engine

The implementation uses the MIT-licensed Little CMS core, release 2.19.1,
commit `21c582a594fe5279f90c0b93437c398f93bf62b0`. Optional external plugins
are excluded. The runtime has no filesystem, network, threads or shared memory.
A private owner supplies complete ICC bytes and bounded straight-alpha RGBA8,
RGBA16 or float32 windows; transforms copy same-format alpha, normalize/quantize cross-format alpha and
own their compiled pipelines. Native context,
profile, transform and caller allocation lifetimes remain explicit. Metadata
labels are bounded to 2 KiB; the original profile bytes remain complete.

The native boundary supports inert inspection, explicit RGB source/destination
conversion for every uint8/uint16/float32 pairing, legacy sRGB-to-RGB8 output,
and device-profile proofing back to display sRGB, with actual ICC intent,
black-point compensation and optional opaque RGB gamut alarms on the legacy
sRGB8 proof route. Float input/output must be finite with alpha in [0,1]; RGB
may extend beyond [0,1], subject to native profile curve/gamut clipping. Sample
windows use little-endian native storage. Valid profiles
with missing native intent tables may use the CMM's standard fallback; each
preparation reports this with an explicit warning. Invalid settings, native
errors and unusable profiles cannot retain an earlier active transform. The current
editing plane remains sRGB8. This native dependency alone does not connect
application settings, preview, delivery or persistence, and does not establish
16-bit/float editing, CMYK/HDR delivery or physical printer/display fidelity.
The dated implementation roadmap records integration and acceptance.

Rebuild explicitly, using the existing Emscripten 4.0.10 toolchain (SDK commit
`62a853cd3b3134398ce85cde8bb5cbb2ef0194cb`) and CMake/Ninja:

```sh
git clone --depth 1 --branch lcms2.19.1 https://github.com/mm2/Little-CMS.git /tmp/canoli-color-lcms2191
python3 scripts/build-icc-engine.py --emsdk /tmp/canoli-avif-emsdk --lcms /tmp/canoli-color-lcms2191 --tools /tmp/canoli-avif-build-tools/bin --build /tmp/canoli-color-icc-build
```

The builder verifies both source revisions, rejects modified tracked inputs,
records wrapper/build hashes, copies the exact license and emits a build
manifest alongside the checked-in JS/WASM. Normal application builds never
fetch sources or install a toolchain implicitly.

Primary references: [release](https://github.com/mm2/Little-CMS/releases/tag/lcms2.19.1),
[core license](https://github.com/mm2/Little-CMS/blob/lcms2.19.1/LICENSE),
[engine API](https://www.littlecms.com/LittleCMS2.17%20API.pdf).
