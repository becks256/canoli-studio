# Original vertical font fixtures

These geometric fonts are original test data, dedicated to the public domain under CC0-1.0. They contain Latin A/B, two distinct Han-shaped geometric marks and punctuation with explicit vertical metrics. They are not a general font or evidence of Japanese language quality.

`Vertical.ttf` contains `vhea`/`vmtx` and `vert`/`vrt2` substitutions. `NoSubstitution.ttf` keeps the original cmap/outlines/metrics and omits GSUB, providing a negative control for automatic vertical substitution. Literal SVG pixel references use the complete original Vertical.ttf input; remapping a cmap is not assumed equivalent to native shaping. The generator records complete source hashes and horizontal/vertical advances in `manifest.json`. FontTools generates both files independently of the editor renderer.
