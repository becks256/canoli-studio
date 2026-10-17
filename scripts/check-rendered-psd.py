"""Independent rendered-PSD gate. Requires Pillow, NumPy and psd-tools.

Usage: PYTHONPATH=/path/to/reader python3 scripts/check-rendered-psd.py cases.json
The manifest contains paths, dimensions, expected straight RGBA, names, visibility.
No editor parser/writer code is used here. ICC conversion is disabled because this
gate compares encoded sRGB pixels, rather than testing profile conversion fidelity.
"""
import hashlib
import json
import sys

import numpy as np
from psd_tools import PSDImage, __version__


def compare(image, expected, label, rgb_limit, alpha_limit):
    actual = np.asarray(image.convert("RGBA"), dtype=np.float64)
    reference = expected.astype(np.float64)
    alpha = np.abs(actual[:, :, 3] - reference[:, :, 3])
    premult = np.abs(actual[:, :, :3] * actual[:, :, 3:] / 255 -
                     reference[:, :, :3] * reference[:, :, 3:] / 255)
    maximum = float(premult.max(initial=0))
    alpha_max = float(alpha.max(initial=0))
    assert maximum <= rgb_limit, (label, "premultiplied RGB", maximum)
    assert alpha_max <= alpha_limit, (label, "alpha", alpha_max)
    return {"maxPremultipliedRgbError": maximum, "maxAlphaError": alpha_max}


with open(sys.argv[1], encoding="utf-8") as source:
    cases = json.load(source)
results = []
for case in cases:
    psd = PSDImage.open(case["path"])
    assert psd.size == (case["width"], case["height"])
    assert [layer.name for layer in psd] == case["names"]
    assert [layer.visible for layer in psd] == case["visibility"]
    expected = np.asarray(case["expected"], dtype=np.uint8).reshape(case["height"], case["width"], 4)
    preview = compare(psd.topil(apply_icc=False), expected, case["path"] + " preview", 1.01, 0)
    # Force bypasses the stored preview and recomposes actual layer data.
    recomposed = compare(psd.composite(force=True, apply_icc=False), expected,
                         case["path"] + " layers", 3, 1)
    layers = []
    for layer in psd:
        image = layer.topil(apply_icc=False)
        assert image is not None
        layers.append({"name": layer.name, "bbox": layer.bbox, "visible": layer.visible,
                       "opacity": layer.opacity, "blendMode": layer.blend_mode.value.decode("ascii")})
    with open(case["path"], "rb") as exported:
        digest = hashlib.sha256(exported.read()).hexdigest()
    results.append({"sha256": digest, "size": psd.size, "preview": preview,
                    "recomposed": recomposed, "layers": layers})
print(json.dumps({"reader": "psd-tools", "version": __version__, "cases": results,
                  "limitations": "Encoded 8-bit sRGB fixture comparison with ICC conversion disabled; not a Photoshop, native editable-effects or general color-fidelity claim."}, indent=2))
