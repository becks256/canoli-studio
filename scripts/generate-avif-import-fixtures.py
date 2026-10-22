"""Independent AVIF input corpus: Pillow 12/libavif 1.3 and ffmpeg/libaom.

Run in a Python environment with Pillow AVIF support. No app encoder is used.
The PNGs are native libavif decoding references, with EXIF orientation applied.
"""
from pathlib import Path
from PIL import Image, ImageOps, ImageCms, features
from PIL import ImageDraw
import hashlib
import json
import subprocess
import struct
import importlib.util
import sys

spec = importlib.util.spec_from_file_location("avif_reference", Path(__file__).with_name("avif-reference.py"))
reference_decoder = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reference_decoder)

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "tests/fixtures/avif-import"
OUT.mkdir(parents=True, exist_ok=True)
image = Image.new("RGBA", (17, 13))
image.putdata([((x * 43 + y * 17) % 256, (x * 11 + y * 61) % 256,
                (x * 71 + y * 7) % 256, (x * 19 + y * 31) % 256)
               for y in range(13) for x in range(17)])
cases = []


def record(name, crop=None, **metadata):
    path = OUT / (name + ".avif")
    decoded = Image.open(path)
    decoded.load()
    display = decoded.crop(crop) if crop else decoded
    oriented = ImageOps.exif_transpose(display).convert("RGBA")
    # The reference measures sample decoding, not an ICC display transform.
    oriented.info.clear()
    oriented.save(OUT / (name + "-viewer.png"))
    reference = reference_decoder.decode(path)
    if crop:
        reference = reference.crop(crop)
    orientation = decoded.getexif().get(274, 1)
    reference.getexif()[274] = orientation
    reference = ImageOps.exif_transpose(reference)
    reference.info.clear()
    reference.save(OUT / (name + ".png"))
    cases.append(dict(file=path.name, reference=name + ".png", viewerReference=name + "-viewer.png",
                      width=oriented.width, height=oriented.height,
                      sha256=hashlib.sha256(path.read_bytes()).hexdigest(), **metadata))


for orientation in range(1, 9):
    exif = Image.Exif()
    exif[274] = orientation
    name = f"orientation-{orientation}"
    image.save(OUT / (name + ".avif"), quality=100, speed=8, max_threads=1,
               subsampling="4:4:4", exif=exif)
    record(name, orientation=orientation, depth=8, assumeSrgb=False)

for subsampling in ["4:2:0", "4:2:2", "4:4:4"]:
    name = "opaque-" + subsampling.replace(":", "")
    image.convert("RGB").save(OUT / (name + ".avif"), quality=83, speed=8,
                              max_threads=1, subsampling=subsampling)
    record(name, orientation=1, depth=8, assumeSrgb=False)

profile = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
image.save(OUT / "icc.avif", quality=100, speed=8, max_threads=1,
           subsampling="4:4:4", icc_profile=profile)
record("icc", orientation=1, depth=8, assumeSrgb=False)

image.save(OUT / "premultiplied.avif", quality=100, speed=8, max_threads=1,
           subsampling="4:4:4", alpha_premultiplied=True)
record("premultiplied", orientation=1, depth=8, assumeSrgb=False)

image.convert("RGB").save(OUT / "source.png")


def box(kind, data):
    return struct.pack(">I4s", len(data) + 8, kind.encode("ascii")) + data


def fullbox(kind, data, version=0):
    return box(kind, bytes([version, 0, 0, 0]) + data)


def wrap_av1(payload, depth):
    """Mux the independent ffmpeg OBU payload into one ordinary AV1 image item."""
    ftyp = box("ftyp", b"avif\0\0\0\0avifmif1miaf")
    profile = 1 if depth == 10 else 2
    props = (fullbox("ispe", struct.pack(">II", 17, 13)) +
             fullbox("pixi", bytes([3, depth, depth, depth])) +
             box("av1C", bytes([0x81, profile << 5, 0x40 if depth == 10 else 0x60, 0])) +
             box("colr", b"nclx" + struct.pack(">HHHB", 1, 13, 1, 0)))
    iprp = box("iprp", box("ipco", props) + fullbox("ipma", struct.pack(">IHBBBBB", 1, 1, 4, 1, 2, 0x83, 4)))
    prefix = (fullbox("hdlr", b"\0\0\0\0pict" + bytes(12) + b"\0") +
              fullbox("pitm", struct.pack(">H", 1)) +
              fullbox("iinf", struct.pack(">H", 1) + fullbox("infe", struct.pack(">HH", 1, 0) + b"av01\0", 2)))

    def metadata(offset):
        iloc = fullbox("iloc", bytes([0x44, 0]) + struct.pack(">HHHHII", 1, 1, 0, 1, offset, len(payload)))
        return fullbox("meta", prefix + iloc + iprp)

    meta = metadata(0)
    meta = metadata(len(ftyp) + len(meta) + 8)
    return ftyp + meta + box("mdat", payload)


for depth in [10, 12]:
    name = f"rgb-{depth}"
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y",
                    "-i", str(OUT / "source.png"), "-frames:v", "1", "-c:v", "libaom-av1",
                    "-threads", "1", "-cpu-used", "8", "-crf", "0", "-lag-in-frames", "0",
                    "-pix_fmt", f"yuv444p{depth}le", "-color_primaries", "bt709",
                    "-color_trc", "iec61966-2-1", "-colorspace", "bt709",
                    "-f", "ivf", str(OUT / (name + ".ivf"))], check=True)
    ivf = (OUT / (name + ".ivf")).read_bytes()
    frame_length = struct.unpack_from("<I", ivf, 32)[0]
    assert len(ivf) == 44 + frame_length
    (OUT / (name + ".avif")).write_bytes(wrap_av1(ivf[44:], depth))
    (OUT / (name + ".ivf")).unlink()
    record(name, orientation=1, depth=depth, assumeSrgb=False)

unidentified = bytearray((OUT / "opaque-444.avif").read_bytes())
nclx = unidentified.index(b"nclx")
unidentified[nclx + 4:nclx + 8] = struct.pack(">HH", 2, 2)
(OUT / "unspecified.avif").write_bytes(unidentified)
record("unspecified", orientation=1, depth=8, assumeSrgb=True)

missing = bytearray((OUT / "rgb-10.avif").read_bytes())
at = missing.index(b"colr")
missing[at:at + 4] = b"free"
(OUT / "missing-colr-srgb.avif").write_bytes(missing)
record("missing-colr-srgb", orientation=1, depth=10, assumeSrgb=True, nativeResolved="srgb")

unidentified = bytearray((OUT / "opaque-444.avif").read_bytes())
at = unidentified.index(b"colr")
unidentified[at:at + 4] = b"free"
(OUT / "missing-colr-unidentified.avif").write_bytes(unidentified)
record("missing-colr-unidentified", orientation=1, depth=8, assumeSrgb=True)

rejections = []
for name, primaries, transfer, matrix in [
        ("missing-colr-p3", "smpte432", "iec61966-2-1", "bt709"),
        ("missing-colr-pq", "bt2020", "smpte2084", "bt2020nc"),
        ("missing-colr-hlg", "bt2020", "arib-std-b67", "bt2020nc")]:
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", str(OUT / "source.png"),
                    "-frames:v", "1", "-c:v", "libaom-av1", "-threads", "1", "-cpu-used", "8", "-crf", "0",
                    "-lag-in-frames", "0", "-pix_fmt", "yuv444p10le", "-color_primaries", primaries,
                    "-color_trc", transfer, "-colorspace", matrix, "-f", "ivf", str(OUT / (name + ".ivf"))], check=True)
    data = (OUT / (name + ".ivf")).read_bytes()
    payload = bytearray(wrap_av1(data[44:], 10))
    at = payload.index(b"colr")
    payload[at:at + 4] = b"free"  # RGB identification is solely inside the actual AV1 sequence header.
    (OUT / (name + ".avif")).write_bytes(payload)
    (OUT / (name + ".ivf")).unlink()
    if name.endswith("p3"):
        record(name, orientation=1, depth=10, assumeSrgb=True, nativeResolved="display-p3")
    else:
        rejections.append(dict(file=name + ".avif", reason="HDR", depth=10,
                               sha256=hashlib.sha256(payload).hexdigest()))


def property_bytes(path, kind):
    data = path.read_bytes()
    at = data.index(kind.encode("ascii")) - 4
    length = struct.unpack_from(">I", data, at)[0]
    return data[at:at + length]


def mux(items, properties, associations, references=None):
    ftyp = box("ftyp", b"avif\0\0\0\0avifmif1miaf")
    prefix = fullbox("hdlr", b"\0\0\0\0pict" + bytes(12) + b"\0") + fullbox("pitm", struct.pack(">H", 1))
    prefix += fullbox("iinf", struct.pack(">H", len(items)) + b"".join(
        fullbox("infe", struct.pack(">HH", item_id, 0) + kind.encode("ascii") + b"\0", 2)
        for item_id, kind, _ in items))
    ipma = struct.pack(">I", len(associations)) + b"".join(
        struct.pack(">HB", item_id, len(props)) + bytes(props) for item_id, props in associations.items())
    iprp = box("iprp", box("ipco", b"".join(properties)) + fullbox("ipma", ipma))
    iref = b""
    if references:
        iref = fullbox("iref", b"".join(box(kind, struct.pack(">HH", item_id, len(targets)) + b"".join(
            struct.pack(">H", target) for target in targets)) for kind, item_id, targets in references))

    def metadata(offset):
        locations = struct.pack(">H", len(items))
        for item_id, _, payload in items:
            locations += struct.pack(">HHHII", item_id, 0, 1, offset, len(payload))
            offset += len(payload)
        return fullbox("meta", prefix + fullbox("iloc", bytes([0x44, 0]) + locations) + iref + iprp)

    meta = metadata(0)
    meta = metadata(len(ftyp) + len(meta) + 8)
    return ftyp + meta + box("mdat", b"".join(payload for _, _, payload in items))


opaque = OUT / "opaque-444.avif"
props = [property_bytes(opaque, kind) for kind in ["ispe", "pixi", "av1C", "colr"]]
props.append(box("clap", struct.pack(">IIIIIIII", 9, 1, 7, 1, 0, 1, 0, 1)))
(OUT / "crop.avif").write_bytes(mux([(1, "av01", property_bytes(opaque, "mdat")[8:])], props, {1: [1, 2, 0x83, 4, 0x85]}))
record("crop", crop=(4, 3, 13, 10), orientation=1, depth=8, assumeSrgb=False)

tile = image.convert("RGB").resize((64, 64))
tile.save(OUT / "tile.avif", quality=100, speed=8, max_threads=1, subsampling="4:4:4")
tile_path = OUT / "tile.avif"
props = [fullbox("ispe", struct.pack(">II", 100, 100)), property_bytes(tile_path, "pixi"),
         property_bytes(tile_path, "av1C"), property_bytes(tile_path, "colr"), property_bytes(tile_path, "ispe")]
tile_data = property_bytes(tile_path, "mdat")[8:]
items = [(1, "grid", bytes([0, 0, 1, 1]) + struct.pack(">HH", 100, 100))]
items += [(item_id, "av01", tile_data) for item_id in range(2, 6)]
associations = {1: [1, 2, 4], **{item_id: [5, 2, 0x83, 4] for item_id in range(2, 6)}}
(OUT / "grid.avif").write_bytes(mux(items, props, associations, [("dimg", 1, [2, 3, 4, 5])]))
record("grid", orientation=1, depth=8, assumeSrgb=False)
(OUT / "tile.avif").unlink()

# A real AV1 image beyond libavif's optional default axis guard. The default
# Pillow reader rejects it; compare against independently known solid RGB input.
wide = Image.new("RGB", (40000, 3), (37, 89, 143))
wide.save(OUT / "native-wide-40000.avif", quality=100, speed=8, max_threads=1, subsampling="4:4:4")
wide.convert("RGBA").save(OUT / "native-wide-40000.png")
cases.append(dict(file="native-wide-40000.avif", reference="native-wide-40000.png",
                  width=40000, height=3, depth=8, orientation=1, assumeSrgb=False,
                  sha256=hashlib.sha256((OUT / "native-wide-40000.avif").read_bytes()).hexdigest(),
                  referenceKind="independent solid RGB source; allow one code value for RGB/YUV round trip"))

(OUT / "manifest.json").write_text(json.dumps(dict(
    provenance=dict(pillow=Image.__version__, libavif=features.version("avif"), reference="native built-in bilinear RGBA8 (libyuv disabled)",
                    ffmpeg=subprocess.check_output(["ffmpeg", "-version"], text=True).splitlines()[0]),
    cases=cases, rejections=rejections), indent=2) + "\n")

if "--large" in sys.argv:
    large = Image.new("RGB", (10000, 5000), (37, 89, 143))
    draw = ImageDraw.Draw(large)
    for x in range(0, 10000, 997):
        draw.rectangle((x, 0, min(x + 37, 9999), 4999), fill=(211, 47, 83))
    for y in range(0, 5000, 499):
        draw.rectangle((0, y, 9999, min(y + 23, 4999)), fill=(13, 193, 71))
    large.save(OUT / "native-50mp.avif", quality=100, speed=8, max_threads=1, subsampling="4:4:4")
    del draw, large
    reference = reference_decoder.decode(OUT / "native-50mp.avif")
    reference.save(OUT / "native-50mp.png")
    (OUT / "native-50mp.json").write_text(json.dumps(dict(
        width=reference.width, height=reference.height,
        sourceSha256=hashlib.sha256((OUT / "native-50mp.avif").read_bytes()).hexdigest(),
        rgbaSha256=hashlib.sha256(reference.tobytes()).hexdigest(),
        reference="native libavif 1.3.0 built-in bilinear RGBA8; no app codec"), indent=2) + "\n")
