# Rounded-position main verification — 2026-11-05 UTC

Main `419a972` passes `npm run build` and `npm test` (3,428 tests across
346 files). The source browser invocation passes both tests covering 24 native
layouts. The selected production invocation passes all 45 workflows against
the emitted release. Both invocations finish with zero unexpected, flaky or
skipped cases. Node 26.13.0 is used for these checks.

All 3,977 frozen inputs remain unchanged through the terminal runs. All 177
release files match the reviewed release byte for byte. The 752 non-generated
source files match, as do all other source files except three generated worker
manifests: their dependency paths resolve to the same input files and hashes.
The final documentation-only build and guide check are recorded in the receipt.

The earlier complete 257-case canonical source run and 360/384 native matrix
result are review evidence, not new main invocations. Twenty-four native matrix
layouts still fail. The separate complete-single-span development is not
integrated. These local checks do not verify a Vercel deployment.

[Raw logs, browser reports, configurations, frozen input hashes and release identity audit](native-rounded-positions-main-2026-11-05.json.gz).
