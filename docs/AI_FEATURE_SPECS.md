# AI and intelligent-asset feature specifications

Status: proposed target contracts, with the local metadata extraction slice (T04/T05), analysis evaluation slice (T09), provider bake-off/capability evaluation (T10), async job service/budget ledger/staging lifecycle (T11), and generate-as-layer UI/candidate review/apply operation (T12) implemented; see [ASSET_METADATA.md](ASSET_METADATA.md), [ANALYSIS_EVALUATION.md](ANALYSIS_EVALUATION.md), and [PROVIDER_BAKEOFF.md](PROVIDER_BAKEOFF.md) for their exact scope. Protected masked edits and multi-layer decomposition (T13+) remain unimplemented. Planning date: 2026-09-21. These are implementation contracts to review and test, not current API documentation. Portfolio IDs refer to [FEATURE_STRATEGY.md](FEATURE_STRATEGY.md); delivery sequence is in [IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md).

## Shared architecture and invariants

Keep the existing OOP DOM and command/history boundary. AI services prepare suggestions, immutable assets and typed operation plans; they do not directly mutate document snapshots or evaluate model-written code. Asynchronous work occurs outside `Document.transaction`, which is synchronous. Validate the result and current revision, then apply accepted changes atomically in one command transaction. Stage assets before commit; keep committed assets for undo/redo; collect abandoned staged assets safely.

Proposed modules, not existing directories:

| Module                      | Responsibility                                                                                                                       |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `src/intelligence/metadata` | Bounded local byte parsers, normalization, field provenance and format mappings; worker execution.                                   |
| `src/intelligence/catalog`  | OCR/semantic suggestion interfaces, revision-keyed analysis cache, optional local index.                                             |
| `src/ai/jobs`               | Job lifecycle, consent scope, budget estimate, progress/cancel and revision-conflict handling.                                       |
| `src/ai/providers`          | Capability-based adapters: generation, masked edits, alpha, analysis, segmentation, supported dimensions and cost reporting.         |
| `src/ai/plans`              | Typed edit-plan validation, target resolution, region/permission validation and preview preparation.                                 |
| `src/core/assets` evolution | Content-addressed original/derived assets, staged commits, persistence, references and collection.                                   |
| `src/ui/intelligence`       | Metadata inspector, candidate shelf, change preview, jobs and review queues using existing design tokens.                            |
| Future server services      | Authenticated asset transfer, inference brokerage, durable jobs and spend ledger; separate from the current loopback REST prototype. |

The viewport, exported pixels, metadata, model input and generated output may all have different resolutions. Every job records coordinate transforms between them. If a provider limits dimensions, show the submitted crop/proxy and requested output placement; never downsample the original or turn provider limits into document import limits. WebGPU is an optional accelerator for local analysis/rendering, not a promise that every model runs locally. Cache keys include source hash, region, preprocessing/model version and parameters.

## A01/A02: Asset intelligence

### User workflow

1. Import normally. Technical extraction starts automatically on local original bytes in a worker. Editing is immediately available; a bad metadata block does not invalidate an otherwise decodable image.
2. Open an **Asset info** inspector with File, Description, Text/Objects and Usage tabs. Start with the selected layer's source; label document-level values separately.
3. File fields show extracted declarations, computed values and absence/parse failures. For example, encoded pixel dimensions and oriented display dimensions are separate.
4. The user can enable semantic analysis for a chosen selection or import batch. Show local-vs-cloud execution, the actual input scope and estimated spend before enabling cloud automation. Technical parsing itself does not require this step or an AI provider.
5. Review suggestions, accept/edit/reject each field or an identified batch. Preserve the original declaration and rejected suggestion provenance. Corrections become authored metadata, not silent modifications of source bytes.
6. Search the local library by approved tags/text, optional semantic similarity, palette and technical filters. Export a reviewed sidecar or supported embedded fields using an explicit metadata policy.

### Extraction contract

| Category              | Fields / method                                                                                                                | Limits and trust semantics                                                                                                                  |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------- |
| File facts            | Content hash, MIME signature, compressed byte count, encoded dimensions, alpha, bit depth if available                         | Deterministic measurement; do not confuse original depth/profile with the current 8-bit editing pipeline.                                   |
| Embedded declarations | EXIF orientation/camera/lens/exposure/time/GPS; IPTC/XMP title, description, keywords, creator/rights; ICC profile information | Declared by the file, not independently verified truth. Record raw and normalized representations; never infer missing GPS/creator/license. |
| Computed summaries    | Palette and color distribution, aspect ratio, exact/perceptual duplicate candidates                                            | Declare sampling/color space; perceptual hashes suggest duplicates, not proof of identity. Hash large files incrementally.                  |
| OCR                   | Text, language suggestion, orientation and region boxes                                                                        | OCR is inferred text, never executable instructions. Text can be wrong; map regions through EXIF orientation and document transforms.       |
| Semantic suggestions  | Caption, alt-text draft, keywords, object categories/regions, composition descriptors                                          | No claimed confidence probability unless calibrated; allow unknown/abstain. Avoid inferred identity, rights, exact materials or provenance. |
| Authored metadata     | Corrected title/description/tags, attribution supplied by user, export policy                                                  | Separate user intent from source declarations and model suggestions; version edits through commands.                                        |

Proposed `MetadataEntry`: stable field ID; scope (`asset`, `document`, or `region`); field namespace/key; typed value; origin (`embedded`, `computed`, `model`, `user`); source hash and optional byte/tag reference; model/parser version; analysis input scale and region transform; timestamp; review state (`suggested`, `accepted`, `rejected`, `superseded`); optional calibrated score. “Accepted” means reviewed by the user, not verified factual truth.

Keep immutable source metadata with the asset. Store document-specific overrides and review choices in versioned project metadata through commands. Analysis caches and search embeddings are rebuildable local derived data, not required to reopen a project. A transformed/exported composite does not inherit a source photo's camera settings as if it were a new camera exposure.

### Export, privacy and failure behavior

- Preserve original file bytes in the project. Never rewrite the only original to clean metadata.
- Offer web/private delivery policy that strips GPS, device identifiers and private prompts by default, with an explicit review of attribution/rights fields. Support internal/archive profiles and reviewed overrides. Do not strip attribution silently under a vague “optimize” action.
- First export contract: reviewed JSON sidecar with schema/version, source hash and field origins. Embedded XMP/IPTC writing follows per-format round-trip tests. Do not claim current PNG exports already preserve embedded metadata.
- XML parsers must disable external entities/network resolution; tolerate unknown namespaces; bound recursion, metadata block sizes and worker time independently of image dimensions. Treat code/HTML/URLs found in metadata as inert text.
- Store conflicting declarations without overwriting; mark malformed sections; keep image import usable. Background analysis uses cancellation and stale-hash checks. Cloud timeouts do not block manual editing.
- Cloud prompts/telemetry contain only approved content; strip sensitive metadata from model inputs by default. Regional processing, retention and training terms need provider review before selection. No guarantee about provider behavior without verified terms.

### Acceptance and evaluation

Use at least 100 consented fixtures: JPEG/PNG/WebP, orientation 1–8, Unicode, missing/conflicting fields, truncated tags, oversized malicious blocks, transparent images, multilingual text and scan-like posters. Verify exact extraction against fixture declarations; distinguish parsed data from its truth. All supported deterministic fixture fields and original-byte hashes must match; unsupported tags are reported. Corrections, per-document overrides and review states survive save/reopen and undo/redo. Export fixtures prove private-field exclusion and approved attribution handling.

Evaluate OCR by character error rate per language and visual box placement; semantic tags by precision/recall against human labels. Proposed pilot gate: at least 95% precision on tags eligible for bulk acceptance, at least 90% of captions need no material correction, and less review time than manual authoring. These are targets, not measured accuracy or model promises; if unmet, keep suggestions opt-in/manual and narrow claimed language/domain support. Test hallucinated brands/rights/identity and injection-like OCR text explicitly.

## A03: Generate assets as layers

### First release scope

Generate one standalone image asset into the current document: a background, object, texture or visual effect. Support prompt plus optional approved reference images, target dimensions/aspect ratio, placement and optional alpha requirement. Use one provider adapter after evaluation. A flat output becomes a normal `RasterLayer` with provenance; it remains movable, maskable, replaceable and adjustable, but its internal objects are not magically independent layers.

A structured scene request is later orchestration: explicit background/object/shadow jobs produce a `LayerGroup` of real assets. Native text is created as `TextLayer`, never advertised as editable if baked into a bitmap. Reliable generated vectors require actual validated vector output. Existing-image decomposition is A08, not implied by A03.

### Interaction and job lifecycle

1. **Describe:** choose output type and target region; show what references/crops will leave the device. List unsupported alpha/size/model capabilities before submission.
2. **Estimate:** show candidate count, estimate or hard spend ceiling, and output dimensions. Inference runs only after the configured user consent and budget checks.
3. **Generate:** asynchronous job card reports queued/running status, cancellation and errors; manual editing remains responsive.
4. **Review:** candidates live in a temporary shelf, can be previewed over the snapshot, and show differences/alpha edges at 100%. No completed candidate automatically replaces artwork.
5. **Accept:** choose insertion parent/order and validate target/revision/locks. Install the immutable asset and add the layer in one transaction. Undo removes the layer; redo uses the same asset without another model call.
6. **Iterate:** regenerate creates new candidates with linked provenance. Reopening a project uses stored accepted outputs even if the provider is unavailable.

Job states: draft → estimating → awaiting consent → queued → running → succeeded → reviewed/applied or discarded. Alternative terminal states: failed, cancelled, expired; stale document results enter conflict review rather than automatic apply. A provider may keep running after local cancellation; reflect “cancel requested” until acknowledged and report possible charges accurately. Resubmission needs an explicit retry policy and new attempt identity; reconnect must first query the existing job.

### Proposed persistent records

`GenerationRecord`: ID, provider/model/version when supplied, task kind, user prompt and revised prompt if any, reference asset hashes, permitted region/mask hash, source document/revision, preprocessing/placement transforms, requested and returned sizes, seed if supported, parameters, timestamps, provider job ID, output asset hashes, estimated/actual cost and currency, usage units, status/error class and provenance version. Secrets and raw credentials are excluded. Private prompts remain private in public exports unless explicitly included.

`GenerationCandidate`: ID, record ID, immutable asset reference, optional verified alpha/mask/depth auxiliary assets, proposed placement, validation result and review state. Persist accepted records and retained candidates in the future project schema; expired temporary candidates can be collected. Do not record model-dependent “seed” as a promise of reproducibility: exact replay means retaining output bytes.

No special generated-layer subclass is needed for first release. Extend `RasterLayer` metadata through a versioned provenance reference. Add capability-specific objects such as masks/linked components only when their rendering behavior exists. Asset and job constructors belong to host services, not the pixel renderer.

### Result validation and safeguards

Validate MIME signatures, decoded dimensions, finite placement geometry, asset ownership, alpha semantics and resource availability. Reject malformed responses, unexpected executable content and outputs outside requested capability bounds. Do not fetch arbitrary model-provided URLs; use trusted provider endpoints or controlled signed asset URLs with bounded redirects and host checks. A white background is not transparency. If alpha requires segmentation, show it as an additional processing step with its own quality/cost.

Compare against the snapshot used for the job. MVP uses conservative revision conflict handling: retain a candidate and ask for explicit re-placement after any intervening document edit, rather than silently guessing. A future dependency fingerprint can allow unrelated changes only with tests proving equivalence. Applying candidates to a locked/deleted target fails cleanly and leaves the result available for manual placement.

### Acceptance

Test opaque and transparent outputs, canvas/group placement, cancellation at each state, duplicate delivery, stale revision, undo during generation, provider timeout, charge uncertainty, invalid bytes, memory failure, project reopen and offline redo. At least 50 real evaluation prompts must cover assets rather than only full scenes; measure alpha-edge quality, unwanted text, reference drift, cost per accepted asset and required corrections. Provider mocks test control flow, not model quality. Save/reopen renders the same accepted bytes without network access. No credentials appear in files, logs, scripts or plugin state.

## A05/A06: Localized edits and protected content

_Status: Implemented in Ticket T13 (2026-09-27). See [docs/IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)._

A mask defines the writable region; protected content is excluded even if the provider changes it. Keep original source assets immutable. For background edits, composite generated pixels only through the allowed mask, with protected regions taking priority after feathering. Include context outside the editable crop only with explicit transfer scope; receiving context is not permission to replace it.

Two distinct promises are enforced in code:

- **Protect original asset:** Original source image bytes stored in `AssetStore` are strictly immutable and byte-for-byte preserved after candidate generation, staging, and layer promotion.
- **Protect visible region:** The mathematical verification kernel (`evaluateProtectedRegionInvariant` in `src/ai/diff/engine.ts`) enforces the exact-region invariant ($\Delta = 0$) inside fully protected pixels, with allowable delta scaling across feather boundary transitions. If a provider leaks modifications into protected pixels, application is blocked with `ProtectedRegionViolationError` unless the user explicitly acknowledges the violation and authorizes an override.
- **Compositing Guard Kernel:** `compositeProtectedEdit` deterministically guarantees byte-for-byte containment by stamping reference pixels over protected zones.
- **Result-Diff Inspector:** Visual inspector (`src/ui/ResultDiffInspector.tsx`) integrated directly into the candidate review shelf with Before/After Split Wiper, Difference Heatmap canvas, Side-by-side mode, and quantitative scorecard metrics (Protected Area, Violations count, Max Channel $\Delta$, Preserved %, and Edit Area MSE).
- **Non-destructive application:** Masked edit layers are promoted into standard `RasterLayer` with attached `LayerMask` and full provenance keywords (`protected-invariant-verified` or `protected-invariant-override`) in a single synchronous `Document.transaction` supporting 1-step undo/redo.

## A08/A10/W01/W02: Reconstruction, assistant and recipes

_Status: Recipe schema, deterministic recorder, semantic targets, and dry-run EditPlan engine implemented in Ticket T14 (2026-09-27). See [docs/IMPLEMENTATION_ROADMAP.md](IMPLEMENTATION_ROADMAP.md)._

Reconstruction returns candidate object masks, OCR text and a proposed layout. Users approve replacements. Missing background behind an object is inferred/generated, never recovered as historical truth. Font matching and layout confidence are explicit; retain the original as a hidden reference.

An edit assistant proposes an `EditPlan` (`src/ai/recipes/types.ts`) with typed operations, stable target IDs, preconditions, asset inputs, permission scopes, expected visual changes and estimated spend. Preview deterministic commands without charging. Require review for external generation/destructive replacement under the chosen automation policy. Validate before and after model execution; embedded text, metadata and plugin descriptions are untrusted data, not instructions. If intent or target selection is ambiguous, stop at a proposed plan instead of applying broad changes.

Recipes bind semantic parameters (input image, subject mask, target format, background reference) rather than hardcoded document IDs. The system enforces:

- **Declarative, versioned Recipe schema:** `Recipe`, `RecipeStep`, `RecipeParameter`, `SemanticTarget`, and `RecipeAction` with Zod validation.
- **Semantic target resolution:** `role: "selected"`, `role: "background"`, `role: "topmost"`, `role: "bottommost"`, `{ by: "name", pattern }`, `{ by: "kind" }`, `{ by: "tag" }`, and `{ by: "stepResult", stepId }`. Rejects ambiguous targets (`ambiguityStrategy: "fail"` by default).
- **Precondition & dry-run validation:** `compileEditPlan` simulates operations against cloned document state without mutating real artwork or history, computing scorecard metrics (`layersAdded`, `layersModified`, `layersRemoved`, `canvasResized`, `estimatedSpendCents`).
- **Atomic execution & 1-step rollback:** `executeRecipe` executes inside a single `document.transaction(...)`, committing all resolved commands into a single history entry for one-step undo/redo.
- **Deterministic action recorder:** `RecipeRecorder` listens to document commands via `Document.onCommand(...)` and generates portable recipes with automatic tone parameterization.
- **Interactive UI:** `RecipeDialog` with Presets library, parameters form, live dry-run scorecard, and Action Recorder.

## W02/W03: Resumable batch runner and delivery manifest

_Status: Resumable batch runner engine, deduplication/idempotency controls, budget ceiling preflight, cryptographic SHA-256 delivery manifest, PKZIP 2.0 packaging, and BatchRunnerDialog UI delivered in Ticket T15 (2026-09-27)._

Each batch item has a ledger entry, source hash, staging checkpoint, deliverable records, review state, and verifiable output manifest:

- **Deduplication & Zero Re-Billing:** When resuming an interrupted or completed batch, succeeded items are strictly skipped. No redundant worker executions, no double inference spend, and no deliverable overwrites.
- **Selective Retry:** Failed items are selectively retried via `retryFailed` without re-running or altering already succeeded items.
- **Budget Ceiling Enforcement:** Preflight cost estimation checks both configured batch budget ceiling and the human-approved budget ceiling in `BudgetLedger`. Any overage blocks execution with `BudgetExceededError` before workers start.
- **Cryptographic Delivery Manifest (`delivery-manifest.json`):** Every deliverable variant is hashed via SHA-256 with byte length, dimensions, format, and review state. Version-2 manifests include a canonical `integrity.manifestHash` over the complete payload except `integrity`, including source hashes, dimensions, costs and summaries. `verifyDeliveryManifest` validates the strict schema and complete checksum; legacy partial checksums fail verification.
- **Standard PKZIP 2.0 Packaging:** `exportDeliveryPackageZip` bundles `delivery-manifest.json` and all deliverables into a standard uncompressed `.zip` archive with CRC32 integrity checksums.
- **Document History Isolation:** Batch runs operate purely on isolated staging `DocumentData` clones. The active editor document's undo/redo history remains untouched (zero undo pollution).
- **Interactive UI (`BatchRunnerDialog.tsx`):** Accessible modal dialog with 3 tabs:
  1. _Queue & Setup_: Item queue management (canvas capture, file upload, sample assets), recipe selection, multi-variant toggles (1:1, 9:16, 16:9, 4:5, or custom specs), concurrency limit, budget ceiling, and live preflight estimation.
  2. _Runner & Controls_: Active run selector, status badges, progress bar, Pause/Resume/Cancel/Retry Failed controls, metrics grid, and live per-item execution table.
  3. _Review Grid & Manifest_: Filterable review grid (All, Unreviewed, Approved, Rejected, Flagged), quick review actions, review notes, individual deliverable downloads, cryptographic integrity check button, `delivery-manifest.json` export, and `.zip` delivery package export.
- **Shortcuts & Navigation:** TopBar "Batch" button with `Boxes` icon and `Mod+Shift+B` keyboard shortcut (`src/ui/shortcuts.ts`).

## Planned OOP, scripting, REST and plugin contracts

Illustrative host API design only; these constructors/methods are NOT exported today:

```ts
const request = new GenerationRequest({
  kind: "asset",
  prompt: "Botanical cutout",
  output: { width: 1024, height: 1024, alpha: true },
});
const job = await editor.ai.submit(request, { budgetId, baseRevision });
const candidate = await job.result(); // host service, outside document.transaction
await editor.ai.apply(candidate.id, { expectedRevision, parentId });
// apply validates/stages assets, then commits a normal RasterLayer + provenance once.
```

Proposed value/handle types: `AssetMetadata`, `MetadataEntry`, `LayerMask`, `GenerationRequest`, `GenerationJob`, `GenerationCandidate`, `EditPlan`, `Recipe`, `BatchRun`. Constructor validation and attached mutations follow existing OOP conventions. Human-edited metadata and accepted masks/layers use commands; job progress and cost ledgers do not pollute document undo. Paid inference is not undone by undoing a layer.

The existing five-second isolated scripting sandbox must not be stretched into a provider client. Proposed next-version host capability: scripts construct a typed request intent, explicitly return it, and receive a job ticket through a permissioned host bridge. Separate invocations inspect status or request application of a completed candidate. No keys, network or promises waiting for inference inside the current runtime. Ordinary document scripts remain local. Update the public scripting reference only when this capability is implemented and tested.

Proposed authenticated REST v2 resources: `POST /assets`, `POST /analysis-jobs`, `POST /generation-jobs`, `GET /jobs/:id`, `POST /jobs/:id/cancel`, `POST /documents/:id/apply-candidate`, `POST /export-jobs`. Use idempotency keys, expected revisions, scoped asset IDs, authorization, bounded concurrent jobs and durable status. Separate upload/job/render services must exist before claiming these routes work. Browser and server documents remain separate unless the user explicitly opens a synchronized project; no implied synchronization with today's localhost API.

Plugins would request narrow new capabilities such as `assets:analyze` or `ai:generate`, approved at host execution with user budgets and selected-asset scope. They do not inherit network or credentials. This needs a versioned manifest/runtime extension; do not add permission strings to v1 and bypass its rejection behavior. Defer custom plugin panels/marketplace until isolation, revocation and resource quotas have been reviewed.

## Costs, privacy and deployment decision gates

Use an adapter interface and evaluate one provider first; choose by image/alpha/mask quality, latency, API terms, actual unit costs, availability, retention and moderation requirements. No provider, model, region or credential flow is selected here. Recheck official capabilities at implementation time. Local inference is a candidate for segmentation/OCR where model download, license, hardware and memory are acceptable; a manual fallback remains required.

Prototype remote generation needs a host credential strategy; hosted production uses server-held secrets, authenticated users, scoped uploads and a durable usage ledger. Do not put a production key into browser localStorage, plugin code, project files or the existing unauthenticated loopback service. BYOK is a separate explicit product decision, not a shortcut to safe browser credential storage.

Reserve a budget before submission, reconcile actual usage, identify retry attempts, and stop new jobs at the cap. Do not assume cancelled/failed jobs are free. `Cost per accepted output = total inference spend across all attempts / accepted outputs`; also track storage, bandwidth, hosting and support per active account. Targets: proposed variable service cost below 20% of realized revenue, and reject pricing that relies on heavy users consuming nothing. This is an internal planning target, not a forecast or financial recommendation. A positive gross margin does not include founder labor or prove a viable business.

No hosted queue/account/billing system is implemented by these documents. Delivery needs retention/deletion controls, consent records, access auditing without raw sensitive prompts, rate limits and abuse handling. Detailed provider terms and any jurisdiction-specific obligations require review at the implementation gate. Signed provenance is a later standard-conformance project; ordinary generation records must not be branded verified Content Credentials.
