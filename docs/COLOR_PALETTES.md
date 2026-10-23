# Reusable color palettes

Open **Color palettes** in the tool rail or command search. This action has no default shortcut; it can be assigned in Keyboard shortcuts. The palette button beside existing color inputs opens the same library with **Use swatch** actions for that control. Foreground, text, vector fill/stroke and gradient, layer-style, gradient-map and Color Range controls share the library. Choosing a document color uses its existing validated command and undo behavior. Choosing foreground color changes tool settings rather than history. Cancel makes no color edit. If the active document, revision or selected layer changes while choosing, close and reopen the picker.

Create a named palette, describe/tag it, edit swatch names and native hex colors, add the current control's color, remove swatches, and move them earlier/later. Save applies local palette edits. Open palettes show a draft: choosing a different palette discards unsaved details. Saved palette changes do not recolor artwork. Save as copy retains the draft under a new local identity unless its complete content is already saved. Exact duplicates include name, description, tags and ordered named colors; matching only colors is not considered identity. Search uses normalized, case-insensitive text with all terms, across palette and swatch names, descriptions, tags and hex values.

Colors are opaque six-digit **8-bit sRGB** values. This library does not implement spot colors, alpha, ICC palette conversion, CMYK/Lab/HDR values, global linked swatches, image-derived quantization, ASE/ACO/GPL import or shared/cloud libraries. Existing document color-management and editing limitations still apply.

## Local storage and failure recovery

Palettes live in the independent optional `canoli-color-palettes` IndexedDB database, version 1. Initialization is lazy: an editor can start and use native color inputs without accessing this database. There is no account, network upload, plugin execution, file-system path or project schema change. The library belongs to this browser origin/profile, independently of sign-in and account deletion. Placed colors are copied values; deleting palettes leaves documents, exported files and undo intact. Browser eviction can lose local data. Export packs for backups.

Database transactions save/import all records atomically. Imported local IDs/revisions are never trusted. Each record has a revision; saving stale details fails and keeps the draft. **Reload palette details** explicitly replaces that draft. Cross-tab notifications refresh lists when available, but durable revisions remain authoritative. A generation check rejects imports prepared before another tab clears/changes the library, including when notifications are unavailable. Storage denial/blocked databases, quota and transaction failures are visible; an acknowledged write remains acknowledged if its following list refresh fails. Dispose/cancel prevents pending preparation from committing. Cancellation cannot reverse an already committed write.

Unreadable entries stay visible. **Recover palette record** downloads the stored row as a diagnostic JSON file; it is not a valid pack and does not claim automatic repair or byte-exact recovery of arbitrary non-JSON corruption. Remove that row or clear the library explicitly to recover. Clear does not overwrite corruption silently, delete project colors or constitute secure erasure.

## Portable packs

**Export selected palette** saves one stored palette; **Export valid palette pack** saves all valid entries. If the complete catalog exceeds the pack metadata budget, export selected palettes separately. Recovery rows must be downloaded separately before clearing. Imports validate the entire pack before storage and never execute code. Complete duplicates reuse their existing local IDs/revisions rather than overwriting reviews. Distinct reviewed names/order remain distinct palettes.

The UTF-8 `.canolipal` format is strict JSON:

```json
{
  "format": "canoli-color-palettes",
  "version": 1,
  "palettes": [{
    "name": "Botanical",
    "description": "Reviewed print colors",
    "tags": ["Print"],
    "swatches": [{"name": "Leaf", "color": "#315b2a"}]
  }]
}
```

Unknown fields/versions, malformed UTF-8, unsupported colors, empty palettes and invalid siblings reject the whole import. Each palette has 1–4,096 ordered swatches, a 1–120 character name, description up to 4,096 characters, and up to 64 tags of 1–80 characters. Swatch names are 1–120 characters; hex case normalizes lowercase. Tags deduplicate by normalized case-insensitive identity. Packs contain 1–256 palettes and at most 4 MiB of metadata. These are color-metadata budgets, not image import or resolution limits. The catalog itself has no fixed entry eviction limit; lists paginate 40 palettes and 32 editable swatches. Packs contain no executable code, assets, credentials, local IDs or timestamps. Names/descriptions/tags are retained: review them before sharing. Plain JSON validation detects malformed data, not a cryptographic guarantee against valid edits to a pack.

The library and picker are trusted browser UI services. They are not isolated Scripts globals, internal-plugin grants, MCP tools or headless REST endpoints. Existing scripts can still assign ordinary validated color values through document constructors and attached commands. REST documents remain independent of browser state.
