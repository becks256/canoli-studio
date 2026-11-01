# Private full HarfBuzz runtime

The editor uses the exact `harfbuzzjs@1.6.4` JavaScript API with a separately
compiled full HarfBuzz 15.0.0 WASM engine. The npm package's HB_TINY build removes
vertical metrics support; an original fixture with 1,100-unit vertical advances
returned synthesized 1,000-unit advances. This build retains vertical and other
standard shaping tables. It does not implement browser bidi/fallback layout.

`build.json` pins source revisions, compiler, complete invocation, input hashes
and exact output hashes. `scripts/build-font-sources.mjs` verifies them and
embeds the WASM with the pinned wrapper in a self-contained disposable worker.
The wrapper's asynchronous initialization runs after the worker has installed
its first-message handler. No WASM download, filesystem, native plugin, thread,
network service or font upload occurs at runtime. The generated files are ignored;
`npm run build:font-worker` recreates them, and `npm test` does this automatically.

To rebuild the checked-in compiler outputs, obtain clean source checkouts:

- `https://github.com/emscripten-core/emsdk.git` at
  `62a853cd3b3134398ce85cde8bb5cbb2ef0194cb` (4.0.10).
- `https://github.com/harfbuzz/harfbuzz.git` at
  `35f656a1a2bab548ea7f54a6dd3fba2b09680d14` (15.0.0).

Install and activate Emscripten `4.0.10` with `--embedded` in that SDK checkout.
Then run from the project root (the build script never downloads inputs):

```sh
python3 scripts/build-harfbuzz.py --emsdk /path/to/emsdk \
  --source /path/to/harfbuzz --build /tmp/canoli-harfbuzz-build
npm run build:font-worker
npm run build:font-notices
```

The script verifies the pinned checkouts and compiler. `scripts/harfbuzz` holds
the MIT-licensed upstream v1.6.4 export lists. Full upstream HarfBuzz attribution
is retained in `third_party/harfbuzz/COPYING`, with Microsoft USE-table attribution
in `MS-USE-COPYING` and the [official Unicode data notice](https://www.unicode.org/license.txt)
in `UNICODE-LICENSE.txt`; the wrapper license, all font
parser dependencies and upstream notices enter `public/font-parser-notices.txt`.
The existing Emscripten and musl notices are in `public/licenses`.

Source font bytes/axes remain retained by their original owner. Host validation
checks actual GID bounds, UTF-16 source-cluster ranges/direction, finite metrics,
font identity and lifetime before publication. Disposable worker termination
retires its native font/buffer heap on success, failure, timeout or cancellation.
Shaping is lazy and does not run in the ordinary byte text renderer.
