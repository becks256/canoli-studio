# Luma Studio design system

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

Canvas cursors use paired black and white outlines over artwork. Circular tools, including Eraser, show the current diameter multiplied by viewport zoom with a small center mark. Move, text, hand/grabbing, resize and rotation indicators communicate the active interaction; other precision tools use a crosshair. Cursor movement updates an independent overlay once per animation frame, without React state updates. Leaving the viewport, touch input, pointer cancellation, context menus and lost focus hide the custom cursor and restore the native pointer. Buttons and text fields retain native cursors.

Users can restore system canvas cursors through the command palette (Use system canvas cursors); the reciprocal action restores custom cursors. This preference persists locally and does not affect document history. In system mode the size outline remains available, including for Eraser.

### Image size versus canvas size

Image size… is available in the options bar, command palette and Mod+Alt+I. It reuses the artboard dialog's paired pixel dimensions, aspect-ratio link, current-size summary, presets and Apply/Cancel controls, with a distinct Image size title and explanation that canvas and artwork scale together. The explanation also discloses unchanged pixel-based effect settings. Validation errors stay in the dialog without closing it. Canvas resizing retains its existing title and explicitly preserves artwork size and coordinates.

### Freeform lasso

The rail exposes Lasso (L) beside Marquee and Magic wand. The cursor is the precision crosshair. Dragging shows the traced contour plus its closing segment using the existing dashed selection treatment. Release commits an antialiased pixel selection. The shared selection-mode control and Shift/Alt modifiers match Marquee/Wand; the options hint explains all modifiers and Escape cancellation. Empty gestures preserve the current selection.

Export progress appears inside the dialog above its footer, using the existing text/accent tokens and a labelled native progress element. Known rendering progress is determinate; encoding or unknown totals are indeterminate. Cancel remains enabled while exporting and leaves the dialog available after cancellation settles. Closing or dismissing the dialog also cancels its export. Intentional cancellation does not display an error toast or trigger a download.
