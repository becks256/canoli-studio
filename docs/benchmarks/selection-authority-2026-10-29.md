# Selection authority through transform release — 2026-10-29

Baseline: `758cea0db0123f5d33650507c7720f1692f92e42`. This bounded correctness increment preserves the broader
professional-editor and F14 roadmap; it adds no new performance claim.

## Reproduced issue and fix

Layer-selection changes do not advance document revision. On the committed
baseline, resize, rotation and selection scaling could continue and commit to an
old selection. A selection changed and restored within one task could revive a
move. Delimiter-joined IDs also conflate distinct valid imported selections:
`['a:b','c']` and `['a','b:c']` have the same colon-joined token.

Every transform captures ordered IDs. Synchronous Document/editor subscriptions
cancel on changed owner, revision or selection publication, and continuation and
release recheck that authority. A new transform requires the UI's current source
and selection. Equivalent ordered IDs preserve valid gestures and same-owner pan
continues through selection changes. Alignment reference/key and scale drafts
use unambiguous array identities. Cancellation changes no artwork or history.
No engine, public API, schema, keyboard, asset budget or extension grant changes.

## Verification

- Committed baseline: the expanded 12-case run has 9 expected bug failures and
  3 passing equivalent-selection controls. The earlier four-case reproduction
  also fails at unintended model/history changes; source identities are retained.
- Final focused matrix: **14/14 pass**. It covers different, immediate restored
  and equivalent selections for resize/rotate/group scale; move restoration and
  colliding valid imported IDs; alignment/key/scale reset and equivalent reuse;
  same-owner pan; and the real 50 MP keyboard workflow below.
- Full build passes. **2,961 unit/API tests across 290 files pass**.
- All **98 affected browser cases** and **181 normal-production workflows** pass
  without skips, retries, flakes or failures. Final matrix sources stay fixed;
  the normal-production run pins every served distribution file. The existing
  production pointer/pixel workflow remains included, without a new speed claim.
- In development and ordinary production (no developer global), import an actual
  **10000 x 5000 PNG**, author small raster placements, hold a resize handle and
  use keyboard Enter on another layer's real selection control. Further movement
  and release leave the complete document unchanged. Saved original bytes and
  native asset dimensions match; one ordinary Undo/Redo reverses/reapplies the
  preceding accepted edit. This is a native-source retention/cancellation check,
  not native-sized rendering or large-scene latency acceptance.
- The first expanded candidate run passes 13 cases and has one test-only timeout
  from using `Selection scale` instead of the existing `Selection scale value`
  number-input label. That failure is retained. Correcting the selector yields
  the final green focused matrix and full affected/production verification.
- Rebuilt pixel WASM retains SHA-256
  `966b2f81bc79cc50782e2f7871ecf4047b675514e501dc6cac86e85e279a7198`.
  Runtime distribution is a separate byte-checked mutable copy; historical
  distributions/evidence are preserved.

## Compact record and remaining gates

[selection-authority-2026-10-29.json.gz](selection-authority-2026-10-29.json.gz) contains baseline/candidate statuses, original
bug assertions, retained selector failure, build/unit output, immutable source
and served-release identities, attachment digests, original-byte evidence and
runtime layout. SHA-256: `6b2eff70e80d462595ffb35ea4e89663aeeab685608d4684bcfb4c9b4e244238` (292,453 bytes).

Resolve `identityMapSha256` through `identityMaps`: `entries` is a complete map;
`base` plus `changes` overlays digests on a base map, with null removing a path.
Each key hashes sorted compact JSON of the resolved map. Inline screenshots retain
byte counts and SHA-256; the archive identifies the retained raw report paths and
digests rather than duplicating their base64 image bodies.

This does not close all-tool/sustained/cold/import latency, process-memory/device
F14, professional layout/native color/interchange, AI/provider/evaluation,
installed ChatGPT/live identity/commercial or any other unfinished roadmap gate.
