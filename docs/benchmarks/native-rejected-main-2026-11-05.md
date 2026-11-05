# Rejected-paint main verification — 2026-11-05 UTC

Main `023dc40` passes `npm run build`, all 3,431 unit/API tests / 347 files,
17 focused browser tests and 57 selected production workflows / 17 files.
Accepted browser checks have zero retries, skips, unexpected or flaky results.
All 4,036 frozen inputs are unchanged through terminal verification.

All 177 release files match the verified review byte for byte. All 767 source
files match except three generated worker manifests, whose dependency paths
resolve to equivalent metadata and the same actual content hashes. The focused
source run verifies 16 original horizontal joining layouts, exact tracked
Float32 outputs and source/font/cancellation retirement with healthy retries.

The first unit run was interrupted when sandbox restrictions caused API skips.
It is diagnostic only. The authorized full unit/API rerun passes without skips.

The review's complete 262-case source suite and original 364/384 matrix are
separate evidence. Two native mismatches and 18 matching-budget errors remain;
full typography, wider roadmap and Vercel deployment acceptance remain open.

[Raw reports, exact input identities and verification scripts](native-rejected-main-2026-11-05.json.gz).
