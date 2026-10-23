# Private Lensfun correction dependency

This is a dependency of calibrated lens-profile development in implementation.
Private browser/Node RAW workers consume complete immutable profile snapshots,
and the editor can review/edit accepted profile parameters. XML import, a local
catalog and matching remain unfinished; this component does not supply them.

The build uses Lensfun `b98997f7f1c020d0fac3136c2abbf06126385971`
(0.3.99.0) and Emscripten 4.0.10 at the existing pinned toolchain revision.
Normal application builds use checked JS/WASM and download nothing.

```sh
python3 scripts/build-lens-correction.py \
  --lensfun /tmp/canoli-lensfun-source \
  --emsdk /tmp/canoli-avif-emsdk \
  --build /tmp/canoli-lensfun-core-build
```

The selected upstream correction/interpolation translation units are unchanged.
The build extracts the unchanged upstream Hermite interpolation function from
auxfun.cpp, retaining its notice and exact source identity. A minimal owned
compatibility header supplies only required C integer/character declarations;
freeing uses the same allocator and warnings become checked native errors.
There is no GLib runtime or XML, filesystem, network or locale service.

The owned ABI creates one private lens, admits validated finite calibration
points, initializes one correction and returns owned-copy-ready float32 scratch.
Rectilinear poly3/poly5/PTLens distortion, linear/poly3 TCA and PA vignetting are
admitted. Upstream interpolation, coefficient rescaling, focal preservation and
coordinate/gain callbacks perform the actual correction. ACM, projection and
perspective admission remain outside this boundary. The full lens/profile and
photographic roadmap remains active.

Initialization rejects unsupported crop/exposure coverage, folded radial/TCA
mappings and nonpositive attenuation using actual upstream-rescaled coefficients
and stable analytic extrema. Invalid configuration discards its private state;
failed initialization publishes no active modifier or partial result. Exceptions,
native warnings and actual allocation errors become checked failures.

Each coordinate/gain is evaluated at its absolute integer pixel position using
the upstream one-pixel API. This avoids float32 scanline accumulation and makes
irregular region requests partition invariant. Neutral corrections bypass
unnecessary normalization, preserving integer pixel positions. The largest
coordinate or gain request owns at most one million float32 scratch values;
original image geometry is separate from this job budget. This is neither a
source-image cap nor full-frame source allocation. Native float32/representation,
WASM address space and actual memory remain real limits.

The component's COPYING and COPYING.LESSER files are retained under
public/licenses. Upstream source pins, selected source hashes, generated-function
hash, owned build inputs and generated JS/WASM identities are in codec/build.json.
The independent native reference must use the complete upstream library and real
GLib, not this compatibility slice. Synthetic/native conformance is not physical
camera/lens quality or sustained editor performance acceptance.

Build the independent driver against the full native CMake-generated header and
library (not the WASM compatibility header), then generate actual RAW pixel
fixtures with `scripts/generate-raw-profile-fixtures.py --oracle /path/to/reference
--large`. It combines the complete native library's absolute coordinate/gain
callbacks with independently produced LibRaw RGB16 and NumPy/Pillow resampling.
The genuine 50 MP reference uses temporary memory-mapped coordinate/gain planes
and bounded strips; those large intermediate maps are not shipped fixtures.

Primary references: [Lensfun models](https://lensfun.github.io/manual/latest/group__Lens.html),
[pinned sources](https://github.com/lensfun/lensfun/tree/b98997f7f1c020d0fac3136c2abbf06126385971).
