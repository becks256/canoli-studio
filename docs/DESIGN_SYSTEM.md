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

| Component                 | Rules                                                                                                                    |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Button                    | Citron for the primary action; quiet text/surface for secondary actions; danger for destructive. Real actions only.     |
| IconButton                | Consistent target size, title, accessible name, visible keyboard focus, and disabled state.                              |
| NumberField               | Labeled numerical entry, bounded validation, commit on blur/Enter.                                                       |
| TextInput / Input         | Labeled input entry, draft editing, optional unit suffix, commit on blur/Enter, Escape to revert, inline/stacked layout.  |
| TextArea                  | Multiline text input, accessible label, auto-commit on blur.                                                             |
| Select                    | Accessible dropdown with option values and labels, inline or stacked layout, semantic border/focus tokens.                |
| ColorField                | Color swatch beside label, native color picker integration, accessible color names.                                      |
| SegmentedControl          | Grouped toggle buttons with accessible role, pressed state, and keyboard navigation for mutually exclusive choices.     |
| Slider                    | Labeled track beside exact numeric entry; shared bounds/units, live preview, one commit per gesture, keyboard support.   |
| Layer row                 | Thumbnail/type, name, selection edge, visibility, lock state, nesting. Meaning must not depend on color alone.           |
| Inspector section         | Short heading, grouped related controls, subtle separator.                                                               |
| Floating viewport control | Compact surface for zoom and fit, separated from document content.                                                       |
| Dialogs                   | Unified structure: `dialog-heading` (caption + h2 + close `IconButton`), editorial subtitle, content, and action `Button`s. |
| Shortcut dialog           | Registry-backed key labels, keyboard focus containment, Escape to dismiss, return focus to trigger.                      |
| Feedback                  | Nonblocking status for success; actionable, dismissible errors. Do not hide failures behind optimistic success messages. |

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
