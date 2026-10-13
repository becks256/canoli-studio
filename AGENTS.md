# Working on Canoli Studio

Read these files before changing product behavior or architecture:

1. `docs/PRODUCT_BRIEF.md` — application objective, vision, business constraints, and open decisions.
2. `docs/REQUIREMENTS.md` — confirmed requirements, milestone scope, keyboard map, and acceptance criteria.
3. `docs/ARCHITECTURE.md` — module responsibilities, public constructor API, and extension boundaries.
4. `docs/API.md` — REST and scripting contracts, isolation and current limitations.
5. `docs/SCRIPTING_API.md` — scripting guide, constructor/member reference, examples and execution contract.
6. `docs/DESIGN_SYSTEM.md` — visual foundations and interaction/component rules. Use the custom system; do not introduce shadcn.
7. `docs/PLUGINS.md` — versioned package format, permissions, lifecycle, local persistence and extension boundaries.
8. `docs/SYSTEM_DESIGN.md` — comprehensive system design, module boundaries, core invariants, and decision matrix.

For feature planning or expansion, also read `docs/FEATURE_STRATEGY.md`, `docs/COMPETITIVE_RESEARCH.md`, `docs/AI_FEATURE_SPECS.md`, and `docs/IMPLEMENTATION_ROADMAP.md`. These are proposed scope and release gates, not evidence that features or API signatures exist. Update the planning work/decision log as slices are implemented; retain the broad professional-editor objective while making staged delivery claims.

Keep the public document model object-oriented. Use `Document`, `RasterLayer`, `LayerGroup`, and adjustment constructors; route attached mutations through commands so UI, keyboard shortcuts, and API clients share validation and undo behavior. Plain data objects are for serialization, snapshots, and workers, not an alternative public mutation API.

Keep keyboard bindings in `src/ui/shortcuts.ts` and action registration in the UI command registry; update documented shortcuts when bindings change. Do not intercept typing shortcuts in editable fields.

Treat AI integration as a future milestone until explicitly scoped. Do not add paid API calls, fake AI behavior, procurement features, accounts, or cloud uploads as incidental changes to the local editor foundation.

Update the brief for a changed product objective; update requirements and architecture when scope or boundaries change. Clearly distinguish current behavior from planned functionality.

Use `npm run build`, `npm test`, and relevant Playwright tests to verify substantive engine/API changes. Test actual WASM output and real browser behavior where affected. Never claim a check passed without running it. New tests should verify user-visible behavior or important invariants rather than mirror implementation details.

REST and scripting are separate required surfaces. Use shared commands/validation/history, validate external results, and preserve script isolation. Do not claim the current headless REST sessions synchronize with the browser.

Never add arbitrary image megapixel or file-size import limits. Keep original resolution and separate document geometry from viewport/tile/cache allocation budgets. Verify large-image changes with the 50 MP browser test; record real browser and memory limitations honestly.

When changing the scripting API, update `docs/SCRIPTING_API.md` in the same change, including affected signatures, defaults, examples, error behavior and limits. Verify affected examples against the actual DOM/runtime; do not document planned capabilities as implemented.

Plugin installation must remain inert. Run third-party command code only through the existing isolated scripting boundary, enforce manifest permissions at host commit, and preserve shared undo/revision/asset validation. Update PLUGINS.md when the package or runtime contract changes.
