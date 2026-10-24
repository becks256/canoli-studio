# Portable font recipes

Status: scoped F08 resource transport implementation. Verification results are recorded in the implementation roadmap. This extends the [font resource contract](FONT_FILES.md); it does not complete professional typography or the full roadmap.

## Recipe and package formats

Font-bearing recipes use `schemaVersion:2` and a nonempty `fontFiles:FontFileData[]` table. Every entry contains the exact content-addressed source/face identity, friendly name and strict resource descriptor. Duplicate identities reject. These are serialization records; execution uses the ordinary FontFile commands and Document transaction boundary. Source document IDs and native FontFace handles are never portable references.

Font-free recipes retain schema 1. Schema 1 rejects the new table and font actions, and schema 2 requires its table. A generated `CanoliFont_…` family request must resolve to an owned declaration and source when used; unavailable bytes fail preflight instead of silently publishing fallback text. Ordinary installed/system-family requests retain their existing behavior.

The additional actions are `{type:'font.file.add',id}`, `{type:'font.file.rename',id,name}` and `{type:'font.file.remove',id,replaceWith?}`. IDs are concrete 64-character lowercase hexadecimal face identities. Names and replacement requests support ordinary recipe parameters unless `literalValues:true`; resolved values still pass shared validation. Font library actions accept no layer target. Add reuses an identical existing declaration; rename/remove share normal locks, replacement/reflow and Undo behavior. Relinking records its existing add/remove command transaction rather than a new arbitrary mutation API.

Dependencies attach only when an executed command needs them. Skipped conditions and unselected font parameters do not install their unused declarations. Parameterized font requests can choose among multiple declared faces; packages retain every declared source needed for those choices.

Portable package container **3** carries schema-2 recipes with complete original font files and selected native render bytes. It reuses the native-project font payload format: source/native SHA-256, byte lengths, ordered extents, strict descriptor references and deduplication. Multiple selected collection faces share the whole original payload. Reading rejects missing, corrupt, conflicting, duplicate, unreferenced or trailing records. Admission reparses each original and verifies its selected descriptor before publication. Font-free packages remain containers 1/2; those versions reject font records. Serialization snapshots font metadata/Blobs before yielding, so an already captured package can finish after its source document closes.

## Trusted browser host

`editor.recipes.compilePackagePlan(file:Blob,params:Record<string,unknown>={},control:RawImportControl={}):Promise<EditPlan>` performs read-only package preflight. `editor.recipes.executeRecipePackage(file,params={},control={}):Promise<ExecuteRecipeResult>` privately prepares sources and publishes one ordinary transaction. Existing saved-package execution uses the same path. These are trusted browser-host operations, not isolated Scripts/plugin APIs.

Controls accept `signal` and progress `{phase:'inspecting'|'developing'|'encoding',fraction:number|null}`. Font preparation reports `inspecting`; each active font parser retains its 60000ms default deadline, excluding queue wait. Native faces load unregistered; registration for native planning/publication stays within synchronous work and never spans asynchronous RAW work or progress callbacks. Preflight leaves artwork, revision, selection, Undo and the owner source store intact. Package parsing/native validation failures, cancellation, session/owner/revision/selection changes, explicit source loss and locks prevent publication. Failed staging releases unused font records and registrations. A listener failure after an accepted transaction retains the committed resources and uses the existing acknowledgement warning behavior.

Plain JSON execution requires the referenced bytes in the receiving source store. `executeAsync` prepares native planning for owned sources; synchronous execution/preflight rejects an unavailable/inactive native dependency. Use a portable package when transferring to another document or machine. A source package does not embed installed system fonts automatically.

The following trusted example receives a caller-selected package Blob as `recipePackage`. It performs no chooser, network request or edit:

<!-- example: font-package-plan-trusted -->
```js
const plan = await editor.recipes.compilePackagePlan(recipePackage);
if (!plan.valid) throw new Error(plan.errors.join('; '));
return {
  valid: plan.valid,
  steps: plan.steps.length,
  commands: plan.resolvedCommands.length,
};
```

## Recording, library and batch

The recorder retains exact font dependencies across supported commands, pause and actual Undo/Redo. Recorded values remain literal. A recording that uses font bytes saves automatically as a portable package, including complete originals; failed storage keeps its pending source snapshot available for retry/download. Successful save or service disposal releases that temporary snapshot. Importing/saving a package remains inert; the library explicitly preflights and runs it after review.

Batch creation captures the package bytes and recipe together. A selected font-bearing JSON recipe snapshots its currently owned source bytes into a package; missing bytes reject creation. Package selection uses its stored bytes directly. Native font preflight validates each item's merged parameters. Each item prepares its own sources, commits through the same commands, saves a checksummed editable native scene before delivery variants and releases its store on completion/failure. Retry validates the accepted scene and inputs, reuses completed variants and does not replay the recipe. Delivery ZIPs include the native projects and a checksummed `font-preparation.json` index for font-bearing non-RAW scenes; existing RAW preparation delivery remains separate. Per-item font choices survive checkpoint/retry without depending on the active editor document or later library changes. Existing batch source integrity, cancellation, succeeded-item idempotency, variant rendering and delivery ownership remain in force.

Internal plugins keep their existing permissions, inert installation and isolated command boundary. REST font admission/download/relink remains the independent surface documented in [API.md](API.md); this change adds no REST recipe-package endpoint, browser/headless synchronization or plugin source-import permission.

Embedded-font SVG reimport, broader font/viewer/device/mixed-source acceptance, character runs, arbitrary axes, path text, language/shaping quality and sustained editor-wide performance remain open.
