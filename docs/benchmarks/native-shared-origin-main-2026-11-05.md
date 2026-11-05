# Shared-origin main verification — 2026-11-05 UTC

Main `b60da27` passes `npm run build`, `npm test -- --maxWorkers=4` (3,428
cases across 346 files), three browser tests covering 56 native layouts and all
53 selected production workflows. Both browser runs have zero retries, skips,
flaky or unexpected results. All 3,978 frozen integration inputs remain unchanged
through terminal checks. Node 26.13.0 is used for these invocations.

All 753 non-generated source files match the reviewed source. Every other source
file also matches except three generated worker manifests; their dependency
paths resolve to the same files and hashes. All 177 emitted release files match
the reviewed release byte for byte. The final documentation-only build and
unchanged release audit are separately recorded in the receipt.

The complete 258-case source invocation and original 361/384 native matrix are
review evidence, not new main invocations. Twenty-three native layouts and all
unfinished broader roadmap gates remain required. The newer horizontal review
is separate. A successful local build does not verify a Vercel deployment.

[Raw reports, configurations, frozen identities and verification scripts](native-shared-origin-main-2026-11-05.json.gz).
