# Native TIFF disposal test ordering — 2026-11-05

A complete source-parent review unit run exposed an existing test-order race:
3,436 cases passed and one TIFF disposal case failed. Starting two admissions in
call order does not order their asynchronous inspection and original hashing.
An independent real-service probe kept all original 108,004 TIFF bytes intact,
gated the first hash, and recorded the second request completing before disposal
of the first. Its result was `[rejected, fulfilled]` with no remaining private
files. Eight ordinary-order probes cancelled both requests and also leaked no
files. Production TIFF code is unchanged.

The corrected test starts the second admission from the first request's actual
native-conversion progress callback, attaches rejection observation immediately,
then closes the service. Both requests must still reject and the cache directory
must still be empty. Neither assertion is relaxed; the setup now establishes its
claimed active/pending state.

Main base `3fc1435` passes build/typecheck and all 3,431 unit/API cases across
347 files. All 4,036 baseline input identities except the corrected test are
unchanged; all source, generated runtime and release bytes remain identical.
The older frozen seed predates the roadmap verification note already committed
in this baseline: that document is separately verified against the exact HEAD.
The separate source-grid/sideways browser reviews retain their own frozen inputs
and verification boundaries. This correction makes no new browser, native-matrix,
Vercel or roadmap-completion claim.

[Raw failed/final reports, real-service programs and original bytes](tiff-disposal-order-2026-11-05.json.gz),
470,982 bytes. SHA-256: `c32969048061d477a5e8bef61ea77930cff67b4d2a84f9a2073a55ccd09f8784`.
