"""Independent raster-mask PSD/PSB files and explicit source-grid references.

Uses released psd-tools 1.10.9/Pillow/NumPy, never Canoli's parser or renderer.
References implement documented coverage/bounds, not a Photoshop desktop claim.
"""
import gc
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from psd_tools import PSDImage, __version__
from psd_tools.api.layers import PixelLayer
from psd_tools.constants import ChannelID, Compression, Tag
from psd_tools.psd.layer_and_mask import ChannelData, ChannelInfo, MaskData, MaskFlags, MaskParameters
from psd_tools.psd.vector import VectorMaskSetting, Path as VectorPath, InitialFillRule

target = Path('tests/fixtures/psd/masks')
target.mkdir(exist_ok=True)
cases = []
digest = lambda data: hashlib.sha256(data).hexdigest()


def save(name, compression, background=0, relative=False, inverted=False,
         disabled=False, density=255, feather=0, empty=False, large=False, wide=False):
    if large:
        source = Image.open('tests/fixtures/psd/native-50mp.png').convert('RGBA')
        width, height = source.size
        left = top = mask_left = mask_top = 0
        mw, mh = width, height
        y = np.arange(height, dtype='uint32')[:, None]
        x = np.arange(width, dtype='uint32')[None, :]
        coverage = np.where(((x // 127 + y // 89) % 5) == 0, 0, 255).astype('uint8')
    elif wide:
        width, height, left, top = 100000, 3, 0, 0
        source = Image.new('RGBA', (width, height), (0, 0, 0, 255))
        mask_left = mask_top = 0
        mw, mh = width, height
        coverage = np.where(np.arange(width)[None, :] % 11 < 6, 255, 0).astype('uint8')
        coverage = np.broadcast_to(coverage, (height, width)).copy()
    else:
        width, height, left, top = 31, 23, 4, 5
        source = Image.new('RGBA', (19, 13), (0, 0, 0, 255))
        mask_left, mask_top = (4, 3) if relative else (8, 8)
        mw, mh = (0, 0) if empty else (7, 5)
        coverage = ((np.arange(mw)[None, :] + np.arange(mh)[:, None] * 2) % 6 * 51).astype('uint8')

    document = PSDImage.frompil(Image.new('RGBA', (width, height)), compression=compression)
    layer = PixelLayer.frompil(source, document, layer_name='Native raster mask', top=top, left=left, compression=compression)
    flags = MaskFlags(pos_relative_to_layer=relative, mask_disabled=disabled, invert_mask=inverted,
                      parameters_applied=(density != 255 or feather != 0))
    parameters = MaskParameters(user_mask_density=density if density != 255 else None,
                                user_mask_feather=feather if feather else None) if flags.parameters_applied else None
    layer._record.mask_data = MaskData(top=mask_top, left=mask_left, bottom=mask_top+mh, right=mask_left+mw,
                                      background_color=background, flags=flags, parameters=parameters)
    if not empty:
        channel = ChannelData(compression=compression)
        channel.set_data(coverage.tobytes(), mw, mh, 8, version=document.version)
        layer._channels.append(channel)
        layer._record.channel_info.append(ChannelInfo(id=ChannelID.USER_LAYER_MASK, length=len(channel.data)+2))
    document.append(layer)
    document._update_record()
    document._record.layer_and_mask_information.layer_info.layer_count = -1

    # A reference built from source bytes and independent native-grid coverage.
    alpha = np.full((height, width), background, dtype='uint8')
    world_x, world_y = mask_left + (left if relative else 0), mask_top + (top if relative else 0)
    if not empty:
        alpha[world_y:world_y+mh, world_x:world_x+mw] = coverage
    if inverted:
        alpha = 255 - alpha
    if feather:
        alpha = np.asarray(Image.fromarray(alpha, 'L').filter(ImageFilter.GaussianBlur(feather)))
    alpha = np.floor(255 - (255-alpha.astype('float64')) * density/255 + .5).astype('uint8')
    if disabled:
        alpha.fill(255)
    output = np.zeros((height, width, 4), dtype='uint8')
    output[top:top+source.height, left:left+source.width] = np.asarray(source)
    output[:, :, 3] = (output[:, :, 3].astype('uint16') * alpha // 255).astype('uint8')
    output[output[:, :, 3] == 0, :3] = 0
    reference = Image.fromarray(output, 'RGBA')
    matte = output[:, :, :3].astype('uint16') * output[:, :, 3:4] // 255 + (255-output[:, :, 3:4])
    document._record.image_data.set_data([matte[:, :, i].astype('uint8').tobytes() for i in range(3)] + [output[:, :, 3].tobytes()], document._record.header)
    path = target / (name + ('.psb' if document.version == 2 else '.psd'))
    with path.open('wb') as file:
        document._record.write(file)
    reference.save(path.with_suffix('.png'))
    source.save(path.with_name(path.stem + '-source.png'))
    reopened = PSDImage.open(path)
    assert reopened[0].topil().convert('RGBA').tobytes() == source.tobytes()
    if not empty:
        assert reopened[0].mask.topil().tobytes() == coverage.tobytes()
    cases.append(dict(file=path.name, reference=path.with_suffix('.png').name, source=path.stem+'-source.png',
                      width=width, height=height, layerLeft=left, layerTop=top, layerWidth=source.width, layerHeight=source.height,
                      maskLeft=mask_left, maskTop=mask_top, maskWidth=mw, maskHeight=mh, background=background,
                      relative=relative, inverted=inverted, disabled=disabled, density=density, feather=feather, empty=empty,
                      compression=int(compression), sha256=digest(path.read_bytes()), rgbaSha256=digest(reference.tobytes()),
                      sourceRgbaSha256=digest(source.tobytes()), coverageSha256=digest(coverage.tobytes()),
                      referenceSha256=digest(path.with_suffix('.png').read_bytes())))
    print(path, path.stat().st_size, flush=True)


for args in [
    ('black-raw', Compression.RAW, {}),
    ('white-rle', Compression.RLE, dict(background=255)),
    ('white-zip', Compression.ZIP, dict(background=255)),
    ('relative-prediction', Compression.ZIP_WITH_PREDICTION, dict(relative=True)),
    ('inverted-raw', Compression.RAW, dict(inverted=True)),
    ('disabled-rle', Compression.RLE, dict(disabled=True)),
    ('density-zip', Compression.ZIP, dict(background=255, density=153)),
    ('empty-black', Compression.RAW, dict(empty=True)),
    ('feather-merged', Compression.ZIP, dict(feather=2)),
    ('wide-mask', Compression.ZIP_WITH_PREDICTION, dict(wide=True)),
]:
    save(args[0], args[1], **args[2])
gc.collect()
save('native-50mp-mask', Compression.ZIP, background=255, large=True)

# A standalone vector mask has no basic raster-mask record. Its empty initial
# fill is a valid fully hidden shape; the merged reference is transparent.
vector_reference = Image.new('RGBA', (31, 23), (0, 0, 0, 0))
vector_document = PSDImage.frompil(vector_reference, compression=Compression.ZIP)
vector_layer = PixelLayer.frompil(Image.new('RGBA', (19, 13), (0, 0, 0, 255)), vector_document,
                                  layer_name='Standalone vector mask', top=5, left=4, compression=Compression.ZIP)
vector_layer._record.tagged_blocks.set_data(Tag.VECTOR_MASK_SETTING1,
    version=3, flags=0, path=VectorPath([InitialFillRule(0)]))
vector_document.append(vector_layer)
vector_document._update_record()
vector_document._record.layer_and_mask_information.layer_info.layer_count = -1
white = b'\xff' * (31 * 23)
vector_document._record.image_data.set_data([white, white, white, b'\0' * (31 * 23)], vector_document._record.header)
vector_path = target/'vector-only.psd'
with vector_path.open('wb') as file:
    vector_document._record.write(file)
vector_reference.save(vector_path.with_suffix('.png'))
vector_reopened = PSDImage.open(vector_path)
assert vector_reopened[0].vector_mask is not None and vector_reopened[0].mask is None
vector_cases = [dict(file=vector_path.name, reference='vector-only.png',
    sha256=digest(vector_path.read_bytes()), rgbaSha256=digest(vector_reference.tobytes()),
    referenceSha256=digest(vector_path.with_suffix('.png').read_bytes()))]
print(vector_path, vector_path.stat().st_size, flush=True)
(target/'manifest.json').write_text(json.dumps(dict(generator='psd-tools', version=__version__,
    notes='Reference RGBA is independently computed from source bytes, declared mask plane/bounds/default/inversion/density. Relative placement follows Adobe bit 0. Feather/vector fixtures verify explicit layered rejection and the supplied merged fallback, not Photoshop reconstruction equivalence. Full desktop/color/linkage parity is not claimed.', cases=cases, vectors=vector_cases), indent=2)+'\n')
