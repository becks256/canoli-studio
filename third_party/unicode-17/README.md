# Private text-item Unicode data

These are complete Unicode 17.0.0 character-property sources from unicode.org.
`sources.json` records the exact download URLs, byte counts and SHA-256 values.
The accompanying Unicode License V3 is retained in `LICENSE.txt` and included in
the application's font notices.

`python3 scripts/build-unicode-text.py` verifies every source hash and generates
`src/fonts/unicode-text-data.ts`. Use `--check` to verify reproducibility without
writing. The generated table covers every code point, including Script's Unknown
default, Script_Extensions' Script default and all declared bidi-class defaults.
It contains no downloaded executable code and makes no runtime network requests.

The renderer uses these properties to select original script/direction ranges.
Native caret metadata supplies resolved direction; original font shaping supplies
glyph IDs. Exact complete native ink still gates glyph publication. A pinned
property version does not establish equivalence with every browser's Unicode,
font fallback or script-itemization implementation.
