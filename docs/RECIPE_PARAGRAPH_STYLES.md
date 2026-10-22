# Paragraph styles in recipes

These actions run through the existing local Recipes dialog, deterministic dry-run/compiler, portable package and batch workflows. They do not invoke a provider. Constructor scripts continue to use `ParagraphStyle` and `TextLayer` as documented in SCRIPTING_API.md.

## Actions

| Action | Fields | Behavior |
| --- | --- | --- |
| `paragraphStyle.ensure` | `name`, `format` | Create a fresh document-scoped style or reuse the same normalized name with identical formatting. Different formatting is a conflict, with no automatic overwrite or suffix. |
| `paragraphStyle.update` | `style`, `name`, `format` | Replace the resolved style's full format/name, updating followers through shared commands and retaining their overrides. |
| `paragraphStyle.remove` | `style` | Remove the definition and detach its followers, keeping their resolved typography. |
| `text.paragraphStyle` | `style` or `null`, optional `keepOverrides` (default false) | Apply a style to text; null detaches while preserving appearance. Applying clears overrides unless requested otherwise. Requires the step's ordinary layer `target`. |
| `text.paragraphOverrides.clear` | optional `keys` | Reset all overrides when omitted; otherwise reset the unique known format keys supplied. An empty list clears none. Requires a linked text target. |

A style selector is exactly `{ "by": "name", "name": "Body" }` or `{ "by": "stepResult", "stepId": "body" }`. Names match after trimming and case folding, consistent with the document library's uniqueness rule. A step reference uses a previous ensure/update step ID or its outputVar alias. The reference survives subsequent renames. Style outputs and layer outputs have separate namespaces. A missing, skipped, removed, forward or wrong-kind reference is an error. Library actions reject layer targets; text actions reject missing or non-text targets.

`format` supplies all fourteen paragraph format fields from the document contract, with the same ranges, enums and strict rejection of extra fields. Numeric `${parameter}` expressions resolve to numbers before shared validation. Names and formatting strings interpolate normally unless `literalValues: true`. Step IDs, aliases and format keys are structural references rather than parameter expressions. Conditions use the existing recipe rules; a skipped producer binds no style. A library update can affect all its followers and the dry-run lists those layers. Locks on affected text or its ancestors reject the entire replay.

## Recorder and portability

The recorder emits ensure dependencies before their first use. Initial styles are captured as full definitions; later updates/removals reference those outputs, so portable recordings carry no required document style IDs. Existing identical target styles are reused; conflicting definitions require review before replay. A recorded base update against preexisting linked text therefore expects the target document's matching library/followers, or creates an unused definition when none exists. Applying a style and then updating it records the full visible workflow on a new document.

Added text/group templates use optional `paragraphStyles: { "local-key": selector }` on `layer.add`. Each root-scoped text node's `paragraphStyle.id` refers to one key in that map. Its overrides and resolved concrete typography remain in the template; they must agree with the referenced style at that step. This map is required for every linked template binding, including nested groups, so a foreign ID cannot accidentally bind to a target definition. Independently scoped embedded documents retain their own libraries; these actions do not add smart-object template support to the existing recipe kind list.

Recorder undo/redo and branch snapshots include style references. Optional typography setters assigned undefined on linked text record an explicit selective reset, preserving intent through JSON. Captured strings are literal, including names that contain `${...}`. Paused commands are excluded under the existing recorder contract. Unsupported commands still reject the complete recording. Undo past the recording boundary still invalidates it.

Recipes keep schema version 1 and portable packages keep version 1; older runtimes reject unfamiliar actions. Existing recipes remain valid. Native document/project/workspace schemas stay 40/3/2. Package assets and checksums, saved batch recipe snapshots, dry-run non-mutation and a single successful replay undo transaction retain their existing contracts. A conflict or invalid/locked reference fails the whole run without a partial document/style update.

## Importable example

Save the JSON below and import it in Recipes. Select a text layer named `Text`, or change the target. The first run creates Body and applies it. Replaying reuses Body if its format still matches; edit the definition or use an explicit update to handle a changed library.

<!-- example: paragraph-style-recipe -->
```json
{
  "schemaVersion": 1,
  "id": "paragraph-body-example",
  "name": "Apply reusable body style",
  "description": "Local linked typography with a configurable size",
  "version": 1,
  "parameters": [{"name":"size","label":"Body size","type":"number","default":28,"min":1,"max":200}],
  "steps": [
    {
      "id":"body", "name":"Prepare Body style",
      "action":{
        "type":"paragraphStyle.ensure", "name":"Body",
        "format":{
          "fontSize":"${size}", "fontFamily":"sans-serif", "color":"#315b2a",
          "align":"left", "lineHeight":1.4, "letterSpacing":0, "wordSpacing":0,
          "fontKerning":"auto", "fontWeight":"normal", "fontStyle":"normal",
          "direction":"ltr", "paragraphJustify":"none", "paragraphSpacing":10, "firstLineIndent":0
        }
      }
    },
    {
      "id":"apply", "name":"Apply Body to Text",
      "target":{"by":"name","pattern":"Text","literal":true},
      "action":{"type":"text.paragraphStyle","style":{"by":"stepResult","stepId":"body"}}
    }
  ]
}
```

Recorder name and tone-parameterization preferences remain in editor-session UI state when the dialog closes for canvas editing. They reset on application reload; recording data retains its existing session-only lifetime.

## Based-on style definitions

Schema-41 ensure/update actions accept optional `basedOn: {style: selector, overrides: partialFormat}`. Null/omission means independent. The selector is the same name/previous-style-output reference described above; format remains complete and must agree with that parent's resolved format plus overrides. Missing/cyclic/inconsistent references or locked affected followers reject the whole replay. Ensure reuses only identical formatting **and** equivalent inheritance/explicit overrides, rather than treating a flat style as equivalent to a child. Update omission detaches a previously based-on definition while retaining the explicitly supplied full format.

The recorder captures ancestors before children and retains complete override data. Text/group template references map to the child output; transitive parent changes remain live after replay. Names and format/override values follow ordinary parameter/literal rules; override keys and step references are structural. JSON/package/batch versions remain 1/1/unchanged; no source-document base IDs, new asset dependency or provider operation is required. Child reset and reparenting record ordinary definition updates.
