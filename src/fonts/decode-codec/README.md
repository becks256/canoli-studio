# Complete private WOFF2 decoder

This pinned Google WOFF2 decoder uses Brotli 1.2.1 to reconstruct complete selected
TTF/OTF data, including glyph instructions, composites, horizontal metrics,
layout/variation and intrinsic paint tables. WOFF1 uses native Deflate streams
and complete table repacking. Neither path reconstructs a subset from outlines.
The original compressed public font file is retained without conversion.

Normal builds verify `build.json` input/artifact digests and embed the compiled
engine in a self-contained disposable private worker. It installs its first
message handler before asynchronous initialization. No filesystem, source upload,
extra WASM fetch or plugin code is involved. Decoder, SFNT-selector and shaping
jobs share the existing font queue. Host cancellation/active deadline, original
fingerprint, output checksums/table-directory/native validation and source/font
ownership apply before publication. Private checked decoded bytes are cached
only for the captured glyph owner's lifetime and feed original-source shaping;
release clears the cache and aborts children.

WOFF2's advertised original SFNT size is advisory: transformed glyf/loca
reconstruction can change byte lengths. The streaming output writer avoids that
allocation assumption. Its wrapper sets the writer maximum to native size_t,
without a new application font-size tier. Upstream WOFF2 format/compression-ratio
checks and actual WASM/browser/native memory constraints remain. Selected WOFF2
collections must first use a supported selected-face path; this decoder accepts
selected SFNT flavors. Color/missing glyph painting and full native layout are
separate work, even when those table bytes decode successfully.

For an independent rebuild, obtain clean pinned checkouts:

- https://github.com/emscripten-core/emsdk.git at
  `62a853cd3b3134398ce85cde8bb5cbb2ef0194cb`, with embedded 4.0.10 installed.
- https://github.com/google/woff2.git at
  `7b67e12355fe7da148db5c19d4261f0a498a9537`.
- https://github.com/google/brotli.git at
  `db24a98aed38a16de78cc05ca15cdd8dc2a0d92d` (v1.2.1).

```sh
python3 scripts/build-font-decoder.py --emsdk /path/to/emsdk \
  --woff2 /path/to/woff2 --brotli /path/to/brotli \
  --build /tmp/canoli-font-decoder-build
npm run build:font-worker
npm run build:font-notices
```

The build script downloads nothing, checks revisions/clean inputs/compiler and
records the exact complete C/C++ invocations and artifact hashes. It compiles no
WOFF2 encoder. Native source notices are retained in `third_party/woff2/LICENSE`
and `third_party/brotli/LICENSE` and the generated public font notices; existing
Emscripten/musl notices remain in `public/licenses`.
