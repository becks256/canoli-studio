# Benchmark artifacts

Keep readable findings, checksums and compact verification receipts in Git.
New raw ZIP archives in this directory are ignored. Existing tracked archives
remain in history unless explicitly removed.

The following original evidence archives are retained locally at their existing
paths and excluded from Git history because they exceed GitHub's file limit:

| Local archive | Bytes | SHA-256 |
| --- | ---: | --- |
| `float-color-2026-10-28.zip` | 164195201 | `74a327c038da9381cd1694929aa03b782fe2c80926e8f5f63a21f841f15730fa` |
| `float-palette-2026-10-28.zip` | 379090189 | `8b33d46661b0ee2088321b16e1507419dbd9ede3b4a318c31957b6bed294b6e3` |

Links to these two ZIPs in historical work logs resolve only in a checkout that
has the local artifacts. They are not downloadable from GitHub. Share large raw
evidence through an explicitly chosen artifact store rather than re-adding it
to ordinary Git history.

The 2026-10-31 cleanup removed only these two paths from unpublished commits;
published history and every other committed file were preserved. Benchmark
receipts keep their original commit identities. The
[commit map](history-rewrite-2026-10-31.json) relates those identities to the
cleaned history. A verified local Git bundle and backups of the in-progress
editor work are stored in the ignored
`.canoli/git-backups/github-benchmarks-20261031/` directory.
