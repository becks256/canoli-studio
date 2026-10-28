"""Independent continuous float palette/LUT oracle, Colour Science 0.4.6.

No editor, byte expected pixels or WASM supplies expected values. Extended sRGB
uses CSS Color 4 reflection; .cube domain/interpolation uses Colour's own LUTs.
"""
import base64, copy
from functools import lru_cache
import numpy as np
import colour
assert colour.__version__ == '0.4.6'


def encode(values):
    values = np.asarray(values, dtype=np.float64)
    a = np.abs(values)
    return np.where(a == 1, values, np.where(a <= .0031308, values * 12.92, np.copysign(1.055 * np.power(a, 1 / 2.4) - .055, values)))


def decode(values):
    values = np.asarray(values, dtype=np.float64)
    a = np.abs(values)
    return np.where(a == 1, values, np.where(a <= .04045, values / 12.92, np.copysign(np.power((a + .055) / 1.055, 2.4), values)))


@lru_cache(maxsize=4)
def table(data, dimension, size, low, high):
    values = np.frombuffer(base64.b64decode(data, validate=True), dtype='<f4').astype(np.float64)
    assert values.size == 3 * (size if dimension == 1 else size ** 3) and np.isfinite(values).all()
    domain = np.array([low, high], dtype=np.float64)
    if dimension == 1:
        samples = values.reshape(size, 3)
        lut = colour.LUT3x1D(samples, domain=domain)
        expected = np.linspace(domain[0], domain[1], size)
    else:
        samples = values.reshape(size, size, size, 3).transpose(2, 1, 0, 3)
        lut = colour.LUT3D(samples, domain=domain)
        expected = colour.LUT3D.linear_table(size=size) * (domain[1] - domain[0]) + domain[0]
    return lut, np.array_equal(samples, expected)


def adjust(pixels, settings):
    assert pixels.dtype == np.float32 and pixels.shape[-1] == 4 and np.isfinite(pixels).all()
    assert np.all((pixels[..., 3] >= 0) & (pixels[..., 3] <= 1))
    output = pixels.copy()
    rgb = encode(pixels[..., :3])
    if settings['kind'] == 'gradient-map':
        stops = settings['stops']
        positions = [row['position'] for row in stops]
        palette = np.array([[int(row['color'][at:at+2], 16) / 255 for at in [1, 3, 5]] for row in stops])
        luma = .2126 * rgb[..., 0] + .7152 * rgb[..., 1] + .0722 * rgb[..., 2]
        if settings['reverse']:
            luma = 1 - luma
        mapped = np.stack([np.interp(luma, positions, palette[:, c]) for c in range(3)], axis=-1)
    else:
        assert settings['kind'] == 'lut'
        if settings['amount'] == 0:
            return output
        spec = settings['lut']
        lut, identity = table(spec['data'], spec['dimension'], spec['size'], tuple(spec['domainMin']), tuple(spec['domainMax']))
        clipped = np.clip(rgb, lut.domain[0], lut.domain[1])
        options = {} if spec['dimension'] == 1 else {'interpolator': getattr(colour.algebra, 'table_interpolation_' + settings['interpolation'])}
        transformed = lut.apply(clipped, **options)
        weight = settings['amount'] / 100
        mapped = (1 - weight) * rgb + weight * transformed
    with np.errstate(over='ignore', invalid='ignore'):
        output[..., :3] = decode(mapped).astype(np.float32)
    assert np.isfinite(output).all(), 'Expected output overflows finite float32.'
    if settings['kind'] == 'lut' and identity:
        inside = (rgb >= lut.domain[0]) & (rgb <= lut.domain[1])
        output[..., :3][inside] = pixels[..., :3][inside]
    return output


def render(source, layers, origin=(0, 0)):
    from float_clipping_reference import render as compose
    from float_transfer_reference import adjust as transfer
    from float_white_balance_reference import balance
    from float_color_reference import adjust as color
    from float_blend_reference import color as blend
    captured = copy.deepcopy(layers)
    modes = {}
    def prepare(nodes):
        for node in nodes:
            if node['kind'] == 'group':
                assert node.get('blendMode', 'normal') in ['normal', 'pass-through']
                prepare(node['children'])
            elif node['kind'] == 'adjustment':
                node['adjustment'] = copy.deepcopy(node['adjustment'])
                modes[id(node['adjustment'])] = node.get('blendMode', 'normal')
            else:
                assert node.get('blendMode', 'normal') == 'normal'
    prepare(captured)
    def effect(pixels, settings):
        kind = settings['kind']
        result = adjust(pixels, settings) if kind in ['gradient-map', 'lut'] else color(pixels, settings) if kind in ['hsl', 'color-balance', 'vibrance'] else balance(pixels, settings) if kind == 'white-balance' else transfer(pixels, settings)
        mode = modes[id(settings)]
        if mode != 'normal':
            result[..., :3] = blend(pixels[..., :3], result[..., :3], mode).astype(np.float32)
        return result
    return compose(source, captured, origin=origin, transfer=effect)
