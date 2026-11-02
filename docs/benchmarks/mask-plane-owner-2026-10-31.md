# Retained mask owners and native appearance — 2026-10-31

Status: verified implementation increment from `f4cc4cf`; the complete original
implementation-roadmap goal remains active.

## Correction

The bounded float appearance cache keyed a linked rectangular selection by its
raw rectangle alone. After linking an independent mask under perspective and
resetting perspective, that rectangle no longer described the captured mask.
The old production build reused stale coverage: **12,616 normalized RGBA samples**
differed from the PNG reference. Independent Pillow decoding confirms **3,561
incorrect alpha samples** in the saved foreground. The corrected production
workflow compares every browser-normalized RGBA byte exactly; Pillow separately
confirms raw PNG alpha in all six corrected stages.

The key now includes complete retained-plane data and actual native geometry-grid
dimensions. Basis, pose, reference and valid same-ID grid replacement rebuild
the appearance. Unchanged repeats, metadata edits and eligible integer linked
moves retain reuse. The actual native processor records one composition for
each tested rebuild and zero for each of the four reuse controls. This is work
reuse evidence, not a latency, speedup or sustained-performance claim.

## Verified checks

| Check                                                             | Result                                                               |
| ----------------------------------------------------------------- | -------------------------------------------------------------------- |
| `npm test`, two workers, required loopback/subprocess permissions | 3,216 passed, 0 failed, 312 files                                    |
| Complete affected browser matrix                                  | 83 passed across 5 files; no skips, retries, flakes or runner errors |
| Normal production workflows                                       | 3 passed across 3 files, without developer globals                   |
| Source freeze                                                     | Product and test hashes unchanged throughout acceptance              |

The 15 new browser cases cover the appearance regression and these owner paths:

- Two ordinary-mask source replacements change shared smart contents from a
  192x144 red original to a 384x288 blue image, preserving every alpha byte in
  both linkage states. Cached, uncached, Undo/Redo and reopened output agree.
  Serialization deliberately omits history. An independent container reader
  verifies the manifest and every asset hash, both native image dimensions and
  exact original bytes. The former source remains only as mask-grid geometry.
- Six Image Size cases compare ordinary masks and both filter phases, linked
  and independent, against a separate root/document-frame control at 2x/1.5x.
  Affine parents, captured placements, feather/density and shared Undo remain.
- Six nested cases preserve every pixel through two smart conversions and
  doubled embedded-master Image Size, with cache/Undo/reopen checks. Outer
  instances are affine; the child has perspective. These fixtures have zero
  feather and full density and do not establish arbitrary nested-projective
  resampling parity.

Independent Python byte readers confirm all ten corrected appearance pairs,
six resize pairs and six original/nested/resized triples. The preserved prior
production build fails the actual reset workflow; the corrected build passes
reset, basis editing, Undo/Redo and source-bearing reopening against downloaded
PNG references. Existing affected cases retain genuine 50 MP mask sources,
float mask tools, smart render frames, proofing and cancellation.

The first native cache probe records all nine stale-appearance states rather than
only the first failing assertion. Earlier reports and the old production
foreground remain available. The raw baseline-capture helper needed its existing
Playwright import and ESM package context resolved when copied outside the
repository; the successful capture retains the same product/assertion. No pixel
tolerance or acceptance timeout was relaxed.

[Compact receipt with raw pixels, source-bearing files, readers, reports and source fingerprints](mask-plane-owner-2026-10-31.json.gz).

## Remaining scope

This does not close F03/F06/F10/F14. Wider ordinary/filter/master source formats
and replacement, nested projective/feather/horizon behavior, all-kind mapped
tools, lifecycle/resource/photographic/physical-device/sustained process-memory
acceptance, general warp and native float wet tools remain required. The original
<=33 ms live-input p95 / <50 ms routine-task targets and every unfinished
professional, AI, workflow, ChatGPT/live identity, commercial, specialist and
motion requirement remain active. No account, upload, paid call or REST/browser
synchronization is added.
