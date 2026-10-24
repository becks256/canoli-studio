# Font-source fixtures

These small fonts use original geometric outlines generated for this repository. No third-party font outlines are copied. They cover TrueType, CFF/OpenType, WOFF, WOFF2, a two-face TTC, a TTC with an empty DSIG table, and a two-face Macintosh SFNT datafork.

Regenerate with `python generate.py` using FontTools 4.51.0 and Brotli 1.2.1. Header timestamps are fixed. The generator independently reads both datafork faces with FontTools and writes source SHA-256 values to `manifest.json`.

The Regular and Bold faces intentionally have different advance widths and outlines. The separate Manrope variable WOFF2 case reads the existing pinned `@fontsource-variable/manrope` dependency and its existing license; it is not copied into this fixture directory.
