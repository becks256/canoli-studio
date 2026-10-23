# Inspectable retained history

Open **History → Inspect retained history**, or search for **Inspect history** in the command palette. The action has no default shortcut and can be rebound. Select a retained state to inspect the operation leading into it. Selection alone never changes the document. **Preview before and after** renders private reference images; **Move to selected history state** explicitly restores that state. **Reload history timeline** captures newer edits. The displayed current marker describes the captured timeline.

Navigation publishes the destination once, preserves the complete retained redo path, and does not execute old commands, scripts, decoders or generation jobs. Normal Undo/Redo continue from the selected position. A subsequent edit from an earlier state creates a branch and preserves the previous result. Persistent branches now retain their own latest accepted result and linear undo path. Saved comparisons below now pin accepted states and regions; cryptographic provenance, authorship and generation billing remain separate unfinished roadmap work. Existing workspace checkpoints and named versions are separate recovery controls.

## Inspection and previews

The timeline contains at most 60 transitions and 61 states. Position 0 is the **oldest retained state**, which may already contain earlier edits. The current position is the number of retained past entries. Later states are available for redo. Operation labels describe commands; timestamps, authors and AI provenance are not inferred from them. Displayed labels fit 240 UTF-16 code units plus an ellipsis, retain whole native graphemes when segmentation is available (whole code points otherwise), and disclose truncation; complete stored labels remain intact.

Changes include document field names, layer additions/removals/edits, changed field names and order/parent changes. Values are not copied into the report. The report displays up to 32 layer records, retaining the total and omitted count. A 250,000-visit comparison metadata budget bounds expensive unshared values. Unexamined fields are disclosed separately and must not be treated as confirmed differences. These limits never remove layers, edit document content or cap image dimensions. Embedded master/style/document changes can affect additional artwork without changing an instance's own record.

Shown before/after bounds cover listed layer geometry in document coordinates, excluding effect spread. They are not a pixel-difference region. Missing font/layout support may make individual bounds unavailable; this is disclosed. Previews show the full historical canvas fitted within 512 pixels, using the Canvas reference renderer, current browser fonts and the existing 8-bit sRGB editing behavior. They are not native-pixel comparisons, display/ICC soft proofs or evidence of cross-editor/font parity. Original resolution, accepted sources and source precision records stay intact.

Preview work uses privately leased source bitmaps and its own renderer/cache. It neither changes live artwork/history/selection nor re-develops RAW. Cancel, document switching/closure, edits and owner disposal invalidate pending results and release private resources; stale images cannot replace newer requests. Preview failure stays visible and supports retry/reload. Navigation checks the captured active document and revision before committing. Native controls, modal typing and editor shortcuts retain their existing boundaries.

## Trusted document and host API

Snapshots returned by `getSnapshot()` are immutable, including the root state, selection arrays, retained-entry metadata and document models. Change artwork through the OO API; use `toJSON()` or an explicit clone for serialization. Transaction labels must be strings and invalid labels reject before invoking callbacks, preserving valid retained-history metadata. Full string labels remain stored even when clipped for display.

`document.navigateHistory(position:number):void` accepts a safe integer from 0 through `past.length + future.length`, with no default. It uses the same stored snapshots as Undo/Redo and preserves their order and labels. The current position is a no-op. Invalid positions and calls inside synchronous document transactions reject without navigation. Changing history filters layer selection to IDs present at the destination; it does not invent a new selection. Existing locks do not prevent returning to a previously accepted state, matching Undo/Redo.

A move increments the document revision once. Canvas-space invalidation increments once if any crossed transition changes canvas coordinates. History observers receive one `undo`/`redo` direction per crossed transition after the final state is published; every callback sees the final model rather than intermediate states. Recipe recording advances its stored recording history by those directions and never reruns the recipe. Crossing the recording boundary retains the existing explicit recording-invalidated behavior. Reentrant model editing/navigation during publication or navigation callbacks rejects. All state subscribers are notified even when another subscriber throws.

If an observer fails after publication, navigation remains accepted and notifies the remaining history observers. The method throws **History moved, but an observer failed. Inspect the document before retrying.** Reload/inspect before retrying. A thrown observer value need not be an Error. No-op navigation emits no history event. Ordinary `undo()` and `redo()` use this same atomic path.

Trusted browser embedding code may call `editor.previewHistory(position:number, control?:{signal?:AbortSignal}):Promise<{before:Blob|null,after:Blob}>`. It renders the selected operation's adjacent states; position 0 has no retained `before`. Returned Blobs are PNGs. It rejects invalid positions, closed owners, rendering/encoding failures, cancellation and changed active documents/revisions. The caller owns any object URLs it creates. It does not provide native-pixel rendering, progress callbacks or an isolated file/export privilege.

As with Undo/Redo, isolated Scripts and internal plugins cannot navigate history during their atomic execution. `document.navigateHistory` throws **Use editor undo/redo after a script finishes.** Preceding commands in that failed script do not commit. Attached edits continue through ordinary commands and shared validation. The trusted preview service is not an isolated global. Existing plugin installation remains inert and grants are unchanged.

## Independent REST history

The existing loopback REST host owns its own headless documents. These endpoints do not locate browser documents or synchronize browser edits. Existing token/origin policy applies. No headless image renderer is introduced.

- `GET /api/v1/documents/:id/history` returns `{revision,position,length,states:[{position,label,labelTruncated}]}`. Positions and labels describe the current retained timeline.
- `GET /api/v1/documents/:id/history?position=N` additionally returns `change`, using the report above. Bounds may be unavailable in headless font/layout environments and are not rendered previews. Optional bounds are omitted when absent.
- `POST /api/v1/documents/:id/history` accepts strict `{expectedRevision:number,position:number}` and returns the normal document snapshot. Stale revisions return 409; malformed/noninteger/out-of-range positions return 400 without navigation. No-op navigation preserves the revision.
- If navigation was accepted before an observer failed, history/undo/redo endpoints return 200 with the actual current snapshot and a `warning` asking the client to inspect before retrying. They do not report an accepted move as rejected. The revision still advances once.

Unbranched documents retain history format 1. Branched history uses strict format 2, while saved comparisons use strict format 3, inside the existing checksummed native project 3/4 and workspace 2 containers; the document schema is unchanged. Older readers reject history versions they do not support; a history-2 reader cannot open comparison-bearing history 3. Workspace recovery and explicitly history-bearing native files preserve both directions and all branches. Normal browser Save project automatically includes history 2 when branches exist and history 3 when saved comparisons exist; unbranched downloads still omit linear history. Independent REST downloads require `?history=true` to include history and branches. Accepted source assets must remain available for retained states and are preserved by the existing project/workspace asset validation. Browser eviction, current format/font/precision limits and the broader professional-editor/performance gates still apply.


## Persistent document branches

The inspector's Document branches section creates a named alternative from the **current document state**, independently of the state selected only for inspection. Move to a selected historical state first if that is your intended fork. The first fork creates Main for the previous route; editing after Undo also creates an automatically named Branch N. Existing alternatives are never silently evicted. Each route retains the existing 60-transition window; a separate exact fork-origin snapshot survives window pruning. The graph records actual in-app parent branches, not authenticated authorship or an operation-time log. More branches require additional memory and project/recovery storage; no constant-memory or all-tool performance claim is made.

Switch to branch tip restores its latest accepted result with its own undo path, filters layer selection, increments revision and canvas invalidation once, and reruns no commands, models or decoders. Switching away from an undo cursor does not overwrite that route's latest tip. Selecting the active branch's tip uses ordinary forward history navigation. Explicit creation, renaming and deletion are revisioned history-management operations, outside artwork Undo/Redo. Names are trimmed, 1–120 UTF-16 units, unique under NFKC plus lowercase comparison. Renaming to the exact current name is a no-op. Auto-generated names skip collisions. Active branches and parents with children cannot be deleted; switch away and delete leaf descendants first. The UI requires explicit deletion confirmation. Branches are local to one document; workspace named versions remain separate.

Trusted OO API:

```ts
const candidate = document.createHistoryBranch('Warm alternative'); // string ID; activates the new branch
// Edit with ordinary layer constructors, properties and transactions.
const main = document.getSnapshot().branches.find(branch => branch.name === 'Main')!;
document.checkoutHistoryBranch(main.id);
document.renameHistoryBranch(candidate, 'Reviewed alternative');
document.deleteHistoryBranch(candidate); // only an inactive leaf
```

`createHistoryBranch(name:string):string`, `checkoutHistoryBranch(id:string):void`, `renameHistoryBranch(id:string,name:string):void`, and `deleteHistoryBranch(id:string):void` have no implicit arguments. Invalid IDs/names, duplicate names, transaction calls and reentrant navigation reject before publication. The immutable snapshot exposes `branches` and `activeBranchId`; serialized records are data, not a mutation API. Unknown IDs reject. Store subscribers see one accepted publication. If an observer fails after a change, remaining branch-switch observers still run and the API throws **History branch changed, but an observer failed. Inspect the document before retrying.** The change remains accepted; reload before retrying.

`onHistoryBranchSwitch(listener:()=>void):()=>void` observes accepted switches to a different branch and returns an unsubscribe function. It emits nothing for naming, creation, deletion or same-branch tip navigation. The semantic recorder explicitly invalidates active/paused recordings on an alternate-branch switch: start a new recording there. It cannot treat an alternate path as ordinary redo. Automatic forking after Undo continues the recorder's existing replacement-edit behavior.

Isolated Scripts/internal plugins reject all four branch mutations with **Use editor history branches after a script finishes.** Prior commands in the failed script roll back. Installation remains inert; no permission or global file service is added.

History 2 validates all current, past, future, branch-tip, branch-history and fork-origin models, document IDs, unique IDs/names, parent references, acyclic ancestry and active-tip/timeline consistency before installing a session. Project encoding/decoding, worker transport, source validation and stage cleanup include the entire branch graph. Accepted RAW/TIFF/AVIF source bytes and precision settings are retained even when no current or linear-history state references them. A missing/invalid source rejects loading; it is not silently dropped. Branch deletion releases graph references but does not promise immediate asset-store garbage collection.

### Separate headless REST branches

`GET /api/v1/documents/:id/history-branches` returns `{revision,activeBranchId,branches:[{id,name,parentId,retainedTransitions}]}`. `POST` accepts one strict tagged object:

```json
{"expectedRevision":3,"action":"create","name":"Candidate"}
{"expectedRevision":4,"action":"checkout","branchId":"<branch UUID>"}
{"expectedRevision":5,"action":"rename","branchId":"<branch UUID>","name":"Reviewed"}
{"expectedRevision":6,"action":"delete","branchId":"<branch UUID>"}
```

Successful mutations return the ordinary document snapshot plus `activeBranchId` and branch metadata. Stale revisions return 409; unknown branches, malformed/extra fields and prohibited deletion return 400 without publication. Accepted observer failures return 200 with the actual current state and the existing inspect-before-retrying warning. These independent sessions do not synchronize with browser documents or gain image rendering. Use `GET .../project?history=true` for branch-bearing native delivery.


## Saved comparison regions and branch ancestry

The inspector displays parent-ordered branch ancestry, active and selected markers, level and parent names. Selecting an ancestry row inspects that branch's metadata; **Switch to branch tip** remains the explicit document mutation. The list scrolls, long names wrap and visual indentation caps at six levels while the full actual level/parent remains displayed. Native buttons retain normal Tab/Enter behavior; this is not an ARIA tree widget with undisclosed keyboard rules.

In **Saved comparisons → Save a new comparison**, choose Before and After from the current document, any retained timeline state or any branch's latest accepted tip. Give the comparison a name and integer document-pixel region. Saving pins both complete immutable snapshots and their accepted source assets. It changes history-management metadata/revision once and leaves live artwork, selection, canvas invalidation and the linear Undo/Redo path intact. The snapshots survive pruning, branch renaming/deletion, normal project downloads, workspace checkpoints, recovery and named versions. Comparisons are never silently evicted. More snapshots/branches require more storage and memory; source images are not downsampled or limited by this metadata feature.

The region uses the common top-left document coordinate plane. x/y are nonnegative safe integers, width/height positive safe integers, and the rectangle must fit within the combined maximum width/height of the two captured canvases. Default: the complete combined extent. Outside either smaller canvas is transparent; off-canvas layer geometry is clipped to that snapshot's canvas. Changing canvas geometry does not infer registration, optical alignment or crop transforms. Select a saved comparison to rename/change its region, preview it or explicitly confirm deletion. Updates retain the original two states; create a new comparison to choose different states. Names trim to 1–120 UTF-16 units and are unique under NFKC/lowercase comparison. Names are independent of branch names.

**Preview saved comparison** privately renders that region on both sides, at no more than 512 pixels per edge and 262,144 working pixels, with no upscaling. Both outputs share identical dimensions and coordinates. A third PNG shows black for unchanged displayed pixels and magenta intensity equal to the maximum channel delta (0–255). Statistics report compared pixels, pixels with any nonzero delta, maximum channel delta, and mean absolute delta over all four channels. RGB values are compared after `round(channel * alpha / 255)`; alpha is compared directly, so invisible RGB does not create a false change. These are displayed sRGB8/premultiplied-RGBA measurements using current browser fonts, not full-resolution, ICC, font-portability or photographic equality claims. Large regions are downscaled; use small native-pixel regions for close inspection. The CPU comparison yields between scanline blocks and checks cancellation.

Previewing neither changes the document nor reruns commands, decoders, model jobs or generation. Source assets are privately leased. Cancel, closing, source document switching/closure, metadata/artwork revisions and editor disposal invalidate pending results and release private canvases/renderers/leases. Stale captures require Reload before metadata edits or continuation. Failed previews display recoverable errors. Object URLs belong to the caller and must be revoked when no longer used.

To edit a pinned state again, enter a new branch name and choose **Continue before as branch** or **Continue after as branch**. This restores the exact accepted snapshot as a new branch with an empty Undo path; only that snapshot was pinned as a comparison side. Existing routes/tips remain accessible. Revision and canvas invalidation advance once, selection is filtered and branch-switch observers invalidate active/paused semantic recording. No old operation is rerun. Subsequent ordinary edits get normal Undo. Deleting a comparison releases its graph references without promising immediate asset-store collection.

### Trusted OO and preview API

```ts
// Trusted browser hosting code, outside isolated Scripts.
const doc = editor.document;
const comparison = doc.createHistoryComparison(
  'Earlier versus current',
  {kind: 'timeline', position: 0},
  {kind: 'current'},
); // string ID; omitted region defaults to combined canvas extent
const preview = await editor.previewHistoryComparison(comparison);
// preview.before, preview.after and preview.difference are PNG Blobs.
// preview.width, preview.height and preview.statistics describe the displayed grid.
doc.updateHistoryComparison(comparison, {name: 'Reviewed comparison'});
doc.createHistoryBranchFromComparison(comparison, 'after', 'Reviewed alternative');
doc.deleteHistoryComparison(comparison);
```

- `Document.createHistoryComparison(name:string,before:HistoryTarget,after:HistoryTarget,region?:HistoryRegion):string`. Targets are strict `{kind:'current'}`, `{kind:'timeline',position:number}` or `{kind:'branch',branchId:string}`. Positions use the current retained route; branches identify their accepted tips, independent of their undo cursors. Target inputs are resolved at synchronous acceptance and stored as snapshots/captured labels, not mutable index references. All three required arguments have no defaults; only region defaults as described.
- `Document.updateHistoryComparison(id:string,changes:{name?:string,region?:HistoryRegion}):void`. Strict fields; omitted values remain unchanged. Empty/identical updates are no-ops, including revision. There is no default ID and no implicit source replacement.
- `Document.deleteHistoryComparison(id:string):void`. No default; unknown IDs reject. Deletion is separate from artwork Undo and the UI asks for confirmation.
- `Document.createHistoryBranchFromComparison(id:string,side:'before'|'after',name:string):string`. No defaults. Requires an existing comparison, a valid side and a unique branch name. It restores a new branch with no invented earlier transitions.
- `EditorApplication.previewHistoryComparison(id:string,control?:{signal?:AbortSignal}):Promise<HistoryComparisonPreview>`. control defaults to `{}`. Returns `{before:Blob,after:Blob,difference:Blob,width:number,height:number,statistics:{comparedPixels,changedPixels,maximumChannelDelta,meanAbsoluteChannelDelta}}`. Rejects unknown IDs, closed owners, stale state, cancellation, renderer/readback/encoding failure. No headless or isolated preview/file service is added.

All four document mutations reject inside synchronous transactions and reentrant history publication/navigation. Malformed targets/regions/names, duplicate names, missing IDs and unsupported sides reject before publication. Metadata updates do not produce artwork command events or fake Undo steps. Accepted metadata observer failure throws **History comparison changed, but an observer failed. Inspect the document before retrying.** Continuation uses the existing accepted-branch failure error. The published change remains accepted; all remaining switch observers are notified. Inspect/reload before retrying.

Isolated Scripts/internal plugins reject all four methods with **Use editor history comparisons after a script finishes.** Earlier commands in a failed execution roll back. Normal attached commands remain validated and undoable; installation and grants remain unchanged.

### Independent REST comparisons

- `GET /api/v1/documents/:id/history-comparisons` returns `{revision,comparisons:[{id,name,beforeLabel,afterLabel,region,beforeSize:{width,height},afterSize:{width,height}}]}`. It does not return source bytes or render images.
- `GET .../history-comparisons/:comparisonId` returns `{revision,comparison,change}` with the existing bounded/disclosed document/layer-field report between the pinned snapshots. Headless bounds may be unavailable; this report is not a rendered difference.
- `POST .../history-comparisons` takes one strict tagged object: `{expectedRevision,action:'create',name,before,after,region?}`, `{expectedRevision,action:'update',comparisonId,changes}`, `{expectedRevision,action:'delete',comparisonId}`, or `{expectedRevision,action:'branch',comparisonId,side,name}`. Targets/changes have the same validation/defaults as the OO API.
- Success returns the normal document snapshot plus `activeBranchId` and comparison metadata. Stale revisions return 409; malformed/extra fields, missing IDs, invalid regions/targets/sides/names return 400 without publication. Accepted observer failure returns 200 with the actual current snapshot and the existing inspect-before-retrying warning.

These are independent headless sessions, not browser synchronization. Native delivery must explicitly request `GET .../project?history=true` to include saved comparisons.

### History 3 persistence

History 3 stores `{version:3,past,future,branches,activeBranchId,comparisons}`. It requires at least one comparison; branches may be empty only with null activeBranchId. Comparison records include exact before/after models, captured operation/branch labels and a validated region. They contain no inferred author/time, model provenance, billing or cryptographic attestation. Admission validates every pinned model and document ID, comparison IDs/names, regions and the existing strict branch graph/active-tip invariants before installing a session. Source closure includes every comparison side throughout native validation/encoding/decoding, worker transport, recovery, branch continuation and staged-asset cleanup. TIFF/AVIF precision choices and RAW originals remain accepted-source data. Current document schema 41, native project 3/4 and workspace 2 envelopes remain unchanged. History 1/2 remain readable; comparison-bearing files require a reader supporting history 3. Removing the last comparison returns to history 2 when branches exist, otherwise history 1. Authenticated operation provenance, broader W05/release quality and the full roadmap remain unfinished.


## Recorded operation provenance (history 4)

New changed command commits record an operation ID, document ID, editing-session ID, accepted revision, local clock time, operation label, validated submitted leaf-command count/types and a host-assigned origin. This is an observation of an accepted edit path, not authenticated human authorship or cryptographic attestation. Browser edits and trusted browser embedding share **Browser editor / host**; standalone OO defaults to **Trusted host**. Separate REST sessions assign **Independent REST**. Isolated Scripts and installed plugin commands receive their source from the host commit, not from sandbox results. Plugins include installed ID/version/command and a per-execution ID. Connected client commits include connection/request IDs; this does not establish whether a human or model authored the request.

Actual host recipe execution adds the validated recipe ID/version. Candidate application adds the accepted candidate/job IDs and available provider/model declarations from the host job record. No prompt, script code, command parameters, API credential, account identity or charge is copied into these operation records. Provider declarations are not provider attestation. Billing and generation jobs remain separate; Undo/Redo, branching, previewing and continuation never rerun a model or authorize a charge. Isolated recipe code is attributed to its script/plugin commit unless a real host workflow supplied further identity; labels are never parsed to invent origins.

Each record describes a changed accepted command/transaction. Counts summarize submitted validated non-transaction leaves, including leaves that individually make no change; they are not an assertion that every submitted leaf altered pixels. Empty/no-op requests, failed transactions, previews, selection/view changes and history-management metadata do not create edit records. Local acceptance time is epoch milliseconds from the runtime clock, or null when that clock cannot provide a valid Date; it may be inaccurate or nonmonotonic. Accepted revisions include other metadata changes and are scoped by the editing-session ID, not a global sequential audit log.

Provenance attaches to **result states** using a parallel `{current,past,future}` map, rather than changing legacy HistoryEntry records. Undo/Redo and atomic navigation move the existing records without creating new IDs/times. Branch tips/origins and saved comparison sides preserve their corresponding records through pruning/deletion. Continuing a comparison keeps the captured result's identity with an empty Undo path. Subsequent edits get new records. Old states with no record remain unknown; operation labels, file timestamps and source-generation metadata do not backfill authors, times or workflows.

The inspector's selected-state and saved-side disclosures show the source, operation/session/revision, recorded local time, submitted command summary and available workflow IDs. **Observed at acceptance in this open document session** is computed from runtime-owned weak references. It is never serialized as a trusted flag. Reopening/recovery/import retains the record but displays **Stored record: not observed in this open document session and not authenticated**. Native files are user-editable; valid imported metadata remains an unverified stored claim. No login, signed identity, digital signature, trusted timestamp or tamper-proof activity ledger is implied.

### Persistence and admission

History 4 contains `{version:4,past,future,branches,activeBranchId,comparisons,provenance}`. Branch tips can carry `{current,past}` provenance; fork origins and comparison before/after sides can carry their point record. New records are strict: IDs/session IDs, revision/time range, origin shape and command summary are validated. Point arrays must match their retained model arrays. Records must belong to the owning document; repeated operation IDs must identify identical record payloads and identical result states across the graph. All metadata/models/sources validate before installation. These checks catch inconsistent references; they do not authenticate a file that an author has deliberately rewritten consistently.

History 1/2/3 remain readable without fabricated records. HistoryEntry stays `{document,label,canvasChanged}` for compatibility. New provenance-bearing sessions use history 4 inside existing native project 3/4 and workspace 2 envelopes; the document schema remains 41. Older readers reject unsupported history 4. Normal unbranched browser Save project retains **only the current result's record**, with empty Undo/Redo arrays, preserving the existing ordinary-download editing-history behavior and excluding unrelated historical assets. Branch/comparison-bearing projects and workspace recovery/named versions retain the complete retained graph and point maps. Explicit REST `GET .../project?history=true` retains full provenance/history; omitting that flag still omits headless history metadata. Library artwork capture remains intentionally history-free.

`GET /api/v1/documents/:id/history` now includes `provenance` on each state and the selected (`?position=N`) or current result. Values are null when unknown, otherwise `{operation,observation:'observed-in-session'|'stored-unverified'}`. Existing token/origin policy and independent headless ownership remain. Clients cannot submit a source/author via commands; strict request validation rejects unsupported attribution fields. The server assigns REST origin after validation. Source observation never bypasses revision checks, permissions, isolation or accepted-asset validation.

Command publication rejects reentrant artwork/history mutation. Every command observer receives independent owned before/after snapshots even if another observer fails or modifies its copies. A changed accepted operation remains recorded and remaining observers are notified. Trusted OO calls then throw **Command accepted, but an observer failed. Inspect the document before retrying.** REST commands return the accepted snapshot with the existing inspect-before-retrying warning, and a stale retry rejects. Recipes return success plus `warning` when their transaction was accepted before an observer failed. Candidate application preserves accepted assets/review state and throws an explicit accepted-edit error instead of removing referenced pixels. Inspect the actual current result before retrying.

Origin setters/scopes are internal trusted host coordination, never isolated mutation APIs. They apply only around final synchronous commits; async preparation captures context without holding it across awaits, so human edits cannot inherit a pending script/plugin source. The provided isolated document rejects attempts to override origin assignment with **History origins are assigned by the host.** Earlier sandbox commands in that failed execution do not commit. Async script candidate placement rechecks the live document/session, cancellation/deadline and current plugin read/write grants at the final synchronous commit. Execution completion or failure revokes pending host edit authority, including unawaited candidate calls; independently submitted jobs may still continue without attaching results. In-band revision accounting counts only the candidate operation carrying that particular host request ID; an intervening editor edit never becomes a script-owned revision. Existing plugin installation/grants remain unchanged. Authenticated attribution, signed/append-only audit services, wider release quality and the complete roadmap remain separate unfinished work.
