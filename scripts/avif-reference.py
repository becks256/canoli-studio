"""Independent libavif 1.3 ABI reference decoder used only to generate fixtures.

Uses the native library bundled with Pillow, explicit built-in bilinear YUV
conversion and unassociated RGBA8. Pillow's default RGB/libyuv path is retained
as a separate viewer reference; it is not a bit-exact reconstruction oracle.
ABI: https://github.com/AOMediaCodec/libavif/blob/v1.3.0/include/avif/avif.h
"""
import ctypes as C
from pathlib import Path
import PIL
from PIL import Image


class RGB(C.Structure):
    _fields_ = [(name, C.c_uint32 if name in {"width", "height", "depth"} else C.c_int)
                for name in ["width", "height", "depth", "format", "chromaUpsampling",
                             "chromaDownsampling", "avoidLibYUV", "ignoreAlpha",
                             "alphaPremultiplied", "isFloat", "maxThreads"]] + [
                ("pixels", C.c_void_p), ("rowBytes", C.c_uint32)]


library = next((Path(PIL.__file__).parent.parent / "pillow.libs").glob("libavif-*.so*"))
avif = C.CDLL(str(library))
avif.avifVersion.restype = C.c_char_p
assert avif.avifVersion().decode() == "1.3.0", "Reference ABI requires libavif 1.3.0"
for name in ["avifImageCreateEmpty", "avifDecoderCreate"]:
    getattr(avif, name).restype = C.c_void_p
for name in ["avifImageDestroy", "avifDecoderDestroy"]:
    getattr(avif, name).argtypes = [C.c_void_p]
avif.avifDecoderReadMemory.argtypes = [C.c_void_p, C.c_void_p, C.c_void_p, C.c_size_t]
avif.avifRGBImageSetDefaults.argtypes = [C.POINTER(RGB), C.c_void_p]
avif.avifRGBImageAllocatePixels.argtypes = [C.POINTER(RGB)]
avif.avifRGBImageFreePixels.argtypes = [C.POINTER(RGB)]
avif.avifImageYUVToRGB.argtypes = [C.c_void_p, C.POINTER(RGB)]


def decode(path):
    payload = path.read_bytes()
    decoder, image, rgb = avif.avifDecoderCreate(), avif.avifImageCreateEmpty(), RGB()
    try:
        assert avif.avifDecoderReadMemory(decoder, image, payload, len(payload)) == 0
        avif.avifRGBImageSetDefaults(C.byref(rgb), image)
        rgb.depth, rgb.format = 8, 1  # RGBA
        rgb.chromaUpsampling, rgb.avoidLibYUV = 4, 1  # bilinear, scalar reference
        assert avif.avifRGBImageAllocatePixels(C.byref(rgb)) == 0
        assert avif.avifImageYUVToRGB(image, C.byref(rgb)) == 0
        data = C.string_at(rgb.pixels, rgb.height * rgb.rowBytes)
        return Image.frombytes("RGBA", (rgb.width, rgb.height), data, "raw", "RGBA", rgb.rowBytes)
    finally:
        avif.avifRGBImageFreePixels(C.byref(rgb))
        avif.avifImageDestroy(image)
        avif.avifDecoderDestroy(decoder)
