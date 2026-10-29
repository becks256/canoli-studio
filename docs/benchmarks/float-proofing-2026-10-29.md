# Native float device proofing — 2026-10-29

Baseline `c96278d7032406a6aa1bc891f93116100677eca9`. This bounded T17/F10/F11 increment enables actual device soft proofing for float documents. The complete original professional-editor roadmap remains active; full F10 and F14 are not accepted by this increment.

## Behavior

The completed linear-float scene, including native composition, masks and frame filtering, enters a native Little CMS proof transform before the final SDR canvas encoding. Explicit RGB input/display profiles surround an independent RGB or CMYK device profile. Actual float samples reach the CMM directly. Gamut alarms, intents and black point compensation use the pinned native implementation. The display remains sRGB8; this does not establish HDR or physical display/print calibration.

Color Settings now supports proofing on float documents and during eligible conversion from original-bearing TIFF artwork. Preflight validates the entire staged output/proof draft before publication. Complete custom profiles and proof preferences survive workspace restore. Proof remains outside document/history and PNG/TIFF/PDF delivery. Undo/Redo retains current proof preferences while restoring the edited scene or working precision. Original samples and bytes remain intact.

Private proof sessions share the existing two-owner queue, strict response validation and cancellation boundary. Native display reuse includes the exact device fingerprint, intents, BPC and alarm settings. Captured preferences bind the complete frame; stale or failed native work cannot publish old artwork as Ready. A native processing failure is recoverable by retrying identical settings.

Independent file checks exposed an existing misleading high-precision TIFF label. The dialog now labels its documented native linear-sRGB default accurately and provides **Use output RGB profile for high-precision TIFF** for explicit conversion, including sRGB. Existing non-default output presets start enabled. Direct export defaults and public schemas remain unchanged. Color Settings also keeps its heading and actions visible in a short viewport while its body scrolls.

## Verification

- `npm test -- --maxWorkers=2`: 2916 tests / 287 files passed. Normal and benchmark `npm run build` runs passed.
- 326 accepted browser executions / 326 distinct targets, with no skips, retries or flaky accepted cases: 70 source native/UI/lifecycle cases across 21 files, 79 editor performance cases across 32 files and 177 normal-production cases. Diagnostic pilots and earlier failures are preserved separately.
- Twenty-eight independent direct Linux Little CMS cases cover all input/output sample formats, RGB/CMYK devices, intents, BPC, custom alarms, extended RGB and exact matching-format alpha. A precision witness contains 202 color channels differing from a separately computed sRGB8-proxy proof. Actual WASM unit and private browser workers agree with the independent references: integer outputs are exact and float color channels stay within 2e-6, with zero alpha error.
- 84 completed float proof frames compare 5,287,104 displayed channels exactly across 21 geometries per device/alarm combination. Native scene fidelity is independently checked by the unchanged frame corpus; the proof reference consumes captured completed float samples and independently computes the CMM/display result. Those are separate reference scopes.
- Real RGB and CMYK controls run in both source and normal production, with custom alarm pixels, exact source/history, isolated edits, exact Undo/Redo, workspace profile restoration, and independent PNG/TIFF/PDF readers. All three deliveries are byte-identical with proof enabled and disabled. A 700×480 viewport check verifies visible heading/actions and a scrolling body; the new guide also works with JavaScript disabled at 390px.
- Actual queue saturation, queued cancellation, renderer disposal and healthy retry pass. An injected failure after real native processing hides stale artwork, reports failure and accepts an identical-settings retry without changing the document.
- The genuine 50 MP proof fixture keeps its 10000×5000 original and uses a 500×250 display allocation. Full-resolution PNGs with proof on/off are byte-identical. An independent reader compares all 200,000,000 channels with zero differences and checks the embedded profile. Other native precision/edit/reopen/interchange cases also pass. The proof-specific case takes 315.457 seconds and the original edit/reopen case takes 333.468 seconds on this host. These full-resolution workflows remain slow; they do not establish interactive 60fps or an editor-wide memory budget.

| Device | Gamut alarms | Frames | Compared channels | Differences |
| --- | --- | ---: | ---: | ---: |
| synthetic-cmyk | True | 21 | 1,321,776 | 0 |
| synthetic-cmyk | False | 21 | 1,321,776 | 0 |
| narrow-rgb | True | 21 | 1,321,776 | 0 |
| narrow-rgb | False | 21 | 1,321,776 | 0 |

## Source and release identity

3037 tested inputs, 51 generated resources, 143 frozen benchmark resources and 143 normal release resources are fingerprinted. Source development, benchmark and normal release have separate verified identities. Normal production keeps diagnostic globals absent.

The native ICC codec is actually rebuilt with protocol 3 against Little CMS 2.19.1 revision `21c582a594fe5279f90c0b93437c398f93bf62b0`. Build metadata records source/toolchain/artifact identities. The other three tracked native codecs remain unchanged. Pixel WASM `bd6a519864eb8c8893e1ff8ef23ce5da6b8910c39532467fae9828ba9b305311` and isolated script runtime `4813592f23e5b63bba1d923a33422731b64ff547ec7454984ca6d5474c3d2014` remain unchanged. No new document schema, public command, script/plugin grant, REST synchronization, account or image-size cap is introduced.

## Remaining measured tails

The following p95 observations exceed 33 ms in the full editor sweep. They span different workloads and include setup/task observations; they are not a uniform control-latency SLO or proof of attribution. Every extracted metric remains in the audit.

| Case | Record / metric | p95 ms |
| --- | --- | ---: |
| scripts on a stroke-heavy document record snapshot transport latency | script-transport-latency / [].ms | 234.0 |
| fresh isolated script workers report initialization, document and command costs | script-runtime-phases / [].totalMs | 187.9 |
| font replacement 64 text layers records matching canvas presentation and long tasks | font-replacement-latency / longTasks | 184.0 |
| font replacement 64 text layers records matching canvas presentation and long tasks | font-replacement-latency / taskDetails[].duration | 184.0 |
| crop resize and isolated scripts with 64 layers record presentation latency | document-operations-latency / samples[].presentMs | 168.1 |
| crop resize and isolated scripts with 64 layers record presentation latency | document-operations-latency / samples[].commitMs | 165.4 |
| spot-heal repeated gestures record completion and main-thread stalls | retouch-latency / samples | 163.8 |
| crop resize and isolated scripts with 64 layers record presentation latency | document-operations-latency / samples[].scriptRuntimeMs | 155.9 |
| crop resize and isolated scripts with 5 layers record presentation latency | document-operations-latency / samples[].presentMs | 140.5 |
| crop resize and isolated scripts with 5 layers record presentation latency | document-operations-latency / samples[].commitMs | 139.3 |
| crop resize and isolated scripts with 5 layers record presentation latency | document-operations-latency / samples[].scriptRuntimeMs | 134.8 |
| scripts on a stroke-heavy document record snapshot transport latency | document-reconstruction-latency / [].ms | 121.4 |
| pixel operations 2000x1500 record completion and frame gaps | pixel-operation-latency / samples[].ms | 112.4 |
| spot-heal repeated gestures record completion and main-thread stalls | retouch-latency / phases[].ms | 101.8 |
| 50 MP diagonal clone stroke records live feedback and commit | large-clone-latency / longTasks | 93.0 |
| 50 MP diagonal clone stroke records live feedback and commit | large-clone-latency / longTaskDetails[].ms | 93.0 |
| font replacement 64 text layers records matching canvas presentation and long tasks | font-replacement-latency / samples[].presentMs | 86.2 |
| float gradient-map controls record matching model and independently checked canvas pixels | float-control-latency / samples[].verifiedReadbackMs | 80.8 |

## Evidence and limitations

[float-proofing-2026-10-29.zip](float-proofing-2026-10-29.zip) uses a version-2 content-addressed manifest with SHA-256 payloads, lengths and logical paths. It contains changed sources, baseline source references, normal/frozen benchmark resources, generated runtime, reference profiles/samples and independent native library identity, raw reports/ledgers/artifacts, failed pilots, process observations and runnable build/analysis/verification helpers. Regenerable browser/Vite/SDK caches are excluded. Two TIFF binaries from the unchanged 50 MP native-precision regression (79,312,008 and 32,887,832 bytes) remain in the raw evidence directory and original full archive outside Git; the committed archive records their exact hashes, paths and independent-reader results instead of duplicating them. All new proof-specific output artifacts remain bundled. This packaging choice keeps staging within the available disk budget. The verification receipt records the archive digest and exact committed file identities.

Initial compiler execution failed because the preserved SDK is on a noexec mount. Automatic review rejected a proposed broad relocation of historical verification folders and SDK rehydration; that action was not executed. The successful safer build uses task-owned, hash-verified executable copies in ignored workspace storage and a separate regenerable runtime cache. The four historical folders and pinned source SDK remain in place. Failed compiler/C++/ctypes/link attempts are retained alongside the successful actual build.

The first expanded UI pilot incorrectly expected the native-default float TIFF to embed sRGB. Independent readers identified linear-sRGB; both retained files then passed their actual documented native contract. The misleading UI was corrected and explicit output conversion added. A second pilot used an abbreviated profile label; the assertion now uses the actual full profile name. Both failed reports remain separate from final acceptance. No pixel, source, profile or history threshold was relaxed.

Synthetic devices validate software behavior, not photographic quality or physical print/display accuracy. The final canvas remains quantized even though original/working scene values remain float. Process observations sample descendant RSS/PSS/CPU every 500 ms and include browser/server/test overhead; shared memory, missed transients, orphaned processes and physical GPU allocations limit memory interpretation.

Full F10/F14 and the original roadmap remain open: working-space/HDR/CMYK delivery and photographic/interchange quality, cold native and synchronous setup/graph/command tails, sustained all-tool and global-memory/device acceptance, physical GPU/display/tablet validation, AI/provider/evaluation, installed ChatGPT/live identity, collaboration, specialist and commercial gates remain required.
