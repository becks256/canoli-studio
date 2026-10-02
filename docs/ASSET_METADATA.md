# Local asset metadata

Implemented initial A01/T04/T05 slice, 2026-09-22. This is technical extraction and inspection, not AI interpretation or a complete metadata-management system.

## Current behavior

Original raster imports automatically enqueue local analysis. Each asset store runs one dedicated metadata worker at a time, with an eight-second deadline per job. The worker uses the MIT-licensed `exifr` 7.1.3 parser for embedded EXIF, IPTC, XMP and ICC where the source/container is supported. JPEG and PNG are the initial verified image paths; WebP embedded metadata coverage is not claimed. Parsing failure yields file facts and a warning, not a failed image import. Internal clone tiles are excluded from automatic analysis.

The raster Properties inspector has an expandable **Asset info** section. It displays signature-detected file type, original byte length, original file name and browser-decoded width/height. Embedded fields retain namespace, key and value rather than overwriting conflicts between EXIF/XMP declarations. EXIF orientation is a file declaration; decoded dimensions describe the browser-oriented bitmap, not necessarily encoded header dimensions. The source's profile/depth declarations do not imply the renderer supports that profile/precision.

Every displayed field identifies its origin: **File fact** or **File declaration**. A declaration is not independently verified truth. Copyright/creator fields do not establish legal ownership; extraction does not infer missing rights, location, identity or camera data. No image or metadata is uploaded, and no model/provider is involved.

Worker failures/timeouts and unreadable worker messages are reported in the inspector, and the queue advances to the next asset. Completion checks worker identity, so late callbacks cannot overwrite analysis for a removed/reused asset ID. Disposed services cannot restart. Changing/discarding an asset store terminates its worker and clears queued work. Analysis results are derived state keyed by the immutable asset ID; project reopen and recovery rebuild results from retained original bytes. Results are not authored document data and do not create undo entries. The public scripting/REST contracts do not expose these results yet.

## Display bounds and parser limitations

Normalized results contain at most 512 displayed fields, four nested levels, 4,096 characters per string and 64 scalar array entries. Normalization visits at most 2,048 properties, including empty/unsupported values, and inspects only the first 64 scalar-array entries. Keys/namespace segments are displayed with a 160-character limit. Embedded field IDs are opaque extraction-local identifiers, unique even when shortened keys collide; they are not persistent correction targets. GPS ancestry is classified before shortening. Shortening/omission is disclosed. Binary parser buffers are not shown as text. Metadata text is rendered as React text, never HTML or executable instructions. These are metadata presentation budgets, not image-size import limits. The parser runs off the UI thread and can be terminated, but there is no strict worker heap quota; an eight-second deadline is not a guarantee against memory exhaustion. Large/malformed parser-input block limits, per-segment partial results and a broad hostile-input corpus remain future hardening work; normalization budgets apply after parsing, not to parser allocation.

## Sidecar export and privacy

**Export metadata sidecar** downloads JSON with format `luma-asset-metadata`, version 1, parser version, selected policy, typed fields, field origins, warnings and excluded-field count. It does not modify original image bytes or embed metadata in image exports.

Technical fields are included. Attribution declarations are included by default with a visible checkbox. Private fields are excluded by default; including them requires a separate checkbox labeled with names, dates, GPS and other declarations. Unknown fields are treated as private. The file name is private. GPS namespaces remain private even if a nested key resembles a technical field. This policy is a field-classification aid, not a guarantee that arbitrary metadata text cannot contain personal information; review values before publishing. Raw original bytes retained in a `.luma` project may still contain all embedded private metadata.

The inspector now edits a separate **Authored description** record on the selected raster layer: title, description, alt text, creator, copyright, license and keywords. Changes honor locks and support undo/redo, duplication, project saving and recovery. The OOP `LayerMetadata` constructor supports all layer kinds through scripts and command plugins; REST uses a full `metadata` replacement patch. See [the constructor reference](SCRIPTING_API.md#layermetadata) and [REST contract](API.md#authored-layer-metadata). These records were introduced in document schema v2 and persist in current schema v3; valid v1/v2 documents migrate when opened.

Sidecars include an optional `authored` object and `authoredOrigin: "user"`, separate from original declarations. The attribution checkbox controls authored creator/copyright/license as well as original attribution. Authored title/description/alt text/keywords require the private-fields checkbox, which is off by default. `excludedFieldCount` counts original extracted fields only. Authoring a value does not implicitly approve it for public export or prove ownership.

Human review states, field-by-field links between corrections and raw declarations, content hashes/palettes, library search, generated captions/tags, OCR and embedded metadata writing remain open in the full [AI feature specification](AI_FEATURE_SPECS.md).

## Verification

`tests/metadata.test.ts` constructs actual EXIF bytes and tests namespace conflicts, origins, privacy defaults and normalized-output bounds. `tests/metadata.e2e.ts` imports an EXIF-bearing JPEG through the real worker, inspects camera/artist fields including HTML-like content, checks the downloaded sidecar and reopens the project. The production suite imports a PNG through UI file input and verifies the bundled worker and sidecar privacy. Lifecycle unit tests exercise timeout termination, stale callbacks after ID reuse, disposal, worker construction failure and message decoding failure. Browser tests run malformed signatures and truncated EXIF through actual workers, verify the next valid extraction succeeds and keep editing available. Bounds tests cover cyclic objects, large empty-entry sets, long-key collisions and private GPS ancestry. These fixtures are initial evidence, not the full 100-file/multilingual/adversarial corpus in the roadmap.

Parser reference: [exifr source and documentation](https://github.com/MikeKovarik/exifr). The dependency is pinned; reevaluate parser coverage and quality when upgrading.
