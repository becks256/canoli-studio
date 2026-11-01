# Source-owned native text preparation — 2026-11-01

The original F08/F10 roadmap remains active. This increment connects a shared
native preparation owner to the existing styled-text rasterizer. It preserves
whole original shaping chunks, font sources and exact authored axis tuples;
optional source-linear colors and native character metadata prepare the next
paint implementation. It does not enable float TextLayer or identify glyph paint
primitives. [Contract](../FLOAT_TEXT.md#source-owned-native-preparation),
[compact evidence](native-text-plan-2026-11-01.json.gz).

Verified with Node 26.13.0 and Chrome for Testing 153.0.8010.12:

- Full build/typecheck with 51 developer guides passes. The full unit/API suite
  passes 3,357 cases across 331 files against actual rebuilt WASM.
- One complete final source-browser run passes 137 cases across 11 files, with
  no skips, retries or flaky cases. The six new checks cover exact source color
  and native geometry for normal/tight Latin, combining, Arabic, Indic and emoji
  source chunks; immutable snapshots; retained variable-font source ownership;
  cancellation/reentrant retirement/nonfinite geometry cleanup and retry; and
  zero extra color/character queries in ordinary byte text.
- Existing native/static font references, mixed/affine/range/path/vertical pixels,
  public controls, isolated scripts/plugin grants, source retention, Undo and
  portable reopening retain their explicit assertions.
- Four production checks pass: path typography, character formatting, vertical
  Inspector/native scripts/reopening, and the 390px guide without JavaScript.
- Independent Pillow decoding compares all 200,000,000 RGBA samples in each of
  the two 10000x5000 path/vertical PNG outputs with its complete native reference.
  Both are exact. Complete original PNG bytes/hash and bounded work windows are
  checked by the browser cases. These verify the existing byte text renderer
  after refactoring; they do not prove float text integration.
- All 3,516 captured code/configuration/fixture/test inputs remain unchanged
  across final verification. Release hashes and complete large-output artifacts
  are retained in the compact receipt. WASM release resources remain identical
  to the accepted parent.

The raw pilots remain available. Initial new harness imports were corrected;
nonfinite native points are injected as returned values rather than through an
IDL setter that rejects them first, and detached OO font properties are captured
before model removal. Reentrant geometry reads now check owner validity before
the next native query. The first broad run passed 136 of 137 and caught an actual
measurement-host lifecycle regression: serialization retired the DOM before the
existing curved-text bitmap publication check. The owner now retains that DOM
through publication and explicitly retires measurement afterward. The existing
fault assertion was preserved; the complete corrected 137-case run passes.

A checked markup getter rejects released/invalid owners. Measurement retirement
and release are idempotent; font leases remain valid after measurement ends and
collect after model/history and operation ownership ends. No new spans are
introduced to simulate glyph isolation. Native addressable-character metadata is
not a glyph-ID, UTF-16-range or independently paintable-cluster contract.

Exact native paint decomposition, intrinsic color-glyph sources, authored-alpha
composition and connected float TextLayer scene/tool/export/shared API/source-
bearing persistence/large-original acceptance remain required. Broader original
professional/AI/provider/workflow/device/performance/commercial gates are not
completed by this increment. No source-resolution limit, public schema/API,
plugin grant, REST/browser synchronization, account, upload or paid call changes.
