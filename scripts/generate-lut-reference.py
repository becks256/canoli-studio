"""Independent .cube and pixel fixtures, using Colour Science 0.4.6.

MPLCONFIGDIR=/tmp/canoli-colour-mpl PYTHONPATH=/path/to/colour python3 scripts/generate-lut-reference.py
No Canoli parser, interpolation or pixel implementation is imported.
"""
from pathlib import Path
from itertools import permutations
import json
import colour
import numpy as np

directory = Path(__file__).resolve().parents[1] / "tests/fixtures/lut"
directory.mkdir(parents=True, exist_ok=True)
domain = np.array([[-.25, 0, .125], [1, 1.5, 1.125]])
grid = colour.LUT3D.linear_table(size=3)
r, g, b = np.moveaxis(grid, -1, 0)
table = np.stack([1.2 * r * g - .1, .8 * g + .2 * b ** 2, b * r], axis=-1)
three = colour.LUT3D(table, name="Independent 3D # look", domain=domain)
x = np.linspace(0, 1, 5)
one = colour.LUT3x1D(np.stack([x ** 2, np.sqrt(x), 1.1 - 1.2 * x], axis=-1),
                    name="Independent 1D look", domain=domain)
rng = np.random.default_rng(9921)
pixels = np.array([[*value, [0, 1, 64, 128, 255][i % 5]] for i, value in
                   enumerate([*permutations([40, 114, 205]), [0, 0, 0], [255, 255, 255],
                              [128, 128, 128], [255, 0, 255], *rng.integers(0, 256, size=(64, 3)).tolist()])])
cases = []
for name, lut in [("independent-1d", one), ("independent-3d", three)]:
    path = directory / (name + ".cube")
    colour.io.write_LUT_IridasCube(lut, path, decimals=9)
    # The portable implementation stores float32, as do common independent readers.
    parsed = colour.io.read_LUT_IridasCube(path)
    parsed.table = parsed.table.astype(np.float32).astype(np.float64)
    rgb = pixels[:, :3] / 255
    clipped_input = np.clip(rgb, parsed.domain[0], parsed.domain[1])
    for interpolation in ["tetrahedral", "trilinear"]:
        kwargs = {} if name.endswith("1d") else {"interpolator": getattr(colour.algebra, "table_interpolation_" + interpolation)}
        corrected = np.clip(parsed.apply(clipped_input, **kwargs), 0, 1)
        for amount in [0, 35, 100]:
            output = pixels.copy()
            output[:, :3] = np.floor((rgb + (corrected - rgb) * (amount / 100)) * 255 + .5).astype(int)
            cases.append({"file": path.name, "interpolation": interpolation, "amount": amount,
                          "pixels": pixels.flatten().tolist(), "expected": output.flatten().tolist()})
artifact = {"generator": "Colour Science", "version": colour.__version__, "cases": cases,
            "notes": "Independent read/write, domain mapping and 1D/3D interpolation; finite float32 table storage, encoded RGB input, endpoint clamp and amount before final byte rounding. Alpha is preserved."}
(directory / "reference.json").write_text(json.dumps(artifact, indent=2) + "\n")
