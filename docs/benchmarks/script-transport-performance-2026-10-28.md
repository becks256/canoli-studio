# Script transport performance — 2026-10-28

This bounded T01/F14 increment starts at `3f96f7a`. Each isolated execution still
creates a fresh opaque-origin iframe and dedicated worker under the same CSP.
The bootstrap now transfers a private data endpoint to the worker, while a
separate trusted channel handles startup, errors and stop. Snapshots, commands
and permitted host calls travel directly between parent and worker. Raw worker
`postMessage` cannot substitute a forged result through the bootstrap.

The worker recursively freezes its exclusively owned native clone before normal
validated OO reconstruction. This avoids a redundant defensive copy without
changing public `Document.fromJSON`: mutable caller-owned inputs still copy.
No public constructor, schema, command, grant, file service or REST synchronization
changes. Font bytes are consumed before user code; validation, starting revision,
assets, five-second/256-command budgets and atomic Undo retain their contracts.
All runs dispose their ports/frame/worker. Native structured cloning preserves
numeric values, including signed zero; this does not use JSON serialization.
Platform contracts: [Worker.postMessage](https://developer.mozilla.org/en-US/docs/Web/API/Worker/postMessage)
and [MessagePort.postMessage](https://developer.mozilla.org/en-US/docs/Web/API/MessagePort/postMessage).

Frozen-baseline attribution covers five actual read-only scripts on a hidden
64-stroke, 64,000-point paint layer. Parent clone submission costs 19–20 ms,
iframe-to-worker submission 54–65 ms, worker initialization 56–58 ms and document
reconstruction 119–143 ms. The candidate diagnostic records parent submission
17.5–19.9 ms, initialization 52–59 ms and reconstruction including freeze
71–75 ms. A probe rejects any iframe attempt to relay a document. Diagnostic
phases overlap and instrumentation changes the workload; these are not additive
physical-frame timings. One candidate diagnostic run still takes 346 ms.

Three uninstrumented comparisons each run 20 fresh isolated executions per
release, after preparing the same hidden source and five independent public
reconstructions. Order is before/after, after/before, before/after. All executions
return the expected layer count, no commands and no revision change. Rendering
is excluded by the hidden layer. No other heavy verification runs during timing.

| Pair | Transport median before / after, ms | Transport p95 before / after, ms |
| --- | --- | --- |
| 1 | 280.6 / 231.0 | 306.6 / 246.0 |
| 2 | 280.9 / 233.7 | 293.6 / 246.2 |
| 3 | 284.0 / 228.9 | 318.5 / 246.7 |

The p95 uses nearest rank over 20 samples; all samples, including the first fresh
run, remain in the evidence. No main-thread long tasks are observed in these
paired script intervals. That observer does not measure worker tasks. This is
whole script completion on one host, not physical presentation, a 60fps claim or
acceptance of the 33 ms target. Parent cloning and fresh worker initialization
still cost time; source allocation, worker validation and other scripting paths
remain performance work.

All 77 complete editor performance cases pass, across 31 files, without skips,
retries or flaky outcomes. The full sweep records script transport p95 at
240.5 ms, instrumented fresh script completion at 220.2 ms, a 207 ms
font-replacement long task and spot-heal completion at 186.4 ms. Float LUT and
Gradient Map canvas-copy p95 remain 86.4 / 88.1 ms. These are retained unmet
budgets, not accepted editor-wide performance. The sampled descendant PSS
maximum is 2,063,627,264 bytes, subject to the limitations below.

All 2,871 unit tests in 286 files pass. The normal production build succeeds;
2,993 source inputs, 50 generated files and all 142 release files are frozen.

All 175 normal-production browser cases and all six final channel cases pass,
without skips, retries, flaky outcomes or unexpected failures. The separate
35-case compiled integration matrix also passes. The final audit accepts 308
browser executions across the paired/diagnostic/functional phases; repeated
executions are not independent product features. It verifies the frozen sources,
all generated inputs, the served releases, actual terminals, complete snapshot
checks, worker lifecycle checks and retained failures. The broader roadmap and
F14 remain unfinished.

Six focused browser checks verify exact snapshots and public defensive copies,
opaque origin, unavailable window, no cross-run globals, rejection of forged
worker-global results, strict malformed dimensions/nonfinite points/unknown
strokes, timeout rollback, actual worker destruction and clean retry. The dense
snapshot case compares all 192,000 x/y/pressure scalars across 64,000 points with
`Object.is`, plus stroke IDs and all remaining fields, with zero differences.
It returns one captured rename command while leaving the host model/revision
unchanged. CDP observes three distinct workers for the three-run lifecycle case
and their destruction; no opaque worker or iframe remains.

The 35-case compiled integration matrix covers scripting, inert plugin install,
permissions, network denial, cancellation, concurrent host revision changes,
atomic Undo, prepared patch/healing, RAW host calls and native embedded/variable
fonts. Its source-development pilot has one real failure: a font workflow loses
its execution context during navigation. The entire compiled matrix passes; a
separate instrumented source probe also passes without a Vite full-reload frame.
The original navigation failure's cause remains unproven. Two earlier external
probe collection attempts fail before running product cases because of module
resolution/ESM configuration; their reports remain preserved.

A separate 65-command dense-stroke-copy stress test really exceeds the unchanged
five-second limit. Its failure remains in the archive. The exact read-only
comparison plus one captured edit tests transport fidelity without asserting that
rebuilding 64 strokes is fast. No budget or sample/pixel guard was relaxed to
accept the implementation. Test-only TypeScript narrowing corrections and all
failed diagnostic/probe logs remain available.

Every compiled phase fingerprints all 142 release files before/after and checks
the actually served entry HTML. Source-development receipts explicitly identify
source execution. Final source/generated/release hashes bind functional checks
to the reviewed change. Pixel WASM and all four tracked native codec binaries
remain byte-identical. Pixel WASM SHA-256:
`bd6a519864eb8c8893e1ff8ef23ce5da6b8910c39532467fae9828ba9b305311`.

Process observations include browser, renderer, worker, local server and test
harness overhead. RSS sums double-count shared pages; 500 ms PSS observations can
miss transients, missing/exited/orphaned processes and physical GPU allocations.
They establish neither global peak memory nor a memory improvement.

The [sealed evidence](script-transport-performance-2026-10-28.zip) retains source,
generated inputs, baseline/candidate/normal releases, all reports, phase probes,
complete snapshot checks, worker lifecycle evidence, process samples, failed
attempts and verification scripts. Its version-2 manifest maps each logical file
to SHA-256 payloads, byte counts and modes. Prior commits and artifacts remain.

Full F14 and the original roadmap remain open: scripts, font/document/retouch
tails, sustained all-tool timing, float/HDR/working-space and photographic/file
quality, global memory and physical GPU/display/tablet/device acceptance, plus
all unfinished professional-editor, AI/provider/evaluation, live ChatGPT/identity,
collaboration, specialist and commercial gates.
