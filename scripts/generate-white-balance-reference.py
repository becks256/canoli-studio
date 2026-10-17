"""Independent white-balance references using Colour Science's Kang/Bradford code.

MPLCONFIGDIR=/tmp/canoli-colour-mpl PYTHONPATH=/path/to/colour python3 scripts/generate-white-balance-reference.py
Verified with colour-science 0.4.6 and NumPy 1.26.4; no Canoli math is imported.
The D65-relative offset/tint scale are this editor's documented control model.
"""
import json
from pathlib import Path
import colour
import numpy as np

rgb_to_xyz = np.array([[.4124564, .3575761, .1804375], [.2126729, .7151522, .072175], [.0193339, .119192, .9503041]])
target = colour.xy_to_XYZ([.3127, .329])


def locus(temperature):
    xy = colour.temperature.CCT_to_xy_Kang2002(temperature)
    return colour.UCS_to_uv(colour.XYZ_to_UCS(colour.xy_to_XYZ(xy)))


offset = colour.UCS_to_uv(colour.XYZ_to_UCS(target)) - locus(6504)
cases = []
for temperature in [2000, 2222, 2222.5, 4000, 4000.5, 6504, 10000, 25000]:
    # Five-point derivative within the same polynomial branch. This independent
    # numerical tangent differs from the production analytic derivative.
    direction = -1 if temperature in [2222, 4000, 25000] else 1
    step = temperature * .0001 * direction
    values = [locus(temperature + i * step) for i in range(5)]
    tangent = (-25 * values[0] + 48 * values[1] - 36 * values[2] + 16 * values[3] - 3 * values[4]) / (12 * step)
    normal = np.array([tangent[1], -tangent[0]]) / np.linalg.norm(tangent)
    for tint in [-100, 0, 100]:
        uv = values[0] + offset + normal * tint * .00005
        white = colour.UCS_to_XYZ(colour.uv_to_UCS(uv))
        white /= white[1]
        adaptation = colour.adaptation.matrix_chromatic_adaptation_VonKries(white, target, transform="Bradford")
        matrix = np.linalg.inv(rgb_to_xyz) @ adaptation @ rgb_to_xyz
        cases.append({"temperature": temperature, "tint": tint, "whitePoint": white.tolist(), "matrix": matrix.tolist()})
artifact = {"generator": "Colour Science", "version": colour.__version__, "cases": cases,
            "notes": "Independent Kang/Bradford functions with a numerical tint tangent; compare matrices within 1e-7 due to derivative estimation. D65-relative whitepoint and tint units are an editor control convention, not a camera RAW calibration."}
path = Path(__file__).resolve().parents[1] / "tests/fixtures/white-balance-reference.json"
path.write_text(json.dumps(artifact, indent=2) + "\n")
