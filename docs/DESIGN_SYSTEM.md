# Canoli Studio design system

## RAW master delivery

RAW review offers a separate High-precision TIFF section with explicit integer/float precision, container and current output profile. Export does not need the 8-bit editing consent checkbox, does not Apply draft development, and stays distinct from canvas layers/appearance. Explain native source precision and current TIFF reopening limits; expose real waiting/development/encoding/verification and keep Cancel active. Use existing custom controls and dialog scrolling. [Contract](RAW_TIFF.md).

## Profile-aware batch and recipe delivery (F10/W01/W03)

Batch custom variants expose TIFF/PDF and an explicit capture of the current output profile for supported formats. Show the captured target in chips and actual conversion/fallback in review. Preset import/export and recipe attachment stay outside artwork/Undo. Disable conflicting controls while native preparation is pending, keep close/cancel active and expose errors rather than silently falling back to sRGB. [Contract and current verification](COLOR_DELIVERY.md).

## Color settings and honest proof status

Use the existing custom dialog, selects and check fields. Lead with the actual sRGB8 editing plane, then output RGB profile/intent/BPC and separately staged canvas-proof controls. File import shows inspected profile identity/class/space; CMYK is a proof target, never an RGB output choice. Apply preflights the whole draft; Cancel stays available during native work. Surface failures and intent fallback. Footer labels output preset separately from actual pending/applied/failed proof presentation. Export describes the selected RGB profile or explicit sRGB limitation; avoid working-space assignment or physical-print claims. [Workflow](ICC_ENGINE.md).

## Clipping controls

Use the existing Appearance check-field and command palette for clipping. Disable creation without an eligible preceding base or under existing busy/lock rules; allow release of an orphan. Show the current base name in the Inspector and an indented arrow in clipped layer rows. Do not expose renderer/cache implementation details in the control. [Behavior and limitations](CLIPPING_MASKS.md).

## Move spacing feedback

Use the existing custom Move options for Spacing guides and opt-in Equal spacing under artwork attraction. Draw pointer-inert accent interval lines with endpoint ticks and screen-sized monospace pixel labels. Keep rounded values explicit, distinguish equal values and place nearby labels in separate lanes using their actual rendered extents. Clear transient feedback with cancelled/stale gestures and disabled guides. Preserve the ordinary selection outline, focus, Undo and export pixels. Do not add shortcuts, tool-rail icons or a new component framework. See [LAYER_ALIGNMENT.md](LAYER_ALIGNMENT.md#spacing-feedback-while-moving-artwork).

## Declared alignment inspection (A12)

Design checks now accept optional explicit alignment rules against a canvas or independent key-layer frame, with document-pixel tolerance. Shared authored geometry includes affine parents, path/vertical text origins and active wet-paint/raster-replacement extents. Locked references remain readable; hidden targets, empty/unknown geometry and unresolved numerical precision remain explicit unverified results. Geometry work stays in private workers with scoped metadata and existing read/asset grants. Inspection changes no artwork/history or source bytes.

Omitted alignment policies retain strict version-1 reports; explicit policies use version 2 with measured evidence and complete matched/mismatched/unavailable/excluded coverage. The custom dialog exposes reviewable rules, stale-result protection, download/navigation and document-instance binding. Document schema 47 and existing native project/workspace/permission contracts are unchanged. Inferred alignment intent, bleed, rendered visibility, contrast/legibility and broader A12/roadmap gates remain required. See [DESIGN_CHECKS.md](DESIGN_CHECKS.md) for signatures, defaults, errors, limits and the dated verification boundary.


## Public vertical text (F08)

Schema 47 adds optional TextLayer `writingMode` (`horizontal-tb`, `vertical-rl`, `vertical-lr`) and `textOrientation` (`mixed`, `upright`, `sideways`). Shared OO setters/commands, reusable paragraph formats and awaited native preparation retain logical Unicode and character/font ownership. Vertical wrapping uses the existing logical `wrapWidth` as physical height. Derived `textFrameOrigin` and `textInlineExtent` separate the physical frame from its logical alignment extent; client patches cannot author these caches. Native paths retain their separate `textPathOrigin`. Defaults preserve legacy horizontal rendering; text that has entered native writing retains its native character-layout marker when switched back to horizontal.

The custom Inspector exposes writing direction, glyph orientation, paragraph height and vertical alignment. Corner resizing follows the inline axis and keeps the opposite frame corner under affine parents. Native projects/workspace/recipes preserve source text, geometry and complete original font/image payloads. Supported native SVG output/reimport retains writing/orientation and whole-line placement; unsupported inline writing/baseline graphs require explicit flattening. Independent REST sessions preserve the fields with estimated headless bounds; they do not synchronize with the browser. See [VERTICAL_TEXT.md](VERTICAL_TEXT.md) for the precise contract, limitations and dated verification status. Broader typography/interchange/device/performance and the original roadmap remain open.


## Vertical preparation and pending controls

Native vertical authoring uses Typography writing direction/glyph orientation controls, Paragraph height, rotated top/center/bottom alignment icons and geometry-aware corner resize through shared commands. It adds no rail icon or shortcut. The private renderer DTO remains internal. See [VERTICAL_TEXT.md](VERTICAL_TEXT.md).

## Path typography controls

Use the existing custom Typography disclosure with paginated vector-source choices, explicit Use vector path/Remove text path, named offset NumberFields with preview/cancel/commit, traversal and contour selectors. Explain that copied geometry is independent and path text has one logical line. Baseline anchors uses an indexed anchor and labeled incoming/outgoing coordinates plus explicit split/remove. Keep paragraph controls visibly in path mode, preserve scrolling/typing/focus, and surface stale/cancelled/source errors. Do not add shortcuts, rail icons or a component library. The existing Pen overlay also edits selected text baselines in layer-path mode. Keep screen-sized complete affine anchors/handles and a correct open/closed outline. Use the existing Alt independence, keyboard nudge/Delete/Escape, explicit midpoint/remove controls and separate mask target. Clicking empty canvas clears anchor selection without creating artwork; editable fields retain typing behavior. See [TEXT_PATHS.md](TEXT_PATHS.md).

## Styled SVG review and editing

Use the existing Import SVG dialog to disclose editable inline characters, embedded source counts and remaining flattening boundaries. Inspection stays inert. Preserve explicit Editable/Flattened/Cancel actions, preparation status and existing modal scrolling. After import, the existing Text content selection and Character formatting disclosure edit the native ranges; Undo and source-retaining project reopening remain ordinary workflows. No new shortcut, tool icon or UI framework. See [SVG_CHARACTER_IMPORT.md](SVG_CHARACTER_IMPORT.md).

## Character-range controls

Use a Character formatting disclosure below Text content. Retain its selection while using family/size/color/weight/slant/spacing controls; explain range scope and first-character values for mixed selections. Provide Clear selected character formatting, preparation status and errors. Cancel stale/unmounted preparation and retain ordinary Undo/typing shortcuts and the existing Inspector scroll region. Existing typography controls change paragraph defaults. No new shortcut, rail icon or component framework. See [CHARACTER_TEXT.md](CHARACTER_TEXT.md) for the contract, limits and dated verification status.

## Variable font-axis controls

Use the custom Typography Inspector and a Variable font axes disclosure. Show declared tags/names and source ranges through existing precision NumberField preview/commit/cancel behavior, eight axes per page and explicit Reset variable axes. Keep inherited/default versus explicitly authored values clear and disclose unsupported fonts/browsers. Retain ordinary focus/typing shortcuts and a bounded scrolling disclosure. No new rail icon, shortcut or component library. See [FONT_VARIATIONS.md](FONT_VARIATIONS.md).

## Stable text frames during ordinary edits

Moving/flipping/distributing text and changing its name, appearance, color, alignment, visibility or lock must keep the authored frame dimensions. Typography/layout controls and explicit reflow still recalculate them. Continue using existing controls and shortcuts; no new binding or input interception is introduced.

## Layer alignment reference controls

Show Align relative to and the six-direction chooser for a nonempty layer selection. Default single-root selection to Canvas and multi-root selection to Selection. Key object reveals a numbered selected-root chooser and explains that the key stays stationary. Share the current key with command search/custom bindings; disable invalid moving locks/geometry with a useful reason. Use compact reference rows, retain usable layer-tree height and bound the additional controls in a keyboard-scrollable region instead of letting them push the action footer beyond the viewport. See [LAYER_ALIGNMENT.md](LAYER_ALIGNMENT.md) for defaults, examples, errors and verification limits.

## SVG font-source review

Keep the custom SVG import dialog and explicit editable/flatten/cancel choices. Show the embedded-font declaration count and explain that editable projects retain supplied font files; structural inspection is followed by source validation during import. Decoding status covers images and fonts. Missing/malformed sources or unsupported canonical matching remain actionable errors without retargeting edited work. See [SVG_FONT_IMPORT.md](SVG_FONT_IMPORT.md).

## Portable font package review

Keep the existing custom Portable packages panel. Explain that packages retain image sources and complete embedded font originals; importing remains inert. Preflight asynchronously with a visible checking state, native source errors and a disabled Run action until the captured plan is valid. Recompute after parameter, selection or document changes and cancel stale/unmounted preflight. Keep explicit Run, cancellation/progress, source-sharing review, ordinary Undo and existing keyboard bindings. See [FONT_RECIPES.md](FONT_RECIPES.md).

## Font relinking interaction

In each Embedded font files row, offer **Choose replacement for [name]**. Open the existing inspector in a named relink context, require collection-face selection and an explicit **Relink selected face** action, retain read-only preview and expose **Cancel font relinking**. Preserve the friendly label while showing actual source metadata. Explain that prior bytes remain for Undo; capture the current owner/revision and reject stale, closed or locked targets. Wrap long row/action labels within the modal and retain its scrolling body/footer. No new shortcut, rail icon or component library is introduced.


## Font-file binding (F08)

Document schema 43 supports separately owned font resources, shared FontFile commands, explicit trusted embedding and native-project 5/workspace persistence. Selected native fonts preload into isolated script workers before text construction; no font chooser, host store, credentials or network grant is exposed there. Portable recipe/package/batch transport is documented separately in [FONT_RECIPES.md](FONT_RECIPES.md). Broader font/viewer/device/mixed-source acceptance and professional typography remain open. See [the current font-file contract and limits](FONT_FILES.md). Earlier font-source sections below describe read-only inspection/preview; explicit embedding is a separate operation.

## Font-file inspection interaction

Use a lazy native details disclosure within Document fonts, the existing custom controls, source filename/size disclosure and a labeled native face selector. A multi-face collection starts unselected. Paginate faces and axes independently without dropping source data; declared names are text. Keep explicit Choose/Inspect again/Preview/Cancel, recoverable inline errors, a scrolling body and retained modal footer. Shape in a private script-disabled iframe and display only copied pixels in the visible canvas; resize redraws and missing glyph fallback is disclosed. Explain that inspection does not install/embed or change artwork. No new shortcut, rail icon or component library. See [FONT_SOURCES.md](FONT_SOURCES.md).

## Document font-management interaction

Open the custom Document fonts modal through command search or Typography. Use exact request labels, searchable 30-row pages, stable explicit selection and text/style/override/embedded-scope counts. Probe selected/replacement availability without enumeration; debounce typed replacement requests and ignore obsolete results; require explicit fallback consent when unavailable/unknown. Installed-font discovery stays user-activated and shares the Typography family list. Stale revisions require explicit refresh, closed/switched owners reject, cancellation stays read-only and modal typing cannot trigger canvas tools. Keep all-or-nothing lock errors visible and provide normal focus restoration. See FONT_MANAGEMENT.md.

## Retained layer-row behavior

Keep all existing row dimensions, glyphs, nesting, labels, focus and hover controls. Retaining unchanged presentation must preserve current selection, inherited locks, drag eligibility/drop placement and filter/collapse state. Route keyboard/native clicks and pointer events through the current panel; disabled controls remain inert. Ctrl/Cmd-click on a rendered pixel thumbnail loads transparency through the current callback without selecting that layer; ordinary and Shift/Ctrl name clicks retain their selection semantics. Mutable previews and raster thumbnail dependencies must update normally. This adds no shortcut or visual component system.

## Native font feature controls

Use existing Typography Select controls labeled Capitals and Font stretch, and a NumberField labeled Weight value with preview/cancel/commit and 1–1000 requests. Retain preset/custom weight visibility and an explicit numeric conversion for relative/custom weights. Explain closest-face/synthesized glyph dependence and that stretch is not artwork scaling. Unsupported selectors are disabled with a readable status; Reset font features stays available when unlocked. Keep typing, Inspector scrolling, both themes and normal lock/error handling; no new shortcut, rail icon or component library. See [native font features](FONT_FEATURES.md).

## TIFF page selection

Within the existing Export dialog, keep Current document as the TIFF default and offer Selected open documents. Use labeled native checkboxes and an ordered list with Page N, document name and native dimensions, plus explicit Up/Down/Remove buttons. Closed selected entries stay visible and block export until removal; empty selection has an inline alert. Use stable session keys, preserve the scrollable body/fixed footer, both themes and keyboard focus, and show font/capability warnings for all chosen pages. No new shortcut or component library. See [multipage TIFF](TIFF_PAGES.md).

## Operation-origin disclosure

Use a native details disclosure under selected-state and saved-side history, showing a readable channel and runtime-observed versus stored-unverified status. Keep local clock, session/revision, submitted types/counts and workflow IDs in wrapped definition rows. Never infer authors or provider verification from labels, conflate billing with Undo or hide unknown legacy provenance. Saved-side labels say Captured before/after. Preserve the modal body scroll and fixed footer at both themes/short widths. No new rail icon, component library or default shortcut.

## Saved comparisons and ancestry

Use a scrollable parent-ordered ancestry list of native buttons with actual parent/level, active and selected markers; cap visual indentation without losing depth metadata. Keep explicit Switch separate from inspection. Saved comparisons use the custom inspector section, independent name and state selectors, integer region fields, explicit Save/Preview/Delete/Continue actions and inline deletion confirmation. New comparison creation lives in a native details disclosure. Preserve typing, focus, stale errors, retained modal footer and both themes/short windows. Three labeled image panes disclose downscaling and measured displayed-pixel limits; never imply full-resolution, author or model provenance.

## Branch controls in history inspection

Use the existing custom inspector section, labeled native branch selector and name input, explicit Create/Rename/Switch buttons, parent-name disclosure and active marker. Creating forks current artwork, not the row selected for inspection. Retain 60-transition and recorder-switch disclosures, stale-capture errors, wrapped controls and independent body scrolling. Disable active/parent deletion and ask for explicit inline confirmation for an inactive leaf. Explain that edits after Undo preserve alternatives rather than replacing the old result. No new shortcut or component library.

## History inspection controls

History provides Inspect retained history; command search provides the same rebindable action without a default chord. Use the custom modal with a captured-current marker, scrollable chronological state buttons, explicit change-field/omission reports, before/after image panes, Reload and Move actions. Selecting a row only inspects; navigation is explicit. Retain footer/Cancel and normal focus/typing/shortcut containment in both themes and short windows. Label the oldest baseline honestly, clip excessive displayed operation labels without changing stored history, and distinguish geometry bounds/incomplete comparisons from pixel differences. Explain that a new edit before the tip preserves the previous result as a branch. Captured-state and accepted-observer errors remain visible. No new rail icon/component library.

## Reusable palette interactions

Use the custom Color palettes dialog from the rail, rebindable command search and a compact accessible palette button beside native color inputs. Keep native labels/disabled states and preview/commit boundaries. The app owns the modal, so a context menu may close without destroying the picker. Search includes named swatches and hex values. Palette selection opens a draft; explicit Save, Reload details and Save as copy distinguish local intent. Pair named swatches with visible hex values; color is not the only label. Reordering has labeled Earlier/Later buttons and native color inputs remain keyboard accessible. Paginate long catalogs/swatches without evicting data. Use a scrolling body and retained Done/Cancel footer, wrapped controls and names, both themes and short viewports. Never hide storage/corruption errors; explain that saved colors are copied values, local only and sRGB8. No default shortcut or component-library dependency is added.

## Artwork library interaction

Use the custom modal, text fields, text area and buttons with independent body scrolling and retained Cancel/Done. The rail and unassigned rebindable command open one library. Names/descriptions/tags are explicit local catalog fields; show exact-content duplicate reuse without overwriting reviewed metadata. Search has stable selected IDs and 40 visible rows per page without evicting data. Keep edited metadata drafts until explicit save/reload; reject stale revisions. Offer on-demand preview, native download, inert pack import/export, place, removal and explicit clear confirmation. Distinguish corrupt-record recovery from verified export, disclose valid-only packs and preserve input shortcuts. Placing returns to the canvas with one undo entry; closing/canceling invalidates pending UI work.

## Account and sign-in interaction

Account data download is separate from Save project. Delete Canoli account opens a dedicated confirmation pane with retained Cancel/Done controls, explicit effects, current-identity verification when stale and a custom text input requiring exact DELETE before enabling the danger button. Keep controls at their normal height while the body scrolls. Treat typed editing shortcuts as input operations. Preserve the confirmation pane through same-account verification, clear it when account identity changes, and acknowledge deletion only after a valid server response.

Use the custom Account Dialog, neutral UserRound header icon, explicit status/confirmation/cancel/refresh controls and unassigned Account registry action. Start sign-in with Continue with ChatGPT in a separate named window so local artwork stays open. Show only verified display identity, require Create Canoli account or Link this ChatGPT sign-in before a new identity is attached, and keep matching-email/account distinction readable. Keep body scrolling independent of retained Done/close actions, use semantic tokens in both themes, and expose recoverable errors. Unconfigured installations explain availability without a false functional sign-in button. No invented OpenAI logo, inference claim or keyboard interception is introduced.

## ChatGPT connection interaction

Use the custom Dialog, Select, TextInput, Button and native checkbox controls. The header uses a neutral Plug icon and connected-document count, with the rebindable unassigned action in command search. Require an explicit document choice and pasted local code; reading is disclosed and writing/undo starts unchecked. Explain that returned names/text/settings can enter the connected conversation while original files remain local. Keep connection errors, cancellation, status and per-document Disconnect visible. Closing a completed dialog retains the connection; cancelling a pending attempt revokes it. Existing canvas gestures finish before external commits. Match the independent body scroll and retained close/actions pattern; do not invent OpenAI branding or imply this is Sign in with ChatGPT. Setup/download links must deliver an actual complete local package, with installed-client acceptance described separately.

## Recovery footer error handling

Keep the existing recovery text and title in the canvas footer, with errors overriding the project-download indicator. Save progress must not disturb a focused field, caret, selected tool or artwork. Bind the display to the active document's controller and retain background editing while saving. A local-copy notification failure does not become a storage-failure badge; an unavailable storage capability is disclosed through Recent files while ordinary editing remains usable.

## Recent files and resource search

Add a compact Recent files control beside Open, with a local-copy status indicator and descriptive tooltip. The control owns its subscription so background copy status does not rerender the editor. Use the custom Recent files modal with clearly labeled original filename, kind, bytes and saved time; Open local copy, Remove, Reload and Clear local copies are explicit actions. Explain local copies, retention, disk-change behavior and backups in ordinary language. Show actual loading/checking/updating/saving state; cancellation closes safely, errors retain the dialog, and unreadable entries stay visible with opening disabled. Removing copies does not close documents or affect original files.

Command search groups actual open sessions and recent copies under Open documents and Recent files, with useful details. Keep selection by stable resource ID when async results change. If the chosen item disappears, show that fact and require deliberate navigation before Enter; do not silently choose another file. Existing focus restoration, native modal controls, typing suppression and shortcut capture apply. The new static Recent files action has no default chord.

## Workspace layout interaction

Successful background workspace recovery preserves unrelated startup warnings. A corrupt-layout notification remains available until dismissed or a subsequent explicit action succeeds; dismissal leaves the invalid saved value intact and the layout dialog still requires explicit repair.

Use the custom Workspace layout modal from the rail and command search. Draft changes apply only through Apply layout or save/update. Give Layers/history and Properties independent Show, left/right dock and precise width controls; support responsive defaults and explicit same-side ordering. Saved layouts have a named selector plus save-as-new, update, rename and delete actions. Explain that save/update also applies and deletion leaves the current arrangement intact. Restore default arrangement selects a draft until Apply; command search also offers direct recovery. The rail remains visible when both docks are hidden. Keep errors within the modal, preserve the draft on rejected writes, and provide explicit Reload saved layouts for detected external changes. Restore focus on dismissal and use actual DOM order matching visual order. Retain native splitter pointer/Escape/keyboard behavior with direction appropriate to each dock side.

## AVIF export controls

Use the existing Export dialog and custom Batch variant form. AVIF offers a Lossless checkbox, 1–100% colour quality when lossy, and Fast/Balanced/Smaller file compression (8/6/4). Explain always-lossless transparency and quality 100's lossless colour behavior. Retain native dimensions, capability disclosure, actual rendering/indeterminate encoding progress, Cancel and retry. Controls use the existing custom Select/Slider/checkbox fields and disabled/busy states; no new component library or keyboard binding. Batch format controls have an accessible name.

## Paragraph style controls

For selected text, add a Paragraph styles Inspector section using existing Select/TextInput/Button/InspectorSection controls. The style selector chooses a library entry without editing; Apply paragraph style performs the edit. Show the current linked name and an explicit local-override count/key list. Provide Reset style overrides and Detach paragraph style for linked text. A chosen library entry can be renamed, deleted or updated from the current text without requiring temporary application. New paragraph style name plus Create style from text captures and links in one transaction. Keep text content/frame width independent and explain that base edits affect linked text while local formatting remains an override. Reuse existing busy/lock/error handling; add no global shortcut or component library.

## Bilateral denoise controls

Add Bilateral denoise to Smart filters. Reuse stack cards, enable/order/remove actions and existing paired controls: Denoise radius (integer 0–16 px), Color tolerance (0–255) and Denoise strength (0–1). Number fields allow fractional tolerance/strength and reject fractional radius. Preserve transient pointer/key previews, Escape cancellation, single committed undo and existing disabled/stale-target rules. Explain that smoothing retains strong color edges while larger settings can soften detail and transparency stays intact. No new shortcut/dialog/component library is introduced.

## Median denoise controls

Expose Median denoise in the existing Smart filters type selector. Use the same stack cards, enabled checkbox, ordering/removal buttons and paired slider/number controls. Denoise radius is labeled in px, integer 0–32; exact fields reject fractions. Pointer/key gestures preview transiently, Escape cancels, and release commits one undo. Retain the normal disabled/locked/stale-target rules. Explain briefly that the filter removes isolated speckles, larger radii can soften fine detail and transparency stays intact. No new shortcut or separate dialog is needed.

## Native frequency preview and shared-radius interactions

Use the custom modal with two native-pixel panes: Color and tone, and Fine detail. Separation radius pairs a slider/exact input. Show original is an explicit pressed-state comparison, using retained pixels. Pan either pane by dragging or focused arrow keys; Shift moves 10 pixels. Explain neutral source bands and retained final-layer appearance. Report the rendered radius/coordinates, show genuine capture/preview/commit state, and keep Cancel/close/Escape available. Prevent stale frames from replacing newer choices. Keep commit errors visible after preparation settles; allow retry of the same current capture and setting without changing the document first. Keep the panes readable/scrollable in short or narrow windows.

A selected band or retouch layer exposes Frequency separation group controls in Properties. Shared separation radius changes the controlling group in one undo, with transient preview/Escape and normal group/ancestor locks. The correction child remains protected. Hide individual sigma fields while a group controls them; explain the shared scope. Existing projects without a controller retain per-band controls. Add no rail tool/default shortcut or component library.

## Frequency separation — workflow in verification

Expose Frequency separation… through command search and the raster canvas menu. Reuse the custom Dialog, paired Separation radius slider/exact input, clear Create/Cancel actions, real preparation status and inline errors. Radius is in original image pixels. Cancel/close/Escape abort private preparation. Explain the retained hidden original, two editable retouch bands, alpha mask and protected precision layer. Select the composition instance after creation so existing Edit contents/Apply to source are immediately available. Add no rail tool or default shortcut. Smart-filter cards distinguish native composition, frequency band and post-placement document tone; disallow reordering document tone before native filters. Native preview and coupled controls follow the interaction contract above.

## Red-eye correction interaction

Reuse the existing adjustment inspector and command/context creation surfaces; add no rail tool or default shortcut. New Red Eye adjustment requires a pupil selection, with a useful error if absent. Capture an editable mask, preserving the selection geometry under transformed parents. Pair Red excess threshold and Correction strength sliders with exact numeric entry. Preview gestures cancel with Escape; commits create one undo entry. Reset retains the mask. Respect busy/ancestor locks. Explain that the mask isolates pupils and the operation corrects red-dominant pixels rather than detecting eyes.

## Wet mask controls — implementation in verification

Expose ordinary Mask Hide/Reveal and Filter mask Hide/Reveal in the existing Paint target selector for Smudge/Mixer. Use Initial coverage load for mask targets, retain Initial foreground load for layer pixels, and hide irrelevant foreground RGB controls while editing coverage. Explain that Hide/Reveal sets the initially loaded coverage and mask-wide settings remain separate. Keep the existing sliders/exact inputs, pressure/tip/texture/symmetry/preset controls and footprint cursors. Prefixes show actual private native coverage; Escape cancels and pointer release commits one mask history entry. No new shortcut or component library. Pending selection preference effects must not cancel a current gesture deliberately started after that selection changed.


## Wet tool interaction — in verification

Smudge and Mixer brush use the existing rail, searchable/customizable registry actions, brush controls, black/white footprint cursors, symmetry guides and preset dialog. No default keyboard chord is added. Each tool remembers its size; each mode retains independent Initial foreground load, Wetness and Pickup controls in percentages. Pair sliders with exact number entry. Use normal tool opacity/flow/dynamics and foreground color. Keep layer and mask targets explicit in the options row; never silently redirect a selected mask. Preview actual native output, keep one undo entry at release, and cancel the gesture with Escape or pointer cancellation. Tool preferences and saved presets remain outside document undo.


Prepared wet paint may extend ink beyond an original raster. Selection outlines and corner handles use expanded ink bounds; resizing scales the logical source plane and keeps the opposite visual corner fixed. Original source dimensions/bytes and ordered operations remain unchanged. Preserve live preview, Escape cancellation and one undo entry. This is existing Move-tool behavior for prepared content, not a new mixer/smudge tool surface.

Pen control rendering retains all authored anchors and handles, their screen dimensions and original overlapping-marker order. Internal React blocks may skip unchanged controls during a drag; they must not hide, cluster or cap geometry. Edits across block boundaries and the final partial block must preserve live preview, Escape cancellation and one-step undo for artwork and masks.

Typography uses the existing native Select for Kerning (Auto/Normal/None) and paired Slider/number input for Word spacing (-50…500 px). Keep these independent of Tracking; all previews support Escape and commits support undo. Disable mutations under busy/ancestor-lock state. Feature-detect native Canvas support, disable unavailable controls and explain the current limitation. Keep Reset spacing available to restore tracking/word spacing 0 and kerning Auto atomically, including for projects carrying unsupported settings. No new keyboard shortcut or component library is introduced.

Use **Canoli Studio** as the product wordmark, retaining the existing abstract mark and semantic color tokens. The editor header uses a compact, single-line wordmark; developer documentation and sharing previews use the same spelling and capitalization.

At widths up to 1500 CSS pixels, the header uses compact action icons with accessible names and hover titles. The document-name input stays visible; the action row scrolls horizontally when the controls exceed the remaining width.

## AVIF import interaction

Use the custom Dialog/Button and native checkbox controls. Show primary-image display dimensions, precision, color identification, alpha, encoded extent when different, warnings and unsupported reasons. Precision conversion and unidentified-color fallback are separate unchecked choices, reset for every file/recent-file review. Disable Import until required choices are explicit; identified native color takes precedence, and HDR failure stays visible with retry/Cancel. Keep original-byte retention and 8-bit editing limits clear. Progress/Cancel/close/Escape remain available during private work. Success retains edited tabs; failure/cancellation publishes no prepared artwork. Brush-texture review reuses these controls before Use AVIF image as texture; Apply stays disabled while review is pending.

## TIFF import interaction

Reuse the custom Dialog, Select and Button controls for local TIFF preflight. Show filename, page count/choice, oriented pixel dimensions, sample precision, unsupported reasons and conversion warnings. A 16-bit page requires an explicit unchecked precision-loss checkbox; reset consent when changing pages and disable import for unsupported pages. Keep progress/status and Cancel/close/Escape available during native work. No partial document is shown on failure; explain the error inside the dialog and allow retry. Existing edited tabs remain open after successful import. Do not imply reconstructed TIFF layers, higher precision editing or verified print color.

## PDF export interaction

PDF export reuses the existing format selector/report and custom NumberField for physical DPI (default 72), with an inches preview and explicit unchanged native pixels. Keep the field disabled while exporting and preserve progress/Cancel/close/Escape. Invalid physical-page geometry belongs in the capability warnings so changing DPI remains possible. Explain rasterization, unsearchable text and absent PDF/X/CMYK/prepress; do not imply a print-ready certificate or present codec/object details in the user flow.

## Direction

A quiet digital studio for artists and designers: professional, modern, precise, and visually distinct. Dark mineral surfaces support image assessment; warm paper and muted organic colors give examples an editorial quality. Citron marks actions, selection, and focus. Artwork is the primary visual content.

The founder explicitly ruled out shadcn. This is a custom system built with semantic CSS tokens and small React components. There is no shadcn/Radix/Tailwind dependency or borrowed component theme. Lucide supplies neutral SVG icons; it does not determine component styling.

## Foundations

Source: `src/ui/tokens.css`. Use semantic variables for new components instead of choosing independent palettes.

| Role               | Token                    | Value / intent                       |
| ------------------ | ------------------------ | ------------------------------------ |
| Application chrome | `--color-app`            | `#181c1b`, warm charcoal             |
| Panels             | `--color-panel`          | `#202523`, mineral charcoal          |
| Raised surfaces    | `--color-panel-raised`   | `#292f2c`                            |
| Canvas surround    | `--color-canvas`         | `#333934`, subdued studio green      |
| Primary text       | `--color-text`           | `#e7e9df`, paper white               |
| Secondary text     | `--color-text-secondary` | `#a5ada0`                            |
| Accent / focus     | `--color-accent`         | `#d5e79b`, citron                    |
| Accent text        | `--color-on-accent`      | `#202d17`, dark green                |
| Selection          | `--color-selected`       | `#364337`, plus citron edge          |
| Error              | `--color-danger`         | `#f5aea0`, with message/icon context |

- **UI typography:** self-hosted Manrope variable. It has a clear geometric character while remaining usable at editor density.
- **Technical values:** self-hosted DM Mono for dimensions, shortcut labels, and numerical status. Avoid monospacing general prose.
- **Scale:** 10/11/12/13/16/23 px; dense metadata is auxiliary, never the sole explanation of a critical action. Revisit density with user testing.
- **Spacing:** a 4 px base with 8/12/16/20/24/32 px steps.
- **Corners:** 4 px small controls (`--radius-sm`), 7 px standard controls (`--radius-md` / `--radius-control`), 12 px floating surfaces (`--radius-lg`), 18 px dialogs (`--radius-dialog`).
- **Icons:** normally 14–19 px, 1.7 px strokes; standalone icons require accessible labels and tooltips.
- **Tool rail:** an 88 px rail uses two columns of 32 px buttons with 4 px gaps. Tools and file/extension actions share the upper grid; studio utilities use a matching grid at the bottom. Keep all actions visible at laptop height, with vertical scrolling for shorter windows. Quick Selection uses the dashed selection-and-pointer mark, Spot Healing the bandage, and Patch a dashed outline; Brush and Magic wand retain their own marks.
- **Motion:** brief state transitions only; respect reduced-motion preferences.

## Components and rules

Implemented controls are in `src/ui/controls.tsx`; styles are in `src/ui/styles.css`.

| Component                 | Rules                                                                                                                       |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Button                    | Citron for the primary action; quiet text/surface for secondary actions; danger for destructive. Real actions only.         |
| IconButton                | Consistent target size, title, accessible name, visible keyboard focus, and disabled state.                                 |
| NumberField               | Labeled numerical entry, bounded validation, commit on blur/Enter.                                                          |
| TextInput / Input         | Labeled input entry, draft editing, optional unit suffix, commit on blur/Enter, Escape to revert, inline/stacked layout.    |
| TextArea                  | Multiline text input, accessible label, auto-commit on blur.                                                                |
| Select                    | Accessible dropdown with option values and labels, inline or stacked layout, semantic border/focus tokens.                  |
| ColorField                | Color swatch beside label, native color picker integration, accessible color names.                                         |
| SegmentedControl          | Grouped toggle buttons with accessible role, pressed state, and keyboard navigation for mutually exclusive choices.         |
| Slider                    | Labeled track beside exact numeric entry; shared bounds/units, live preview, one commit per gesture, keyboard support.      |
| Layer row                 | Thumbnail/type, name, selection edge, visibility, lock state, nesting. Meaning must not depend on color alone.              |
| Inspector section         | Short heading, grouped related controls, subtle separator.                                                                  |
| Floating viewport control | Compact surface for zoom and fit, separated from document content.                                                          |
| Dialogs                   | Unified structure: `dialog-heading` (caption + h2 + close `IconButton`), editorial subtitle, content, and action `Button`s. |
| Shortcut dialog           | Registry-backed key labels, keyboard focus containment, Escape to dismiss, return focus to trigger.                         |
| Feedback                  | Nonblocking status for success; actionable, dismissible errors. Do not hide failures behind optimistic success messages.    |

## Composition

- Top: identity, document title, history controls, and file actions.
- Left rail: tools with keyboard access.
- Left panel: document hierarchy/history.
- Center: the largest possible uninterrupted editing surface.
- Right panel: contextual properties; expose only supported behavior.
- Bottom: honest local-save and rendering status.

Use subtle borders for persistent chrome and shadows for floating surfaces and the document. Avoid decorative gradients in controls, excessive card stacks, marketing-style illustrations in editing flows, and disabled placeholder tools that imply functionality exists.

## Accessibility and interaction

- All controls have accessible names; native inputs and buttons provide baseline keyboard behavior.
- Visible focus rings use the accent token; do not remove focus without a replacement.
- Text entry keeps its native editing shortcuts. Application shortcuts apply outside editable elements.
- Active tool/selection state is indicated by shape/border and accessible state where applicable, not only hue.
- Dialogs contain keyboard focus and restore it on close.
- This milestone is for desktop browsers; responsive side-panel compression is provided, not a claimed mobile editing experience.
- Contrast should be measured when adding/changing tokens. Do not claim formal WCAG conformance without a complete audit.

## Future extensions

Add component variants and semantic tokens before one-off styling. New masks, timeline, AI review, command search, or batch controls should inherit the same spacing, typography, surface hierarchy, focus behavior, and restrained accent use. User themes and high-contrast mode are future decisions; light/dark/system appearance is implemented below.

## Drawing and style controls

The rail uses the same square tool controls and pressed states for brush, pencil, pen, marquee and clone. A contextual row above the canvas exposes numeric settings, foreground color, selection mode and concise gesture hints. Keyboard shortcuts stay discoverable in help. Artwork cursors and anchor handles scale to readable screen sizes independently of zoom. Marquee component outlines indicate regions; subtract regions use coral.

Layer drag insertion lines show front/back placement; a highlighted group center indicates nesting. Root placement has a labeled drop target. Inspector sections use the established numeric fields, native color pickers and sliders. Blend If uses two tonal tracks, each with four labeled, keyboard-operable endpoints plus exact numeric values: top cutoffs and lower feather handles. Disabled/locked state applies to tool and style controls. Developer docs use the same charcoal/citron palette with readable prose, code and horizontally scrollable tables.

The Plugins dialog uses the same card surfaces and controls. Package review presents identity, version, requested document access and expandable source before explicit installation. Installed commands have a named Run action, output/error feedback and Stop while running; package management stays separate from document undo.

## Paired numeric adjustments

Use the reusable `Slider` in `src/ui/controls.tsx` for every bounded scalar tool parameter. Its track sits beside a `NumberField`; both share the current value, bounds, units and disabled state. Brush/pencil/clone diameter and opacity, brush/clone hardness, pen width, path stroke width, layer/fill opacity, tone adjustments and shadow/overlay parameters use this component. Marquee modes, color controls and checkboxes remain controls appropriate to their values; unrestricted layout coordinates/dimensions retain numeric entry without inventing arbitrary slider ranges.

The component takes `label`, `value`, `min`, `max`, optional `step`, `suffix`, `scale`, `disabled`, and `onPreview`/`onCommit` callbacks. Use the default linear scale for percentages/signed adjustments. `scale="quadratic"` allocates more track space to small brush/pen widths while preserving the full supported range. Screen-reader values describe actual units, never the internal track position.

Pointer movement previews; release commits once. Arrow keys use one configured step; Page Up/Down use ten; Home/End select the endpoints. Escape or pointer cancellation restores the value at gesture start. Focus loss cancels an active drag. Numeric entry accepts finite values within bounds, including precise fractional values, and commits on Enter/blur; invalid/empty drafts revert, and Escape discards the draft. Tool-setting updates do not create document history. Inspector changes preserve one undo entry per gesture. A blur following pointer release must not create a second commit.

Keep the track and input side by side at all supported desktop widths; the tool bar wraps groups instead of squeezing tracks or hiding adjustments offscreen. New tools with bounded numerical parameters must use this control. Preserve the custom tokens and native accessible input semantics.

## Input and control library

### Syntax highlighting

`src/ui/SyntaxHighlighter.tsx` provides `<SyntaxHighlighter code={source} language="js" />` for read-only code examples. Optional `label` overrides the visible language label and accessible name; `className` styles the wrapper. Load `src/ui/SyntaxHighlighter.css` alongside the shared tokens when using it in another surface.

Supported grammars are JavaScript (`js`), TypeScript (`ts`), JSON, shell (`sh`, `shell`, `bash`) and HTTP. Missing/unknown languages render escaped plain text without auto-detection. Source is never evaluated; Highlight.js escapes highlighted source and React escapes the plain-text fallback. Preserve source whitespace and text selection; do not add line numbers to copied text. Each block has a language header and a focusable, horizontally scrolling `pre` with a visible focus ring.

Syntax colors use semantic `--color-code-*` tokens: lavender keywords, citron strings, warm numbers, teal functions and pale blue properties. Comments use secondary text. The documentation build renders this same React component to static HTML for every fenced code block in the scripting, REST and plugin guides. Highlighting works with JavaScript disabled, uses no CDN, and adds no highlighter code to the editor bundle.

Reusable design system controls reside in `src/ui/controls.tsx` and consume variables from `src/ui/tokens.css`:

- **`Button`:** Citron for primary actions (`variant="primary"`), quiet surface for secondary/subtle actions (`variant="subtle"`), and coral for destructive actions (`variant="danger"`). Supports optional `size="sm"` for dense contexts.
- **`IconButton`:** Square icon trigger (`30×30 px`, or `20×20 px` inside headings). Requires accessible `label` used for both tooltip `title` and `aria-label`.
- **`NumberField`:** Numerical entry control supporting `min`, `max`, `step`, optional unit `suffix`, `id`, `className`, `placeholder`, `autoFocus`, `onChange`, and `layout="inline" | "stacked"`. Draft values synchronize during render and commit on `Enter` or `blur`; pressing `Escape` cancels the draft. Used for dimensional and scalar inputs (canvas bounds, font size, layer dimensions).
- **`TextInput` / `Input`:** Labeled text/numerical entry control supporting `label`, `value`, optional unit `suffix`, `type`, `id`, `min`, `max`, `step`, `maxLength`, `placeholder`, and `layout="inline" | "stacked"`. Commits on `Enter` or `blur`; pressing `Escape` reverts to the original value without committing. Synchronizes with external value updates during render.
- **`TextArea`:** Multi-line text entry for content properties and code snippets.
- **`Select`:** Dropdown selector with consistent styling using `--color-border` and `--color-field`. Supports typed options (`{ value, label, disabled? }` or strings), accessible labeling, and `layout="inline" | "stacked"`.
- **`ColorField`:** Color swatch integrated with native color picker, label, and accessible color readout.
- **`SegmentedControl`:** Segmented button group for mutually exclusive options (e.g. text alignment). Employs `role="group"` with `aria-pressed` states on underlying icon buttons.

## Appearance preferences

The editor uses `AppearanceToggle`, a single sun/moon icon at the bottom of the tool rail. Clicking switches to the opposite resolved theme and saves an explicit preference. Its icon and accessible name describe the next action. Right-click, Arrow Down, or Shift+F10 opens a small appearance popover containing `AppearanceSelect`, including System mode; Escape closes it and returns focus. Developer docs retain the labeled selector. Both surfaces share Light / Dark / System modes. System is the initial default. `public/appearance.js` runs synchronously in the page head before styles or React, resolves the preference to `html[data-theme]`, and sets the native control color scheme. It stores a validated choice under `luma.appearance.v1`, synchronizes same-origin tabs via storage events, and follows live OS changes only in System mode. If storage is blocked, the current page still responds. Static docs without JavaScript follow the OS through CSS; their manual selector remains disabled.

Both palettes use semantic tokens in `src/ui/tokens.css`, including separate light syntax colors. Light mode uses warm paper surfaces, dark mineral text, and a darker green accent. Use tokens for UI chrome rather than fixed dark colors. The canvas surround, checkerboard, selection overlays and tonal reference ramps stay consistent between themes. Document backgrounds, actual artwork, exports, and undo history are independent of this preference. Custom themes and a separate canvas-surround preference remain future work.

## Planned intelligence and generation UX — not implemented

Future A01/A02 asset intelligence belongs in a contextual Asset info inspector, not permanent rail buttons for every metadata operation. Visually distinguish embedded declarations, computed values, model suggestions and user-authored corrections with text labels, not color alone. Support per-field accept/edit/reject, keyboard traversal, unknown values and disclosure of analysis input scope.

Future A03 generation opens a focused prompt/reference panel with target bounds, output type, preview and cost/transfer disclosure. Candidates appear in a collapsible shelf; completed jobs must not steal focus or automatically replace the artwork. Accepting a candidate is one undoable insertion. The job indicator remains compact until expanded and provides meaningful progress, cancellation and recoverable errors. Do not use fabricated percentage progress for a provider that only reports queued/running states.

Future protected-edit review shows before/after and changed-region overlays, plus clearly labeled protected regions; all are optional inspection views, never baked into export. Recipe/batch review presents per-image state and exceptions before bulk acceptance. Manual tools and exact controls remain available alongside AI suggestions. Use the existing light/dark tokens, focus rules, paired numerical controls and constructor-backed action model. See [AI_FEATURE_SPECS.md](AI_FEATURE_SPECS.md) for behavior and [FEATURE_STRATEGY.md](FEATURE_STRATEGY.md) for scope.

## Local recovery

The rail’s Recover work action opens a native dialog listing local checkpoints by document and time. Restore opens an editable copy; Download current project supplies an external backup. Removing an inactive checkpoint requires a second confirm action. The footer reports actual pending/saving/saved/error recovery states and exposes the full message as a tooltip. Keep recovery separate from external file-save status and never describe browser storage as a backup.

## Asset info inspector

Raster Properties now includes an expandable Asset info section. File facts and file declarations have explicit origin labels; private fields are labeled. Extraction is asynchronous and local, with pending/error messages. Sidecar export shows separate attribution and private-field checkboxes. The inspector is read-only in this slice; accepting/editing AI suggestions remains planned. Metadata text must stay inert and wrap without widening the inspector.

### Authored metadata controls

Asset info separates editable **Authored description** fields from read-only **Original file declarations** using headings and explanatory text. Use existing stacked text inputs/text areas, disabled when the layer or an ancestor is locked. Keyword entry is comma-separated. Clear authored metadata is an undoable action. Sidecar attribution and private-field checkboxes explicitly govern both authored and extracted values; private authored descriptions remain excluded by default. Review/accept/reject UI is still planned.

### Layer mask controls

Use a contextual Layer mask section in Properties for the selected layer/group. Create/replace from selection is disabled without a nonempty marquee; reveal-all remains available. Enable and invert use labeled checkboxes. Density uses the shared slider with adjacent exact percentage input and one undo entry per committed gesture. Removal reveals retained source content and is undoable. Locked layers/ancestors disable all mutations. Creation and toggles remain keyboard accessible without adding global shortcuts that compete with existing tools.

For Bézier masks, offer a labeled **Mask path source** selector of vector layers containing only closed paths and a create/replace action. Explain that paths are copied and later source edits do not change the mask. Label the active mask type and offer a fill-rule selector for vector masks. Never auto-hide or mutate the source layer during capture; the user controls source visibility.

Mask feather uses the same paired slider/number control as density, labeled in document pixels (0–128, slider step 0.1; exact input supports fractions). Commit one history entry per gesture and honor mask/layer locks. Rendering errors at extreme zoom/radius combinations must explain the working-buffer limit and leave original content intact.

Layer mask position uses exact **Mask X/Y** number fields, following existing layer-position controls. These are coordinate origins, not shape bounds. A labeled **Link mask to layer** checkbox preserves visible mask position on toggle. Explain whether the mask moves with its layer or remains fixed on the canvas; disable all mutations for locked layers/ancestors. Do not treat a raw flag change as a position-preserving toggle.

The Move tool’s labeled **Move target** selector distinguishes Layer from Mask, with Mask offered only when the selected layer has a mask. A short instruction explains dragging and arrow-key nudging in mask mode. Hide layer bounds/resize handles in mask mode so they do not imply a layer transform. Exact Mask X/Y fields continue to show the live preview.

Uniform painted masks use an explicit creation/replacement button in Layer mask properties. Every selected mask, including selection/Bézier masks, exposes the Brush/Pencil **Paint target** selector with labels Layer, Mask · Hide and Mask · Reveal. Mask painting uses existing paired adjustment controls; stroke color does not affect coverage. Changing the selected layer or mask kind resets the paint target to Layer. The mask kind caption directs users to Brush/Pencil. Replacing mask geometry is an ordinary undoable action.

The Pen tool offers **Pen target: Layer paths / Mask paths** when a Bézier mask is selected. Mask mode hides stroke/fill creation controls, displays mask contour outlines and highlights the selected anchor. Anchor/handle sizes and hit tolerance stay constant in screen pixels; coordinates include mask linking and parent translation. Inline instructions explain dragging, Alt/Option, nudging and deletion. Selecting another layer/document or changing the mask kind resets the pen target to Layer paths.

In Pen → Mask paths, Insert midpoint stays beside the tool options and is disabled until an anchor is selected. It splits the selected anchor’s outgoing segment, including the closing segment, and selects the inserted anchor for subsequent edits. For placement along a curve, users can click a nearby contour directly. Existing anchors and handles take priority; the click previews a newly selected anchor, and release inserts it without altering the curve. Escape discards it. The footer explains this interaction without adding another mode or toolbar button.

Mask contour creation uses explicit New contour / Close contour / Cancel contour controls. Their button group keeps the same width while drawing, with compact instructions in the existing hint row, preventing canvas movement as mode changes. The draft contour has a dashed outline, while existing contours keep solid outlines. Empty-mask creation explains that artwork is hidden until an outline is drawn; no vector source layer is required. Escape discards the entire draft, Enter closes it, and Delete removes the last draft anchor. No global shortcut is added.

Crop canvas uses the custom Crop icon in the rail and the C shortcut to enter frame editing. Precise bounds opens a dialog reusing numeric fields, dialog focus handling, and primary/subtle buttons for Apply/Cancel. Four pixel fields define the frame; a single rectangular marquee provides an optional starting frame. Supporting copy explains retained off-canvas artwork and outside-canvas bounds. Apply is disabled for invalid or unchanged bounds; stale-document errors remain inside the dialog. Escape in a numeric draft restores that field; Escape outside the field closes the dialog. Crop is a document action and remains available with locked layers.

On-canvas crop frames use a white border with a dark outline, a subtle thirds grid, an absolute-positioned dimensions label, and eight focusable handle buttons that stay the same size on screen. A noninteractive SVG shade dims the excluded current-canvas area without changing rendered artwork. New frame, Precise bounds, Apply crop and Cancel crop stay in the options bar with stable labels, so drawing a frame does not move the canvas. Handle cursors communicate resize direction; handles support arrows and Shift+arrows as well as pointer dragging. The Crop tool suppresses the unrelated Fill selection button, and its Delete shortcut is labeled Clear crop frame.

The command palette is a compact native modal using the existing surface, accent, focus and text tokens in both color modes. Its search field is an accessible combobox controlling a scrollable listbox; rows show a category, command label and shortcut hint. A single outlined active row follows keyboard navigation. Unavailable rows stay discoverable with disabled semantics. Empty queries show available registry actions; unmatched queries show an explicit empty state. No separate component framework is introduced.

The Layers panel provides a compact search field with native type, visibility and lock-state selectors, styled with existing semantic field/border/text tokens. Active filters show a live match count and Clear filters. Ancestor context rows retain the tree indentation with muted names. The panel explicitly identifies an active layer outside the filter rather than silently changing selection. Group disclosure is temporarily disabled while results are expanded; clearing filters restores the prior disclosure state.

Multiple selected layer rows use the existing selected state, with a count and alignment selector in the panel. A union outline represents the set on canvas; resize handles remain reserved for a single resizable layer until group-transform behavior is implemented. Ctrl/Cmd/Shift-click toggles membership. Active-layer inspector fields remain a single-target surface, separate from explicit multi-layer movement/alignment/deletion actions.

The Recovery storage diagnostics section uses existing text/border tokens, a two-column definition list with tabular numeric values, wrapping secondary action buttons, and live status text. Estimates and persistence status remain separate from checkpoint save status; API failures do not disable the rest of Recovery.

For a single selected raster, the Layers panel offers a labeled **Convert to smart object** button using the existing Button component. Disable it while busy, with multiple selection or locked ancestry. The resulting selected instance uses the component badge. Conversion errors use the panel's existing action error reporting; no new global shortcut is assigned.

For one selected smart object, the Layers panel offers **New smart object via copy** using the existing Button component and action-error handling. It is disabled while busy, with multiple selection, or when the layer/ancestor is locked. Ordinary Duplicate remains available for shared instances. Both actions select their new instance; the independent action does not introduce a new global shortcut.

A selected smart object offers **Edit contents** in Layers. Its editing tab uses normal tools and a compact wrapping banner above the canvas toolbar, styled with existing panel/border tokens. The banner names the source composition, distinguishes pending/applied edits, and exposes **Apply to source** and **Keep as document**. Disable apply without changes or after source closure. Errors use the standard application error display and leave the tab intact. No new global shortcuts or automatic commits are introduced.

A selected smart object exposes a collapsible **Smart filters** section in Properties. Use a labeled Filter type selector and Add filter button, followed by numbered cards in execution order. Each card has an Enabled checkbox and accessible earlier/later/remove icon buttons; first/last movement controls disable at their respective boundaries. Gaussian blur exposes Blur size; unsharp mask exposes Sharpen size, Amount and Threshold; tone exposes Exposure, Contrast and Saturation. Every numeric control uses the existing paired Slider/exact NumberField, with quadratic size sliders for useful small-radius precision. Size fields map to Gaussian sigma in master pixels and follow instance scaling. Use existing panel, border, text and accent tokens in both color modes; no additional component framework or global shortcut is introduced.

Slider changes preview without adding history and commit once per gesture. Escape restores the pre-gesture value. Keyboard commits retain focus, allowing repeated arrow adjustments. Exact inputs commit on Enter/blur and restore invalid drafts. Disabled filters retain their values while disabling numeric adjustments; locked ancestry, busy state or unavailable WASM disables all mutations. The 32-entry stack limit disables adding. Selection/session changes cancel transient previews; external document edits cannot commit an older slider draft. All committed actions use smart-filter constructors and the shared command/history path. Filter masks remain a separate unfinished control surface.

### Filter mask Inspector

Use a separate Filter mask section beside Smart filters and Layer mask. Explain white/black coverage in artwork terms. Group reveal/hide presets, provide selection capture, and show whether geometry follows artwork or stays fixed on the canvas. Use existing checkboxes, paired Slider/number inputs for density and feather, and a quiet removal action. Disable editing for locked/busy targets; disabled masks keep enable/remove controls available. Live previews cancel on Escape and target changes and commit once per gesture. Both themes use existing semantic tokens.

The Filter mask section includes a Follow artwork checkbox. Changing it preserves current mask placement and switches future movement behavior. Keep this control available for disabled masks so placement can be prepared without applying the filter, while respecting layer locks and busy state.

Paint target offers Filter mask · Hide/Reveal only when the selected smart object has a filter mask. Keep ordinary Mask · Hide/Reveal choices distinct. Reuse brush/pencil/eraser controls and paired sliders; do not introduce duplicate shortcut bindings.

Layers → Convert to smart object applies to the current selection, including text, vectors, groups and multiple contiguous siblings. It disables for locked selected ancestry and reports validation errors for incompatible selections through the existing error surface. The result becomes the selected instance; Edit contents exposes the retained editable layers. No new keyboard binding is introduced.

Layers → Rasterize smart object appears for one selected smart instance, disables for locked ancestry or a busy operation, and runs through the standard asynchronous task/error surface. Successful rasterization selects the replacement raster. Outer masks, opacity, blend and styles remain editable; contents and filters become pixels. Undo restores the editable instance.

For one selected smart object, Layers offers Link image file or Relink image file through the native file chooser. The selected target is captured when the chooser opens. Linked sources display their filename and an explicit saved-snapshot/choose-file-to-refresh status. Embed source snapshot removes the link while retaining pixels, and enables editable contents. Refresh is explicit; the UI must not imply background watching or verified current file availability.

Asset display filenames retain their complete string through import, copying and project persistence. Linked-source labels ellipsize long names and expose the full name in their title; saved-snapshot status stays separate. Layer-name and linked-source metadata validation remain independent of asset display names.

Layer comps use a collapsed-by-default Properties section with a count badge. Capture has a name and Visibility/Position/Appearance checkboxes; at least one category is required. Saved rows expose name, captured categories and Apply/Update/Remove controls. Update explicitly recaptures the current presentation and has an explanatory title. Missing layers show a warning before application and a live status afterward. All actions use shared constructor commands and existing error handling; keyboard focus and native Enter/Space behavior remain available.

Keyboard shortcuts use a scrollable row list with action name, active binding, Change/Clear/Reset controls and a global defaults action. Capture is focus-bound: Escape cancels it without closing the dialog; Tab or blur leaves capture. Conflict and persistence failures appear as an accessible alert. Empty bindings read “Unassigned.” Customized hints update in toolbar/layer buttons, context menus and command search. Escape and Space remain dedicated global interactions.

Side-panel resize handles occupy a 6-pixel divider, use the column-resize cursor and accent hover/focus feedback, and expose separator orientation/value labels to assistive technology. Keyboard and pointer resizing share bounds. Layers use a 190-pixel minimum, Properties 230, and both have a 480-pixel maximum; viewport constraints retain canvas room. Double-click resets to the responsive default.

The multi-selection controls include Distribute alongside Align. A select offers horizontal/vertical gaps and centers; it resets after each action and is disabled for fewer than three independent roots, locked selections or busy operations. Distribution cancels transient tools/previews before committing.

The Layers panel exposes one keyboard-accessible “Flip selected layers” select for any nonempty selection, with Horizontal and Vertical actions. It resets after execution and is disabled while busy or when a selected root or ancestor is locked. It cancels active tool previews before committing the shared command.

HSL appears in the adjustment-type selector as “Hue / Saturation / Lightness”. Hue, HSL saturation and Lightness use the shared Slider component with paired exact inputs, transient previews and one commit on release/entry. Hue displays degrees; saturation/lightness display percent. Reset retains HSL type and restores zero values. Locks and busy state disable edits.

Curves, Levels, Tone and HSL creation are searchable command-palette actions. They have no default shortcut chord, but can receive custom bindings through Keyboard shortcuts. The canvas context menu also exposes HSL directly. Creation uses the shared constructor, selects the new layer, generates an unused numbered name and adds one undo entry.

Typography retains a Font preset selector and adds a Font family text field for locally installed/custom family names. Enter or blur commits one edit; Escape discards the draft. The field follows shared text-input validation and disabled states. A failed local-font probe remains visible beside the controls. This does not request font enumeration, download fonts or embed font files.

### Raster selection controls

Magic wand lives in the tool rail (W). Its tolerance uses the shared paired slider/numeric input (0–255), alongside a Contiguous checkbox and the existing selection operation control. Imported-image and paint layers show rendered thumbnails over a subtle checkerboard. Ctrl/Cmd-click on either thumbnail loads transparency without changing the active layer; Ctrl/Cmd-click on the layer name retains multi-selection. Thumbnails refresh after committed edits, not on each live brush movement. For transparency loading, hidden layers and ancestors are treated as visible; its tooltip explains the gesture, and the command palette provides keyboard access. Pixel selections draw their actual coverage boundaries with the existing selection treatment. Copy/paste shortcuts remain native inside text fields.

Layer-style colors use the reusable `ColorInput`: native picker input previews at most once per animation frame, without creating undo entries. Native change (picker completion), blur or Enter commits once; Escape cancels the preview. Overlay and shadow colors use the same interaction. The control preserves a local draft while the canvas preview catches up.

### App-drawn canvas cursors

Canvas cursors use paired black and white outlines over artwork. Circular tools, including Eraser, show the current diameter multiplied by viewport zoom with a small center mark. Move, text, hand/grabbing, resize and rotation indicators communicate the active interaction; other precision tools use a crosshair. Cursor movement updates an independent overlay once per animation frame, without React state updates. Preserve the existing synchronous stationary-cursor refresh for real geometry/preferences; unrelated status renders keep the existing glyph without rereading layout. Panel fitting and keyboard resizing reserve the 88 px rail, both 6 px dividers and at least 200 px of canvas column at supported window widths. Leaving the viewport, touch input, pointer cancellation, context menus and lost focus hide the custom cursor and restore the native pointer. Buttons and text fields retain native cursors.

Users can restore system canvas cursors through the command palette (Use system canvas cursors); the reciprocal action restores custom cursors. This preference persists locally and does not affect document history. In system mode the size outline remains available, including for Eraser.

### Image size versus canvas size

Image size… is available in the options bar, command palette and Mod+Alt+I. It reuses the artboard dialog's paired pixel dimensions, aspect-ratio link, current-size summary, presets and Apply/Cancel controls, with a distinct Image size title and explanation that canvas and artwork scale together. The explanation also discloses unchanged pixel-based effect settings. Validation errors stay in the dialog without closing it. Canvas resizing retains its existing title and explicitly preserves artwork size and coordinates.

### Freeform lasso

The rail exposes Lasso (L) beside Marquee and Magic wand. The cursor is the precision crosshair. Dragging shows the traced contour plus its closing segment using the existing dashed selection treatment. Release commits an antialiased pixel selection. The shared selection-mode control and Shift/Alt modifiers match Marquee/Wand; the options hint explains all modifiers and Escape cancellation. Empty gestures preserve the current selection.

Export progress appears inside the dialog above its footer, using the existing text/accent tokens and a labelled native progress element. Known rendering progress is determinate; encoding or unknown totals are indeterminate. Cancel remains enabled while exporting and leaves the dialog available after cancellation settles. Closing or dismissing the dialog also cancels its export. Intentional cancellation does not display an error toast or trigger a download.

### Polygonal lasso

The Lasso options bar adds a native Freeform/Polygonal mode selector and a Finish selection button enabled after three corners. Polygon drafts reuse the dashed selection contour, with small accent-outlined corner markers and a larger first-corner marker identifying the closure target. The pointer segment is transient and frame-paced. The options hint explains click placement, first-corner/Enter completion, Backspace and Escape. Mode, Boolean-operation and finish controls remain available over locked artwork because they edit document selections. Use the existing command registry for Enter and Delete/Backspace; typing in fields keeps native behavior.

### Selection modification

Modify selection… appears beside other active-selection options; Expand selection…, Contract selection… and Feather selection… are searchable commands. The native modal uses the existing Dialog, NumberField, Select and button styles. It explains circular pixel radius, outside-canvas behavior and source preservation. Show a labelled native progress element and keep Cancel enabled while working; disable operation/radius/Apply until work settles. Errors stay in the modal. Escape or dismissal cancels the worker. Selection controls remain available over locked artwork; the resulting selection appears only after a successful atomic commit.

### Color Balance and Vibrance

Use the existing Adjustment section, type selector, Reset action and paired sliders. Color Balance has a local range selector (Midtones initially), three bipolar sliders labelled Cyan / Red, Magenta / Green and Yellow / Blue, and a Preserve luminosity checkbox. Range changes only choose which parameters are shown; they do not edit history. Vibrance presents Vibrance and Vibrance saturation separately, with a short explanation that less chromatic colors receive more change and that skin is not detected. New family actions are available in command search and the canvas adjustment menu, with no default keyboard chord. Disabled/locked states, pointer preview/commit and number-field typing follow existing controls.


Gradient map Inspector controls use a labeled dark-to-light color ramp, native color pickers, exact percentage position fields, per-stop removal, Add gradient stop, and reversal. Positions remain ordered; invalid/duplicate values cannot commit. Two stops are required and the documented adjustment budget is 32. Color picker input previews without history; completion commits once and Escape restores the prior value. Shared Reset restores black/white endpoints and forward mapping. Locked layers disable mutations. The existing scrolling Inspector contains long stop lists; color is accompanied by labeled controls, not used as the sole meaning of an action.


The PSD export section uses the shared Select for "Keep independent layers; merge dependent effects" versus "Flatten visible composition into one layer". Its capability report names the actual dependency merge and baked features before export. Cancel and progress use the existing dialog lifecycle; cancellation must produce no partial download. The PSD/PSB choices retain supported folders and user pixel masks; preflight discloses baked mask controls, group fill, non-Normal pixel fill and effects. Native Photoshop text/vector/adjustment/effect controls remain unsupported.


White Balance uses the shared paired Slider/number fields for Temperature (K) and Tint, with a short caption explaining correction direction and the neutral setting. Input previews without document history; commit adds one shared edit and Escape restores the prior value. Reset restores 6504 K and zero tint; locked layers disable controls. Creation/type switching follow the existing adjustment palette, context menu and Inspector patterns, without a new global shortcut.


Color Lookup (LUT) follows the shared adjustment palette/context/Inspector patterns. Show the imported title and table dimensions as inert text, Import/Export .cube actions, actual processing status/cancel/errors, a paired amount slider/number input and a 3D interpolation select (disabled for 1D). Invalid or stale imports leave the effect unchanged. Reset returns the identity table and remains undoable. File actions wrap within the Inspector; locked targets disable edits. Explain source-encoding expectations and that exported .cube tables do not bake layer amount/masks.


Color Range uses the custom Dialog, paired Fuzziness slider/input, source/Boolean/preview selectors, wrapped sample swatches and current status/errors. Keyboard coordinates and Sample pixel provide the same native sampling as clicking the preview. Label the display as a proxy; final application always samples native pixels. Included/excluded colors are editable locally; changes preview without history. Invert is explicitly limited to visible source pixels. Keep Cancel enabled during preparation and discard late results on close or stale revisions. Layout collapses to one column at narrow widths, and long sample lists scroll/wrap without hiding actions. There is no new global shortcut.


### Alpha channels

Use the collapsible Inspector section and existing TextInput/Select/Button controls. Show named saved channels, independent grayscale coverage preview, clear save/update/load actions, Boolean/invert options and wrapped management actions. White selects and black excludes; explain that the preview does not alter artwork. Preview stays bounded and hidden sections perform no preview work. Keep cancellation available during native loading, disable conflicting channel controls, surface actual errors/status and preserve keyboard editing. Document-level artwork locks do not disable channels. There is no new default key binding.


### Quick Selection brush

Use the rail's dashed selection-and-pointer mark with the Quick Selection label and Shift+W binding; W stays Magic wand. The canvas cursor shows native brush diameter. Frame-paced translucent seed marks are a draft, not a claimed grown mask. On release show real progress and an enabled Cancel Quick Selection action; Escape also cancels. Diameter/color/edge controls use paired sliders, with explicit source and Boolean mode controls. The hint tells users to paint inside the region and explains release/Alt/Escape. Preserve native editing keys, document-level operation over locked artwork, source appearance and one undo entry. Show real failures rather than a fabricated selection or success status.

### Select Subject progress and honest results

Toolbar, palette/shortcut and canvas-menu actions share Select Subject preparation. The custom progress dialog describes original-raster contrast sampling, shows actual progress and keeps Cancel Select Subject/Escape available. Cancellation suppresses late success. Empty, uniform, missing and non-raster sources show a useful failure while keeping prior selection/history. Successful marching ants represent real native coverage with source holes/transparency and full placement, rather than a bounding rectangle. Do not describe the local contrast heuristic as evaluated semantic detection or calibrated confidence.


### Refine Edge workspace

Keep the custom dialog's preview and native Apply distinct. Overlay/black/white/transparency/edge views use a separately scaled worker preview; they do not change history. Foreground/background/refine brushes store source-coordinate circular marks, with diameter, Undo mark and Clear marks. Empty previews keep source context and a useful foreground-painting hint. Apply stays disabled without actual foreground; processing errors stay visible. Native Apply reports real tile progress and keeps Cancel/Escape available. Suppress late results after dismissal/cancellation/document changes.

Decontamination requires a new layer with corrected colors and a matte, hiding the retained original. Automatically choose new-layer output when enabled and explain it in the control; mask-only output must not imply RGB correction. Keep original slider identifiers/accessibility, keyboard editing, and the custom dialog/control system. Describe the local estimator honestly without claiming evaluated hair/glass quality. Direct Remove Background uses the same real cancellable preparation dialog.


Refine Edge defaults to **Closed form (global)**; **Color line (local)** is an explicit solver choice. Report actual capture/solve/encoding progress and iteration counts, with Cancel/Escape available during global solving. Graph-memory or nonconvergence errors suggest adding known marks or explicitly choosing the local method; never silently switch algorithms or show success for an unconverged matte. Keep proxy/final distinction and unscored quality wording.


Smooth 10 means a subtle 10% blend of the color-guided smoothing result; small values must not abruptly apply a full blur. Global preconditioning stays an engine detail. Keep actual iteration/progress/error feedback and cancellation available on photographed inputs, and retain the explicit proxy/final-preview distinction. Numerical convergence and sample scores must not be presented as a semantic confidence score.


Design checks use a native modal with the custom heading, numeric fields, policy controls, severity labels and visible limitations. Findings show layer breadcrumbs and an explicit Select layer action; do not insert inferred fixes into the document. Keep a Cancel checks action enabled during work. Stale results are labeled and their download/navigation is disabled. A completed report with no findings says so only for enabled checks; never show a print-ready/AI-approved badge. The findings region is keyboard-scrollable and layout fits a narrow dialog without implying mobile editor support.

SVG capability previews distinguish editable vector masks from native-resolution PNG coverage tiles before export. Keep artwork vector editability separate from raster-mask scaling/editability; do not label the complete output infinitely scalable when it includes raster masks. Native mask preparation uses the existing determinate rendering progress and Cancel controls, followed by indeterminate vector encoding. Missing/changed mask sources surface as export errors, with no partial download.

For SVG raster images, distinguish source-resolution PNG pixels/editable placement from document-resolution images with baked tone/erasure operations. State metadata exclusion separately from pixel privacy: complete decoded source images can retain pixels hidden by masks or the canvas. Offer PNG for flattened delivery. Image and native-mask preparation share existing rendering progress/Cancel, followed by indeterminate SVG encoding; failed or stale preparation produces no download. Do not imply raster imagery or baked edits become infinitely scalable because the container is SVG.

SVG previews identify live text as editable and explain that fonts are referenced without embedding. State viewer substitution/shaping/hinting separately from text editability; offer PNG for rendered appearance. Pending or changed referenced fonts surface a retry-after-fonts-ready error through the existing export error flow. Measurement uses indeterminate rendering progress with the existing Cancel control, followed by image/native-mask progress where needed and indeterminate encoding. No new font permission prompt, upload or paid service belongs in this workflow.

SVG smart-object reports distinguish independently expanded editable master contents from native-rendered filtered pixels. Explain lost shared master links and baked filters/filter masks/off-support content before export. Keep outer mask/style editability separate from inner rendered content. Native preparation uses existing progress/Cancel/error controls; stale sources or fonts produce no download. Linked-image snapshots do not imply file watching or external refresh.

SVG capability previews identify preserved editable overlay/shadow filters and native backdrop-prefix editability loss. Explain viewer filter/rounding/working-memory limits without implying that generated SVG effects match every renderer byte-for-byte. Keep native mask coverage/scaling warnings and the existing progress/cancel workflow.


SVG paint previews distinguish editable dab/fill/eraser geometry from the original brush command settings, and native clone pixels from editable brush coverage. State the loss of off-support dabs, raster selection coverage, hidden clone pixels and dense/deep viewer limits before export. Use existing progress/Cancel/error controls; precision or source-lifetime failures produce no download. Do not imply that vector primitives preserve the original brush settings or guarantee native pixel identity. Projects retain the complete editing model.


SVG adjustment/Blend If reports list affected sibling-stack endings and distinguish native rendered appearance from editable internal objects/settings. Later artwork and outer parent settings remain separate. Use existing rendering progress, Cancel and retryable errors; stale native sources/fonts return no download. Do not label prefix pixels as editable adjustment graphs or infinitely scalable artwork. Saving a project retains the full editing model.


### SVG import preflight

Import image and canvas drop accept SVG and open the custom Import SVG dialog. Show the file, resolved viewport, editable capabilities, unsupported findings and conversion limits before import. Use separate Import editable, Import flattened and Cancel buttons; never silently select a lossy fallback. Keep Cancel/close/Escape available during inspection/import. Editable import is disabled when unsupported. Status/error text uses existing semantic tokens; findings scroll within the dialog and wrap long names. Opening creates a document tab and retains prior edited work. Flattening and cubic/coverage/XML/master-identity losses must be readable before commitment.


### Vector stroke controls

The Vector path inspector uses existing Select and NumberField controls for Stroke cap, Stroke join, Stroke miter limit and Stroke dash offset. Miter limit is disabled for other joins while retaining its value. Dash/gap lengths use an editable draft with explicit Apply dashes/Enter; Escape restores the current pattern. Invalid drafts show an inline semantic error without changing history. Solid stroke clears the pattern in one command. Controls respect ancestor locks/busy state and keep editable-field shortcuts local. No new keyboard binding or design-system dependency is introduced.


### Vector gradient fill controls

The Vector path inspector retains fill enable/color controls and adds a native Solid/Linear/Radial selector. Gradient mode exposes color stops, exact ordered positions, opacity Slider/NumberField pairs, Add fill stop, Remove and Reverse fill. Start/end geometry stays in stacked NumberFields; radial circles include radii. A disclosure contains the affine paint matrix. Locked/busy state disables all mutations, native editable-field shortcuts remain local, and invalid geometry reports through the existing action error surface without changing history. Solid restores a literal fill; disabling fill clears both paints. No new shortcuts or external design-system dependency.


### Compound path controls

Vector Properties uses the existing Select for Path fill rule and a native details disclosure listing additional-contour removal buttons. Disable Closed path while extras exist, and disable all mutation controls under current/ancestor locks or busy state. Every contour shares paint; Pen anchor/handle affordances cover all boundaries using existing focus/cancel/undo behavior. No new keyboard binding or external component system is introduced.


### Boolean vector dialog

Use the existing custom Button, Select, TextInput, check fields, native progress and Dialog primitives. **Combine vector paths…** is available from Vector Properties and the command palette, with no new shortcut binding. Label area-only semantics and first-operand appearance so users can choose correctly. List searchable path candidates in pages of 32; disable open/locked paths and further selections at the 128-path budget. Let users change the first operand without losing other choices. Disable edits while working, show actual pair progress, and keep Cancel/Escape available to terminate work. Errors remain local to the dialog and preserve artwork/history; stale dialogs ask users to reopen against current geometry. Ordinary result selection and undo remain consistent with other document commands.


## Pen control geometry

Keep every authored anchor, handle and contour available. Precision-safe Pen overlay translations share one SVG group transform; the linear affine basis still maps control centers into document coordinates. Anchor squares, handle circles and strokes retain their screen dimensions through zoom and affine artwork changes. Transformed parents, compound paths and linked/unlinked vector masks follow the same rule. Treat local SVG x/y/cx/cy attributes as implementation details: acceptance checks use effective document/screen positions and actual pointer interactions. This adds no shortcut or new visual control.


Pen translation shares the SVG group only when its conservative float-precision error bound stays below 1/1024 of a CSS pixel (`max(abs(e),abs(f)) * zoom * 2^-23`). Otherwise controls retain the earlier JavaScript-computed absolute coordinates and a zero group translation. This preserves cancellation between large local coordinates and opposing translation; it neither rejects geometry nor caps document coordinates/zoom. Crossing the precision boundary refreshes geometry and group placement atomically. The native browser test includes 1e10 local coordinates and a zoom-driven boundary transition.


## Paragraph controls

Typography adds the existing Select for Text layout (Point text/Paragraph text), NumberField for geometric Paragraph width, paired Slider/number inputs for Paragraph spacing (0…10000 px) and First-line indent (-10000…10000 px), plus Reset paragraph. Preserve live preview/Escape, one commit/undo, disabled ancestor locks and typing shortcuts. Paragraph corner handles change flow width and keep font size; text height grows from its lines. State that unbreakable content can extend outside the width. Missing native grapheme support disables new paragraph entry and width controls, explains the limitation and keeps Point text/Reset recovery available. No keyboard binding or component-library change is introduced.

## Paragraph justification

Text properties expose a Justification select with None and Inter-word, using existing stacked controls and semantic tokens. Explain that only Paragraph text soft wraps expand word spacing; final/forced/no-gap lines keep authored spacing. Disable unsupported native controls with a plain explanation and preserve Reset paragraph recovery. Ordinary attached setters give one undo entry, ancestor locks and busy-state behavior; editable-field shortcuts remain native. No new keyboard binding or visual component system is introduced.

## SVG whitespace disclosure

The Export dialog retains its existing font and glyph-placement warnings. Host whitespace calibration may improve local appearance while preserving editable whole lines; it must not imply that every font, combining-mark sequence or viewer matches the native canvas. Keep PNG and native-project guidance and preserve ordinary progress/cancel/error behavior. No new control, keyboard binding or component system is introduced.


TIFF uses the existing Export dialog and native Select for TIFF compatibility: Automatic (default), Classic TIFF and BigTIFF. Show native pixel dimensions, flattening/metadata/72 DPI disclosures and the compatible-viewer warning before download. Keep compatibility/format controls disabled during work; progress and Cancel remain visible. Cancellation produces no partial download and allows retry. Use existing semantic controls/tokens; no new shortcut or UI library.


### PSB large-document delivery

Offer PSB beside PSD in the existing Export format selector. Both share the Rendered layers/Flatten choice with the selected format in its accessible label. Show PSD's axis-limit guidance and PSB's compatible-reader/rendered-RGB8 losses before download; retain normal progress, Cancel, retry and dismiss behavior. Photoshop preflight names PSD or PSB from the actual inspected version, not the filename. Successful import remains a new document tab, preserving existing edited work. Reuse current Dialog/Select/Button/tokens and shortcuts; do not add a component library or imply editable Photoshop effects/type/masks/groups.


Photoshop export retains the existing progress/Cancel/retry interface while private encoding runs off-thread. Cancel must discard pending output and leave artwork/history intact; worker failures use existing export error handling and allow retry. Keep worker/packet implementation details out of the product controls. Native rendering and broader frame/memory limits remain separate verification work.


### Photoshop file inspection and cancellation

Open a custom Dialog immediately after file selection, with filename, Inspecting status, Cancel/close/Escape and an inline error/Inspect again action. Replace loading content with existing version-aware preflight metadata after inspection; never retain raw planes for UI preview. Page layer/message lists in groups of 100 while retaining complete counts and access to every record. Keep progress and Cancel/close/Escape active during decoding/preparation/install, disable import/mode changes while running, and support retry after errors. An unavailable merged composite disables flattening. Successful import opens a new tab and keeps edited work. Describe actual prototype ICC/CMYK/mask/group losses; do not label missing additional findings as full fidelity. Keep worker/packet details out of product controls; reuse the custom tokens/components and keyboard registry.


### Pass-through group controls

Only a selected group offers Pass-through in the existing Blend mode Select. Normal remains the default. In pass-through mode disable own Fill opacity and Layer styles controls with the explanation: “Children blend with the surrounding stack. Choose Normal to use group styles or fill opacity.” Group Opacity and mask controls remain available through existing paired inputs and shared undo. Mode changes use one command; unsupported combinations surface the normal action error. No shortcut/component library is added. Backend status reports Standard rendering for this currently unsupported WebGPU composition.

### Pressure response controls

Use the existing Button, Dialog, Select and paired Slider/number components. The brush controls open Pressure response with Default, Linear, Soft, Firm and Custom choices. Default explains existing minima; explicit curves show a normalized graph and paired slider/exact numeric knot controls. Slider movement previews the local draft; Escape restores the knot at gesture start. On narrow viewports, knot controls stack while each slider retains its adjacent numeric entry. Input endpoints stay fixed, outputs remain editable, interior knots can be added/removed, and ordering errors disable Apply with an inline alert. Apply changes new-stroke settings, Cancel/Escape discards the draft, and focus returns to the initiating control. Register the modal with normal shortcut isolation. Keep graph/fields usable on narrow viewports and avoid implying measured tablet/hardware behavior. Tool preferences stay outside document undo; recorded artwork retains its authored curve.


### Brush preset library

Use the custom Dialog, Button, TextInput and existing semantic tokens. Brush presets opens a searchable named row list and selected-value summary, with explicit Apply and double-click apply. Built-in rows are read-only; Duplicate creates an editable copy. Show tool, size, dynamics, optional foreground and relevant clone/tonal/healing settings. Save/Update clearly identify the current tool. Keep name/color/selection mutations disabled during writes, preserve Cancel/close/Escape, restore trigger focus, and stack list/details on narrow viewports without horizontal overflow. A remote edit marks the selected draft stale until explicit reload, rather than replacing typed text. Storage errors retain current-brush and last-valid exports, retry and a raw backup-first recovery reset; never auto-clear bad data. Tool preferences do not add document history. Spacing's paired Slider/number control covers 1–1000%, matching the supported engine setting.

The library pages visible rows in groups of 100; search covers the complete saved collection. This is a UI rendering budget, not a limit on saved presets or imported image resolution.

Spacing and smoothing preserve fractional percentages in both the toolbar and preset summaries; applying/importing a preset must not round displayed values to integer percentages.

Brush tip uses the existing custom modal, paired sliders/exact fields, checkboxes and buttons. Static angle/roundness and optional tilt orientation/flattening edit a draft; diagram-only pen controls never affect artwork. Tilt response temporarily replaces the tip modal with the shared curve editor; Cancel/Escape returns to the retained draft and restores trigger focus. Apply response updates only that draft; Apply tip publishes future tool settings. Default restores legacy shape, and Cancel preserves current settings/history. Narrow layouts stack fields. Shaped cursors use the complete layer/mask plane and screen-width contrast strokes; nominal full-pressure size remains the existing policy. Healing shows shaped endpoint footprints and a thin connecting guide. No global shortcut is added.

Symmetry uses the custom local-draft modal with native mode Select, exact fractional document-pixel line/center NumberFields and paired integer 2–32 radial-sector controls. Off, vertical/horizontal mirrors, both axes and radial modes expose only relevant fields. Center on canvas is explicit; custom copy data is preserved until another mode replaces it. Cancel/Escape preserves tool/history; Apply affects future strokes. No global shortcut is added. A marker diagram communicates copies, not brush size. Guides and contrasting ghost cursors are pointer-transparent; hover updates retained SVG nodes without React pointer state. Cursor SVG dimensions follow the visible viewport, while offscreen copies remain authored data. Narrow layouts stack and scroll existing modal content. Use semantic color/focus/text tokens in both themes.


## Image-backed brush texture controls

Use the custom Texture dialog from brush-family ToolOptions. The dialog edits a private source/channel/inversion draft; Apply affects future strokes and Cancel/Escape discards all draft work. File failures keep the last ready source visible. TIFF sources show page geometry, limitations and explicit precision-loss consent before Use TIFF page as texture. Keep Cancel available during preparation and abort/dispose pending work on close. Document source choices show original names/dimensions. The 128-square white-ink coverage preview is a proxy on the canvas surround, with original-dimension/source retention text. Cursor coverage uses the same bounded proxy inside existing transformed outlines and symmetry copies; hover remains outside React pointer updates. Keep the dialog within narrow-screen bounds and enable vertical scrolling. Current metadata-only preset capture explains the missing source-bearing format instead of silently stripping texture.


## Source-bearing brush presets — 2026-10-18, in verification

Preset/pack v4 carries image-backed coverage preferences and exact original Blob sources with native dimensions, MIME/name, SHA-256 and TIFF page/precision choices. Source-free JSON versions 1–3 remain readable/exportable. Binary packs use a checksummed 48-byte header, strict manifest and contiguous original-blob slices; readers reject missing/unused references, corrupted extents/checksums and native decode/dimension mismatches before any import commit. Portable source IDs are remapped and cannot bind to document asset IDs. The single existing IndexedDB v1 preset store now atomically stores optional source blobs alongside their preset; no physical schema migration is needed. Older strict readers reject these newer records while preserving bytes.

The library verifies actual stored source contents before writes and retains last-valid snapshots on failures. Read-only keepalive requests maintain the native write lock across asynchronous checks; only active request callbacks queue changes. Recovery v2 preserves raw records and original blobs, including invalid preset metadata, and compares complete content fingerprints under that lock before reset. Same-size byte changes and stale revisions cannot be erased with an old backup. Legacy JSON recovery remains available for source-free records; unsupported raw non-JSON values still fail without deleting data.

The custom preset dialog connects source-aware save/update/rename/duplicate/delete/import/export/download/recovery and shows source name/dimensions/coverage. Applying privately verifies/decodes an original, guards abort/supersession/document/tool/source changes, then uses normal tool selection/configuration; errors retain prior ready preferences and newer human edits. Preferences stay outside document undo; actual strokes still use shared OO commands/history and collision-safe document leases. Original images stay independent of viewport/cursor proxies, library deletion and closed source documents. This adds no isolated script/plugin file privilege, paid provider, upload, REST/browser sync or document schema bump. See [BRUSH_PRESETS.md](BRUSH_PRESETS.md) for signatures, binary contract, errors and limits. Complete native/production verification and wider F06/F14/device gates remain open.

Paragraph-style hierarchy: the chosen library style exposes a non-mutating Base paragraph style selector, excluding itself and descendants. Set style base commits inheritance; a new base inherits all settings, and Independent style detaches without changing appearance. Show the base name and style-override count separately from text-local overrides, with Reset inherited style overrides. Explain that Update style from text captures all fields as style overrides. New paragraph style name plus Create style based on selected creates a child and applies it in one transaction. Reuse native controls, locks, errors and keyboard focus; add no global shortcut.


### RAW review and development

Use the custom Dialog, Button, Select, exact NumberField and progress controls. Import camera RAW opens inspection immediately; require explicit 8-bit conversion consent before Preview or Import. Show native camera/geometry and source limitations. WB exposes Camera/Automatic/Daylight/Custom, with exact RGB multipliers in Custom; disable unavailable camera WB for color data. Demosaicing, exposure and highlight controls edit a private draft. Preview develops actual sensor data without changing document/assets/history; changing settings discards that preview. Apply replaces the shared master in one undo step; explain shared instances, retained originals and current sRGB8 precision. Develop RAW is available in Properties and command search for RAW smart objects, respecting locks/busy state. Cancel/close/Escape abort pending native work and discard the draft. Reopening against current artwork is required after stale edit drafts. Keep keyboard typing local, preview images within modal bounds and original source geometry independent of preview size. No new shortcut or UI library.

### Native recipe preparation

Keep the existing Recipe Library/portable-package controls and exact parameter fields. RAW dry-run text identifies the receiving original, shared instances and explicit sRGB8 conversion. Run reports actual native phases/progress, retains an available Cancel preparation action and aborts on close/Escape. Keep invalid plans/errors visible and require review/retry after target changes. Imported/recorded recipes remain inert until Run. No new shortcut or component library.

### RAW batch review and recovery

Upload recognizes camera RAW extensions/MIMEs and reviews each original in the existing custom RAW dialog with explicit sRGB8 consent, source limitations, exact WB/demosaic/exposure/highlight controls and genuine preview. Queue RAW image approves only that file; Cancel/Escape skips remaining unreviewed files and preserves earlier approved entries. Show queued RAW settings and retained-original intent. The visible editor stays unchanged. Runner rows show real native preparation progress; Pause/Cancel retain their existing batch meaning. Review explains full sensor originals in RAW delivery packages and exposes verified editable-project downloads alongside variant review. Zero-cost local work needs no unrelated spending approval. Reuse native controls, focus restoration and narrow-dialog layouts; add no shortcut or component library.

### Manual RAW lens controls

Reuse the existing RAW review/development dialog. A Lens correction disclosure explains manual calibration and transparent borders; Enable lens correction reveals exact fields for Scale, radial k1/k2/k3, center x/y, red/blue scales and vignette k1/k2/k3. Preserve parameters when disabled. Report geometric folds/nonpositive attenuation inline and disable Preview/Apply/Queue until valid. Draft edits invalidate previews and Cancel/Escape discards them. Native image geometry stays independent of zoom/canvas placement; Scale crops the corrected field. Reuse native number controls, focus, busy/error and narrow wrapping rules. No new rail tool, shortcut or UI library.


RAW review includes a Recorded lens and exposure disclosure showing declared lens identity, focal/equivalent mm, f-number, exposure seconds and ISO. Display unknowns explicitly and format native float32 values with seven significant digits for reading. Keep these read-only source details separate from editable development controls; disclose that they are not verified/calibrated sensor measurements or automatic profile matching. Existing dialog scrolling, actions, Escape/cancellation and preview/commit boundaries remain.
