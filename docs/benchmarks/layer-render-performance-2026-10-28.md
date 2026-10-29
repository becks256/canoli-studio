# Cold layer composition — 2026-10-28

This bounded T01/F14 increment starts at `83396ff`. Ordinary byte-compositor
layer loops previously continued through promises without admitting input tasks.
They now share the existing eight-millisecond native-tile task deadline through
layer stacks, groups and bounded layer recursion. An expired deadline yields
through the disposable MessageChannel helper and rechecks cancellation before
continuing. Layer order, complete-frame publication, original/source resolution,
output grids, native glyph drawing, caches, commands, Undo and extension grants
retain their contracts. Float scenes keep their separate pipeline.

Attribution matters. The earlier sweep's 207 ms task in the font-management
fixture is not a font-replacement command measurement. Two frozen-baseline
CPU/task diagnostics reproduce a 206–207 ms task before the dialog opens.
Aligned NavigationStart/CPU timestamps place ordinary fixture layer-add/style
commands in that task; replacement commands themselves commit in roughly 5–9 ms.
A separate 86 ms cold text-composition task performs glyph drawing and cache
copies. The new work targets that render loop. Synchronous fixture/command setup
is still work, and its observations are retained. The previous sealed artifacts
remain unchanged. New task start/duration and fixture/dialog/control phase stamps
prevent broad fixture labels from being treated as causal attribution.

Three uninstrumented comparisons alternate before/after, after/before and
before/after. Each release runs twelve cold flat and grouped text frames plus
twelve real replacements in each of the existing 16/64-layer dialog cases.
The cold fixtures have 64 total layers: 64 text layers, or one pass-through group
with 63 text layers. Both retain the 800×600 requested native output and complete
text. A queued timer measures input opportunity separately from complete render
time. All twelve samples, including cold starts and outliers, remain included;
p95 is nearest rank and therefore the maximum for twelve samples.

| Cold stack | Pair | Queued input p95 before / after, ms | Complete render p95 before / after, ms |
| --- | --- | --- | --- |
| Flat | 1 | 54.4 / 9.5 | 52.6 / 53.9 |
| Flat | 2 | 48.6 / 10.6 | 46.7 / 51.3 |
| Flat | 3 | 58.0 / 8.8 | 55.9 / 48.7 |
| Grouped | 1 | 54.6 / 12.4 | 51.7 / 55.5 |
| Grouped | 2 | 61.8 / 9.2 | 59.6 / 59.5 |
| Grouped | 3 | 64.0 / 30.8 | 61.9 / 63.9 |

Every candidate queued task runs before composition completes (72/72); baseline
tasks run afterward (0/72). No render long tasks are observed in the candidate
cold cases, while baseline cases retain 50–68 ms tasks. All 144 complete frame
digests match per fixture, covering 276,480,000 hashed RGBA bytes. These are
whole-image SHA-256 comparisons, distinct from the independent scalar reference
below. Source models and revisions remain unchanged.

This improves input opportunity and obsolete-work cancellation, with mixed
throughput and a real 30.8 ms grouped-input outlier. Complete renders still exceed
33 ms. A timer is a queued-task proxy, not physical input/display latency.
Individual native Canvas calls, graph/setup work and final copies cannot be
preempted by this deadline. Cooperative scheduling is not an eight-millisecond
cap, sustained 60fps or editor-wide acceptance. No heavy verification runs during
the paired measurements or the final complete timing sweep.

Actual font-control presentation is mixed and remains above target. The same
paired runs retain these click-to-canvas p95 values:

| Text layers | Pair | Font presentation p95 before / after, ms |
| --- | --- | --- |
| 16 | 1 | 63.0 / 66.8 |
| 16 | 2 | 60.9 / 70.1 |
| 16 | 3 | 60.5 / 62.0 |
| 64 | 1 | 92.8 / 99.0 |
| 64 | 2 | 70.0 / 112.7 |
| 64 | 3 | 97.9 / 77.1 |

The 64-layer second pair is materially slower after the change. This increment
accepts queued input and cancellation during composition, not completion of the
font-presentation or whole-editor timing gates. No task is dropped from the
font observer; its setup/dialog/control timestamps remain available.

Four compiled browser checks compare flat/grouped output against separately
authored native Canvas reference images, all 3,840,000 RGBA channels exactly,
with visible ink and unchanged models/revisions. They also verify queued input,
actual cancellation, released temporary canvases, complete retry and rejection
of an obsolete cold text frame when the user switches documents. The latest
solid frame has the independently known green RGBA value. Complete-frame
publication remains intact; partially composed buffers stay private.

The expanded 79-case/32-file editor performance sweep passes without skips,
retries or flaky outcomes. It records flat/grouped queued-input p95 of
9.5 / 8.7 ms and complete-render p95 of 51.2 / 53.7 ms. Remaining observations
include 287.2 ms script transport, 212.2 ms document-operation presentation and
184.1 ms spot-heal completion. The 195 ms task under the broad font fixture
label retains its phase timestamps for proper attribution. The sampled
performance descendant PSS maximum is 2,190,418,944 bytes with the limits below.

A development-only navigation failure is also resolved. The first native matrix
passes 45/46 cases and loses context in the font/plugin/SVG workflow. Multiple
fresh-cache traces reproduce Vite's full-reload message; a server send stack and
missing-import receipt identify paper/dist/paper-core.js reaching runOptimizer.
The existing Boolean/SVG worker dependency is now explicitly pre-optimized.
That full workflow passes on a fresh cache without any server/client reload
event. A fresh benchmark build proves every non-documentation resource matches
the timed candidate exactly; only two generated guides differ. Original measured
release identities and failed traces are retained rather than relabeled.

The corrected native run passes the formerly interrupted case and 44 others,
but its independent 50 MP clipping reader times out under observed memory
pressure. Around that failure, the host has about 1.1 GiB available RAM and its
8 GiB swap is saturated. All files, reports and unchanged assertions remain.
Sixty-nine saved synthetic DNG originals are verified against the pinned source
hash; 67 identical immutable copies share same-device hardlinks. Every original
path, regular-file type, mode and source byte remains, with reversible metadata
receipts. About 6.7 GB of backing storage is reclaimed, leaving about 7.6 GiB RAM
available. This is verification storage management, not product memory acceptance.
The unchanged independent reader then passes on the exact old PNG/PSB files in
21.9 seconds, checking complete native PNG/preview/source/member samples and
base transparency without a weaker deadline or lower resolution.

All 46 native browser cases across ten files pass in the final fresh-cache run,
without skips, retries, flaky outcomes or unexpected failures. The earlier
resource failure and all reload traces remain separate failed evidence. The
final native run retains the original 120-second browser-test budget, actual
50 MP files and every independent comparison.

All 2,871 unit tests in 286 files pass, and the normal build succeeds.
The final frozen identities cover 2,995 source inputs, 50 generated files and
142 normal-release files. The generated isolated scripting runtime is exactly
byte-identical to the prior committed evidence; its SHA-256 is
`4813592f23e5b63bba1d923a33422731b64ff547ec7454984ca6d5474c3d2014`.

All 175 normal-production browser cases and four final compiled scheduling
cases pass, without skips, retries, flaky outcomes or unexpected failures. Final
post-verification also passes. A further 20-sample script pair under the recovered
environment records p95 of 286.8 / 310.7 ms before/after; the runtime bytes remain
identical, and no script throughput improvement or broader budget acceptance is
claimed. The later candidate CPU diagnostic retains a 209 ms task before dialog
opening. It is attribution evidence collected after resource recovery, separate
from the earlier clean paired timing experiment.

The audit accepts 338 browser executions across these phases, including repeated
runs; it verifies identities, actual terminals, complete image digests, native
references, cancellation/lifecycle, unchanged WASM/codecs, reader recovery and
byte-preserving storage receipts. Full F14 and the complete roadmap stay open.

The first grouped quality fixture accidentally requested 128 total layers and
correctly failed the existing 64-layer document budget. Its full report/source
is retained. The corrected group plus 63 text layers uses the supported maximum;
the same fixture and all twelve samples are used on both releases. No product
limit, pixel assertion or deadline changed to accept it. An evidence-helper log
filename collision failed before starting a product build; that failure and its
correction are also retained.

Each compiled phase fingerprints all 142 release files before/after and checks
the actually served HTML. Source-development receipts identify that execution
mode explicitly. Final input/generated/normal-release hashes bind the functional
checks to the reviewed change. Pixel WASM and four tracked native codec binaries
are unchanged. Pixel WASM SHA-256:
`bd6a519864eb8c8893e1ff8ef23ce5da6b8910c39532467fae9828ba9b305311`.

Process observations include browser, renderer, worker, local server and test
harness overhead. RSS sums double-count shared pages; 500 ms PSS samples can
miss transients, missing/exited/orphaned processes and physical GPU allocations.
They establish neither global peak memory nor a memory improvement. This host
uses Canvas2D; physical GPU/tablet/display and wider device acceptance remain open.

The [sealed evidence](layer-render-performance-2026-10-28.zip) retains source,
generated inputs, baseline/candidate/normal releases, all reports, CPU/task-clock
diagnostics, complete pixel checks, cancellation/lifecycle observations, process
samples, failed attempts and verification scripts. Its version-2 manifest maps
logical files to SHA-256 payloads, byte counts and modes. Prior commits and
sealed evidence remain available.

Full F14 and the complete original roadmap remain active: synchronous setup,
remaining script/font/document/retouch tails, sustained all-tool timing,
float/HDR/working-space and photographic/interchange quality, global memory and
physical devices, plus AI/provider/evaluation, installed ChatGPT/live identity,
collaboration, specialist and commercial gates.
