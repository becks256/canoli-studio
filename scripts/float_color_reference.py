"""Independent continuous sRGB-control reference over straight linear floats.

HSL uses Python's colorsys conversion, not the application's sector algorithm.
Balance/vibrance use NumPy and the declared encoded-luma/SetLum control model.
No application, WASM, GPU, byte LUT or display pixels supply expected values.
"""
import colorsys
import copy
import numpy as np


def neutral(settings):
    kind = settings['kind']
    if kind == 'hsl':
        return all(settings[k] == 0 for k in ['hue', 'saturation', 'lightness'])
    if kind == 'vibrance':
        return settings['vibrance'] == settings['saturation'] == 0
    assert kind == 'color-balance'
    return all(settings[band][c] == 0 for band in ['shadows', 'midtones', 'highlights'] for c in ['red', 'green', 'blue'])


def encode(rgb):
    return np.where(rgb <= .0031308, 12.92 * rgb, 1.055 * np.power(rgb, 1 / 2.4) - .055)


def decode(rgb):
    return np.where(rgb <= .04045, rgb / 12.92, np.power((rgb + .055) / 1.055, 2.4))


def luma(rgb):
    return rgb[..., 0] * .3 + rgb[..., 1] * .59 + rgb[..., 2] * .11


def set_luma(rgb, wanted):
    value = rgb + (wanted - luma(rgb))[..., None]
    low = np.min(value, axis=-1)
    high = np.max(value, axis=-1)
    selected = low < 0
    value[selected] = wanted[selected, None] + (value[selected] - wanted[selected, None]) * (wanted[selected] / (wanted[selected] - low[selected]))[:, None]
    selected = high > 1
    value[selected] = wanted[selected, None] + (value[selected] - wanted[selected, None]) * ((1 - wanted[selected]) / (high[selected] - wanted[selected]))[:, None]
    return value


def hls_vector(rgb, settings):
    """Array form of colorsys' HLS equations; independent of sector c/x math."""
    high = np.max(rgb, axis=-1)
    low = np.min(rgb, axis=-1)
    delta = high - low
    light = (high + low) / 2
    total = np.where(light <= .5, high + low, 2 - high - low)
    saturation = np.divide(delta, total, out=np.zeros_like(delta), where=delta != 0)
    rc = np.divide(high - rgb[..., 0], delta, out=np.zeros_like(delta), where=delta != 0)
    gc = np.divide(high - rgb[..., 1], delta, out=np.zeros_like(delta), where=delta != 0)
    bc = np.divide(high - rgb[..., 2], delta, out=np.zeros_like(delta), where=delta != 0)
    hue = np.mod(np.where(rgb[..., 0] == high, bc - gc, np.where(rgb[..., 1] == high, 2 + rc - bc, 4 + gc - rc)) / 6, 1)
    hue = np.where(delta == 0, 0, np.mod(hue + settings['hue'] / 360, 1))
    amount = settings['saturation'] / 100
    if amount < 0:
        saturation = saturation * (1 + amount)
    else:
        saturation = np.where(delta == 0, 0, saturation + (1 - saturation) * amount)
    amount = settings['lightness'] / 100
    light = light * (1 + amount) if amount < 0 else light + (1 - light) * amount
    upper = np.where(light <= .5, light * (1 + saturation), light + saturation - light * saturation)
    lower = 2 * light - upper
    def channel(offset):
        h = np.mod(hue + offset, 1)
        return np.where(h < 1 / 6, lower + (upper - lower) * h * 6,
                        np.where(h < .5, upper,
                                 np.where(h < 2 / 3, lower + (upper - lower) * (2 / 3 - h) * 6, lower)))
    return np.stack([channel(1 / 3), channel(0), channel(-1 / 3)], axis=-1)


def adjust(pixels, settings, scalar_hls=False):
    output = pixels.copy()
    if neutral(settings):
        return output
    original = pixels[..., :3].astype(np.float64)
    assert np.all((original >= 0) & (original <= 1)), 'Active color controls require normalized linear RGB'
    rgb = encode(original)
    if settings['kind'] == 'hsl' and not scalar_hls:
        values = hls_vector(rgb, settings)
    elif settings['kind'] == 'hsl':
        def shift(value, amount):
            return value * (1 + amount) if amount < 0 else value + (1 - value) * amount
        rows = []
        for color in rgb.reshape(-1, 3):
            h, l, s = colorsys.rgb_to_hls(*color)
            if max(color) != min(color):
                h = (h + settings['hue'] / 360) % 1
                s = shift(s, settings['saturation'] / 100)
            l = shift(l, settings['lightness'] / 100)
            rows.append(colorsys.hls_to_rgb(h, l, s))
        values = np.array(rows, dtype=np.float64).reshape(rgb.shape)
    elif settings['kind'] == 'color-balance':
        lum = luma(rgb)
        shadows = np.maximum(0, 1 - 2 * lum)
        highlights = np.maximum(0, 2 * lum - 1)
        weights = [shadows, 1 - shadows - highlights, highlights]
        values = rgb.copy()
        for c, channel in enumerate(['red', 'green', 'blue']):
            values[..., c] += sum(settings[band][channel] * weight for band, weight in zip(['shadows', 'midtones', 'highlights'], weights)) / 100
        if settings['preserveLuminosity']:
            values = set_luma(values, lum)
    else:
        assert settings['kind'] == 'vibrance'
        lum = luma(rgb)
        chroma = np.max(rgb, axis=-1) - np.min(rgb, axis=-1)
        scale = np.maximum(0, 1 + (settings['saturation'] + settings['vibrance'] * (1 - chroma)) / 100)
        values = set_luma(lum[..., None] + (rgb - lum[..., None]) * scale[..., None], lum)
    output[..., :3] = decode(np.clip(values, 0, 1)).astype(np.float32)
    # A hue/saturation-only edit leaves truly achromatic values unchanged.
    if settings['kind'] == 'hsl' and settings['lightness'] == 0:
        gray = (original[..., 0] == original[..., 1]) & (original[..., 1] == original[..., 2])
        output[gray] = pixels[gray]
    assert np.isfinite(output).all()
    return output


def render(source, layers, origin=(0, 0)):
    from float_clipping_reference import render as compose
    from float_transfer_reference import adjust as transfer
    from float_white_balance_reference import balance
    from float_blend_reference import color as blend_color
    captured = copy.deepcopy(layers)
    modes = {}
    def prepare(nodes):
        for node in nodes:
            if node['kind'] == 'group':
                assert node.get('blendMode', 'normal') in ['normal', 'pass-through']
                prepare(node['children'])
            elif node['kind'] == 'adjustment' and 'adjustment' in node:
                node['adjustment'] = copy.deepcopy(node['adjustment'])
                modes[id(node['adjustment'])] = node.get('blendMode', 'normal')
            else:
                assert node.get('blendMode', 'normal') == 'normal'
    prepare(captured)
    def effect(pixels, settings):
        kind = settings['kind']
        result = adjust(pixels, settings) if kind in ['hsl', 'color-balance', 'vibrance'] else balance(pixels, settings) if kind == 'white-balance' else transfer(pixels, settings)
        mode = modes[id(settings)]
        if mode != 'normal':
            result[..., :3] = blend_color(pixels[..., :3], result[..., :3], mode).astype(np.float32)
        return result
    return compose(source, captured, origin=origin, transfer=effect)
