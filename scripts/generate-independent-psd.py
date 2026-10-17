"""Regenerate the deterministic inbound interoperability fixture with psd-tools.

PYTHONPATH=/path/to/reader python3 scripts/generate-independent-psd.py
Verified with psd-tools 1.24.0, Pillow 10.3.0. No Canoli writer code is imported.
"""
from pathlib import Path
from PIL import Image
from psd_tools import PSDImage
from psd_tools.api.layers import PixelLayer
from psd_tools.constants import Compression

psd = PSDImage.new("RGBA", (4, 2), color=(0, 0, 0, 0))
PixelLayer.frompil(Image.new("RGBA", (4, 2), (80, 120, 150, 128)), psd,
                   name="Base transparency", compression=Compression.RLE)
PixelLayer.frompil(Image.new("RGBA", (1, 2), (200, 30, 60, 255)), psd,
                   name="Top", left=2, compression=Compression.RLE)
hidden = PixelLayer.frompil(Image.new("RGBA", (2, 2), (0, 255, 0, 255)), psd,
                           name="Hidden", compression=Compression.RLE)
hidden.visible = False
# Signal merged transparency through the library's low-level structure. RGBA
# header channels alone denote an extra alpha channel, not preview transparency.
psd._record.layer_and_mask_information.layer_info.layer_count = -3
psd.save(Path(__file__).resolve().parents[1] / "tests/fixtures/psd/psd-tools-transparency.psd")

# An opaque preview with an additional, zero-filled alpha channel must stay opaque.
opaque = PSDImage.new("RGBA", (2, 2), color=(0, 0, 0, 0))
PixelLayer.frompil(Image.new("RGBA", (2, 2), (30, 100, 210, 255)), opaque,
                   name="Opaque with extra alpha", compression=Compression.RLE)
opaque.save(Path(__file__).resolve().parents[1] / "tests/fixtures/psd/psd-tools-extra-alpha.psd")
