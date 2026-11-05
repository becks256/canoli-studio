# Bounded rejected native paint — 2026-11-05 UTC

One matching operation remembers exact ordered primitive/font-owner identities
that already failed complete native ink or ownership verification. Every lookup
checks source/font lifetimes and cancellation. A one-MiB LRU bounds retained key
payload; oversized keys bypass it. Cleanup clears all keys and owner identities.
A cached rejection has no publication authority. Successful publication still
performs the existing complete original ink and ownership checks.

The isolated core passes `npm run build`, all 3,431 unit/API tests across
347 files, and 16 focused browser tests with zero skips/retries/flaky results.
Three new real-browser faults abort, release the plan or remove its captured
font on a rejection-cache hit: all withhold publication, retire resources and
permit a healthy original-source retry. All nine independent tracked Float32
outputs retain exact HDR/tiny-alpha values and partition words; actual original
source ink differs from its zero-tracking control in every case.

The unchanged original colored sideways diagnostic still reaches its 60-second
matching deadline. The implementation avoids 1,034 repeated renders and visits
138 distinct candidates, versus 38 in the uncached source. It publishes no result
and retires every private face/probe without changing the document. This measures
duplicate work, not a solved rendering case, lower user latency or editor-wide
performance. All 4,036 frozen core inputs remain unchanged through terminal checks.
The complete 262-case source suite, original 384-layout matrix, 57 selected
production workflows and broader roadmap acceptance remain required.

The tracked-paint reference now verifies actual visible source tracking rather
than requiring one private glyph representation. Its original assertion and all
nine initially exact outputs are retained in the horizontal receipt. No original
pixel/HDR/partition/invalid-input assertion is weakened. Early test-only
TypeScript weight and readonly scene-copy corrections are retained with the
successful build. The original canonical source and matrix evidence belongs to
the parent review; no new complete aggregate is inferred.

The separate upright-curve diagnostics reject common source origins, duplicate
GPOS compensation, baseline changes, source-codepoint selectors and original
font bytes as fixes for that exact original control. All tested variants retain
a maximum alpha error of 68. Differences affect the NoMark Latin A/V pixels;
the Arabic ink is exact. Chromium character queries agree while paint traces use
different fragment frames. Text-blob traces do not expose internal glyph offsets
and do not determine a replacement pose. No measured displacement is fitted.

[Raw results, original failures, changed-source reconstruction and frozen identities](native-rejected-paint-2026-11-05.json.gz).
