# Native Node worker startup — 2026-10-31

Starting from `12960ed`, the same original 64 × 48 RAW inspects successfully
under Node 24.0.1 but fails under Node 26.13.0. The retained baseline captures
`ENOENT` for `node:fs?tsx-namespace=...`: a scoped TypeScript import is interpreted
as a file read instead of a builtin module.

All twelve trusted native entrypoints now load the existing unscoped ESM
TypeScript runtime inside their own worker. One shared bootstrap rejects
main-thread registration. Dynamic imports use fixed owned runtime paths; each
worker owns its module graph/cache. The API host keeps its existing TypeScript
entrypoint setup. Original native processing, IPC validation, queues,
termination/cancellation, sources, shared commands/history and third-party
isolation remain unchanged. No dependency upgrade or Node-version branch is used.

## Verified results

- Full default Node 26.13.0 build/typecheck passes with 43 developer guides.
- The complete `npm test -- --maxWorkers=1` passes **3,153 tests across 307 files**
  on Node 26.13.0, with the existing test thresholds/timeouts.
- **164 affected native/API tests across 15 files** pass on Node 24.0.1. This
  covers actual RAW/TIFF/PNG/font/preflight/selection/matting/vector workflows,
  native reference pixels, original ownership, cancellation/retry, malformed
  input and shared revision/Undo semantics.
- Both new standalone-parent/parent-thread-guard checks pass on Node 22.22.1 and
  Node 24.0.1; Node 26 covers them in the full suite. This is not full Node 22
  application acceptance.
- All **three Node 26 production-browser workflows** pass without skips, retries,
  flakes or failures. Independent readers compare all 41,396 float32 words for
  each of eight TIFF orientations exactly, including complete output profiles,
  retained original bytes and independent browser/API Undo histories.
- The genuine **10,000 × 5,000** source retains its complete 2,150,238-byte
  original, SHA-256 `51db60ac1377c69a75fc49328cbcca09a62e663dd277e08c967f85a3c792ac1c`.
  All **200,000,000 original float samples** match the independent reference hash.
  After a shared exposure edit, native project reopening and actual browser TIFF
  delivery preserve all **200,000,000 output float32 words exactly**, with zero
  maximum error, exact complete profile and 68,645,155 extended color samples.
  The delivered 79,312,008-byte TIFF has SHA-256
  `435cc23bb27eacabae058fd770a8b68ad6a04dbdc5aad3ab953fffc1ec12730c`.
- The maintained REST TIFF guide is linked from the API guide and fits 390 px
  without JavaScript. All 145 release resource hashes are retained. Every
  non-developer browser resource is byte-identical to `12960ed`; only five
  developer pages differ. Native WASM and browser runtime code are unchanged.

After the Node 26 suite, one architecture sentence was clarified to distinguish
worker bootstrap registration from the API host's existing loader. The final
build, Node 24 native run and browser run use that wording. Runtime/test identities
are unchanged throughout; the exact documentation-only difference is retained.
No failed verification run or relaxed threshold is needed for this fix. The
baseline failure remains part of the evidence.

## Evidence and remaining scope

[Sealed verification archive](node-workers-2026-10-31.json.gz):
**4,931,097 bytes**, SHA-256
`3b0393f386176b6c9d8c0061189edfb4668cfa4811eabfeee74a9fb2ba8eb224`.
It embeds 38 native/project/reader/screenshot artifact files. All 145 release
resources, every tested source identity and exact source reconstruction are
recorded alongside the baseline and full verification commands/logs/reports.

The archive embeds original-bearing projects, small native files, numeric reader
results, full command/log/report records and source/release identities. The large
79 MB TIFF is retained in the task artifact directory and recorded by its actual
size/SHA-256 and complete independent sample comparison, rather than duplicated
inside the repository archive.

This repairs native Node worker loading. It adds no schema, public signature,
permission, paid operation, upload, arbitrary original-resolution limit, composed
headless renderer or browser synchronization. It does not close projective tools,
photographic/device/color conformance, sustained editor-wide latency,
whole-process memory, Windows/macOS acceptance, the wider commercial/AI workflow
portfolio or any other unfinished original roadmap gate. The full goal remains
active.
