# Cold native float source staging — 2026-10-29–30

Baseline: `3981d93777b04d6b48c8ca6c9e646b003b26fae0`. Bounded measured progress within T01/T17/F10/F14;
the complete professional-editor roadmap remains active.

## Mechanism and authority

The native preparation worker emits at most eight unchanged encoded tiles, then
waits for host acknowledgement. The host captures ordered metadata and immutable
Blob identities synchronously, checks geometry, both compressed/raw hashes and
every native sample, and stages the batch in one atomic IndexedDB transaction.
A bad later tile or failed write leaves none of that batch. Only the complete
ordered manifest publishes a ready source. Existing cache/descriptor/tile formats,
CMM ownership, original bytes, read budgets, commands/history and grants remain.
The packet is at most 2 MiB of raw samples / 2.5 MiB encoded by existing per-tile
limits; host verification decodes one tile at a time. This is not a measured peak
process-memory bound. [Current contract](../FLOAT_SOURCES.md).

## Measurements

The initial instrumented development source diagnostic takes **59.177 s** on the
50 MP original, including 3,880 appends / 3,883 transactions and 23.654 s in host
append work. The first candidate takes **42.774 s**, with 485 batch appends / 488
transactions and 8.500 s in host append work. These diagnostic observations are
separate from normal-production acceptance. Final native verification confirms
the same 488 transactions, an actual maximum packet of eight, and exact complete
descriptor/receipt/raw/encoded tile identity across all 800,000,000 native sample
bytes. Decoding, conversion, compression, native projection and other import work
remain; batching does not remove those costs.

Three sequential normal-production pairs use fresh browser contexts and cold
derived source caches, the actual file picker, explicit float precision, complete
fitted canvas pixels, full native geometry and original-bearing project saves.
No application developer bridge, benchmark build, mocked storage or prototype timing wrappers
are used. The click-to-Ready observer also requires visible canvas pixels.
Heavy functional verification finishes before these six runs begin. Chromium
profiles and artifacts use the same RAM-backed temporary filesystem for both
builds; real IndexedDB timings reflect that storage environment.

| Pair | Baseline click to complete frame | Candidate click to complete frame |
| --- | ---: | ---: |
| 1 | 93.008 s | 74.565 s |
| 2 | 92.944 s | 73.323 s |
| 3 | 92.940 s | 73.742 s |

Median is **92.944 s → 73.742 s**. All six complete fitted
canvas hashes and original-byte identities match, and each passes ordinary
Undo/Redo plus original-bearing project reopening with the same canvas pixels.
These are local cold-derived-cache observations, not statistically powered,
OS/network-cold, physical-storage, all-image/all-tool, sustained 60fps, device or
memory acceptance.
No existing threshold, deadline or source-resolution requirement was loosened.

## Verification and retained corrections

- Full final build passes. All **2,961 unit/API tests across 290 files** pass on
  the final product implementation. The subsequent test-only serialized browser
  guard correction is typechecked by the exact-source final build and exercised
  by the final native/production matrices.
- All **71 affected native browser cases across 15 files** pass without
  skips, retries, flakes or failures. Coverage includes all 13 new batch cases,
  caller input capture, actual native worker tampering, atomic rollback after a
  second-tile quota failure, cancellation/shared waiters, cache repair/ownership,
  original-native 50 MP float/uint16 comparisons, source transport and complete
  native/file/frame/proof output. Independent readers retain actual native sample
  comparisons; matching Canoli outputs alone is not used as the fidelity proof. The
  independent full-source readback compares **200,000,000 float32 words**, with
  zero nonidentical words, zero maximum error and the exact complete profile. Both
  edited 50 MP uint16-source deliveries (float32 and uint16) separately compare
  200,000,000 words each with zero differences and exact complete profiles.
- All **182 normal-production workflows** and six additional paired production
  imports pass with exact tested-source and served-distribution identities.
- The early candidate exposed both immediate caller mutation and later mutation
  during database open. The later case staged substituted bytes after validation;
  its stored encoded digest differs. Capturing metadata and Blob references fixes
  both real-browser reproductions, with exact originals and prior ready data.
- The first full build caught an unknown-typed diagnostic argument. Its failed
  output is retained; a runtime Array check corrects the probe. Earlier functional
  pilots and unit runs remain identified; concurrent pilot timing is excluded
  from the accepted comparison. The production worker verification helper now
  uses browser-native packet validation rather than a Node test-only assertion.
- The first paired-run CLI filter matched zero tests. That setup failure is
  retained separately; the corrected filter runs all six actual imports.
- Pixel WASM remains
  `966b2f81bc79cc50782e2f7871ecf4047b675514e501dc6cac86e85e279a7198`.
  Native conversion, original geometry, public APIs/schema, isolation and source
  resolution retain their contracts.

## Generated storage and compact evidence

Only reproducible current developer HTML and the optional Node compile cache were
losslessly rehomed in task-owned RAM to recover root-disk space. Initial complete
byte maps verify against preserved parent HTML; current generated pages match
regular files inside the tested release. Repeated Node cached loading also passes.
Runtime dist is a separate mutable byte-checked copy. Historical source, SDKs,
evidence and release artifacts are unchanged; static-host containment is intact.

[float-source-staging-2026-10-30.json.gz](float-source-staging-2026-10-30.json.gz) retains statuses, raw-report/attachment digests,
source/release maps, independent native receipts, complete tile identities,
build/unit output, failed candidate cases, timing rows and generated layouts.
SHA-256: `1920f1fe26a77b344fec671e6d4e13239c47a07d3c77a120f8c32e256b40f26c` (348,593 bytes). Resolve identity maps via
`identityMapSha256`: entries are complete, or base/changes overlays a base map
with null removing a path. Keys hash sorted compact UTF-8 JSON. `tileArraySha256`
references complete arrays in `tileArrays`; inline screenshots keep digests and
identified raw-report locations rather than duplicated base64 image bodies.

Remaining cold/large import and native projection, all-tool/sustained/device/
process-memory F14, professional color/precision/interchange/layout, AI/provider/
evaluation, installed ChatGPT/live identity/commercial and every other unfinished
original requirement remain active. This increment does not complete the roadmap.
