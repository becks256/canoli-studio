"""Independent PSD/PSB ZIP inputs, using released psd-tools codecs only.

Run with a separate psd-tools 1.10.9 / Pillow / NumPy environment.
Canoli's parser, encoder and predictor are never imported.
"""
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image
from psd_tools import PSDImage, __version__
from psd_tools.api.layers import PixelLayer
from psd_tools.constants import Compression

target = Path('tests/fixtures/psd/zip')
target.mkdir(exist_ok=True)
cases = []
digest = lambda data: hashlib.sha256(data).hexdigest()


def save(name, image, compression, layered=True, signaled_alpha=False):
    document = PSDImage.frompil(image, compression=compression)
    if layered:
        layer = PixelLayer.frompil(image, document, layer_name='Independent ZIP pixels', compression=compression)
        document.append(layer)
        document._update_record()
    # Write explicit input planes with the independent codec; prevent automatic
    # high-level recomposition from changing the reference on save.
    planes = [channel.tobytes() for channel in image.split()]
    if signaled_alpha:
        document._record.layer_and_mask_information.layer_info.layer_count *= -1
        alpha = np.asarray(image.getchannel('A')).astype('uint32')
        for i in range(len(planes) - 1):
            color = np.asarray(image.getchannel(i)).astype('uint32')
            planes[i] = ((color * alpha + 255 * (255 - alpha)) // 255).astype('uint8').tobytes()
    document._record.image_data.set_data(planes, document._record.header)
    extension = '.psb' if document._record.header.version == 2 else '.psd'
    path = target / (name + extension)
    with path.open('wb') as file:
        document._record.write(file)
    reference = image.convert('RGBA')
    reference.save(path.with_suffix('.png'))
    # Independently reopen and decode every channel, including wide PSB rows.
    reopened = PSDImage.open(path)
    assert reopened._record.image_data.get_data(reopened._record.header) == planes
    if layered:
        assert reopened[0].topil().convert('RGBA').tobytes() == reference.tobytes()
    cases.append(dict(file=path.name, reference=path.with_suffix('.png').name,
                      width=image.width, height=image.height, layers=int(layered),
                      mode=image.mode, compression=int(compression),
                      signaledAlpha=signaled_alpha, sha256=digest(path.read_bytes()),
                      referenceSha256=digest(path.with_suffix('.png').read_bytes()),
                      rgbaSha256=digest(reference.tobytes())))
    print(path, path.stat().st_size, flush=True)


for label, compression in [('zip', Compression.ZIP), ('prediction', Compression.ZIP_WITH_PREDICTION)]:
    x = np.arange(17, dtype='uint32')[None, :]
    y = np.arange(11, dtype='uint32')[:, None]
    alpha = np.broadcast_to(((x + y) % 4) * 85, (11, 17)).astype('uint8')
    rgb = np.stack([np.broadcast_to(x * 13 % 86 * 3, (11, 17)),
                    np.broadcast_to(y * 19 % 86 * 3, (11, 17)),
                    (x * 7 + y * 11) % 86 * 3], axis=-1).astype('uint8')
    rgb[alpha == 0] = 0
    save('rgba-' + label, Image.fromarray(np.dstack([rgb, alpha]), 'RGBA'), compression, signaled_alpha=True)
    gray = ((x * 17 + y * 31) % 86 * 3).astype('uint8')
    save('gray-' + label, Image.fromarray(gray, 'L'), compression)
    gray[alpha == 0] = 0
    save('gray-alpha-' + label, Image.fromarray(np.dstack([gray, alpha]), 'LA'), compression, signaled_alpha=True)
    width = 100000
    x = np.arange(width, dtype='uint32')[None, :]
    y = np.arange(3, dtype='uint32')[:, None]
    rgb = np.stack([np.broadcast_to(x * 37 % 256, (3, width)),
                    (x * 19 + y * 11) % 256, (x * 11 + y * 23) % 256], axis=-1).astype('uint8')
    save('wide-' + label, Image.fromarray(rgb, 'RGB'), compression)

save('native-50mp-zip', Image.open('tests/fixtures/psd/native-50mp.png').convert('RGB'), Compression.ZIP, layered=False)
(target / 'manifest.json').write_text(json.dumps(dict(generator='psd-tools', version=__version__,
    notes='8-bit independent source planes; signaled merged alpha is white-matted with exactly reversible multiples-of-three samples. Original alpha-zero RGB is zero. PNG references contain original unassociated RGBA.',
    cases=cases), indent=2) + '\n')
