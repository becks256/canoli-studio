# Smart-master independent mask planes — 2026-10-31

Starting point: `a6c1dba`. Converting a group containing a projected child forced
its independent ordinary/filter masks into child linkage. The original browser
reproducer changed 5,954 RGBA channel bytes, with maximum error 255, and lost the
unlinked relationship. Its report and exact parent source identities survive;
its temporary raw arrays were lost during an environment reset.

Conversion now rebases independent masks into the containing master document.
Expansion carries that master frame separately from child pose/perspective,
including nested/shared placements and renderer root/document adapters. Source
geometry, refinements and settings remain owned and unchanged. Placement folds
once. Projected full-frame raster masters retain child perspective; redundant
artboard clipping is omitted only when complete intrinsic support is contained.
Out-of-artboard projection and prepared-wet support keep real master clipping.

## Verification

The final complete build passes with Node 24.0.1 and 43 developer guides.
`npm test -- --maxWorkers=1` passes all **3,151 tests across 306 files**.
All **22 final production workflows** and **10 final direct browser comparisons**
pass without retries, skips or failures. The direct cases compare conversion,
ordinary/filter masks under four root/document transform combinations, cached
frames and full-frame projected masters with absent/linked/unlinked outer masks.
All their actual/reference RGBA comparisons are exact and nonempty.

The built application executes the maintained isolated group-conversion guide,
retains an unlinked mask through child edits, preserves original PNG bytes and
has exact Undo/Redo/project models and before/after/reopened PNG delivery.
Unit cases additionally verify independent copied definitions, child-versus-
instance motion, frame-adapter ownership and real artboard clip retention.

The initial 199-case source matrix passes 174 cases; 25 legacy SVG cases fail
only when writing JSON through dangling temporary symlinks. After repairing
those destinations, all **89 SVG mask/smart/composition cases** pass unchanged,
including every failed title. This covers the initial matrix plus the related
composition checks; it is not represented as one initially green 199-case run.
Existing genuine 50 MP scalar/bitmap-mask, shared-source and native SVG-prefix
workflows pass with their original thresholds and source checks.

## Diagnostics and limits

The first full Node 24 run had one obsolete SVG assertion requiring forced
linkage. Its replacement checks both nested independent mask placements exactly.
A concurrent full run later hit the existing five-second WASM texture timeout;
its isolated seven-test retry passed unchanged, followed by the complete passing
serial run. The default Node 26.13.0 environment failed existing native RAW/TIFF
checks; that diagnostic run was stopped. Node 26 acceptance remains unverified.

The environment reset also removed generated runtime/plugin/site/cache targets
and left old SVG report symlinks dangling. Only ignored generated destinations
and temporary report links were restored. A production Delete check failed once
and then passed alone unchanged; subsequent complete production runs passed.
An early reference scene reused IDs, and the first production fixture assumed
Redo restored selection. Fixtures now use unique reference IDs and resolve the
existing instance directly. Pixel thresholds and timeouts remain unchanged.

During the initial browser matrix, only an architecture sentence and the older
unit assertion changed. Runtime and executed browser files stayed unchanged.
The final direct, production and SVG recovery runs pin the final identities;
the rebuilt developer-page differences are recorded separately. Native pixel
WASM remains `bd8e933aeee525fea97b19b14ebeebefc3124aced93d739dcd5bc808d5b56a1b`.

This corrects containing-document mask placement. Existing output/native-context
feather/effect semantics remain; universal filtered/unfiltered photographic
parity is not asserted. Existing genuine 50 MP workflows exercise originals,
coverage and delivery; this slice adds no new full 50 MP mask-plane comparison.
Projective relinking, projected wet authoring, general warp, broad interchange,
sustained all-tool latency, whole-process memory, physical devices and every
unfinished original roadmap gate remain open. No schema, public signature,
permission, source-resolution limit or REST/browser synchronization is added.

[Sealed evidence](smart-mask-planes-2026-10-31.json.gz): **5,939,848 bytes**,
SHA-256 `695f3d420ab7b11723348f30c84f4fa6a9e10c58ae7d4c7033373d1edba41f9f`.
It retains exact commands, full reports/logs, source/release hashes, 36 raw RGBA
comparison arrays, original-bearing project/PNG witnesses, legacy SVG numeric
reports and development diagnostics. There are 145 final release resources and
67 retained new-workflow artifact files. The source matrix and SVG recovery
cover 242 distinct browser test titles; the 10 final direct cases are repeated
against final identities.
