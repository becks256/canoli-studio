"""Independent NumPy appearance oracle; no application/WASM/display pixels.

sRGB selector coordinates use continuous transfer functions. Overlay colors mix
in linear light. Coverage is separate from alpha, including adjustment layers.
"""
import numpy as np
from float_clipping_reference import interpolate, tone
from float_blend_reference import color as blend_color

def over(source, backdrop, opacity=1., mask=None, mode='normal'):
    s, b = source.astype(np.float64), backdrop.astype(np.float64)
    sa = s[..., 3] * opacity * (1. if mask is None else mask.astype(np.float64))
    ba = b[..., 3]
    alpha = sa + ba * (1-sa)
    mixed = s[..., :3] if mode == 'normal' else blend_color(b[..., :3], s[..., :3], mode)
    numerator = (sa*(1-ba))[..., None]*s[..., :3] + (sa*ba)[..., None]*mixed + ((1-sa)*ba)[..., None]*b[..., :3]
    rgb = np.divide(numerator, alpha[..., None], out=np.zeros_like(numerator), where=alpha[..., None]>0)
    result = np.concatenate([rgb, alpha[..., None]], axis=-1).astype(np.float32)
    result[sa==0] = backdrop[sa==0]
    return result


def appearance(pixels, backdrop, style):
    result = pixels.copy()
    overlay = style['colorOverlay']
    amount = overlay['opacity'] if overlay['enabled'] else 0
    if amount:
        rgb = np.array([int(overlay['color'][at:at+2], 16) / 255 for at in [1, 3, 5]], dtype=np.float64)
        rgb = np.where(rgb <= .04045, rgb / 12.92, ((rgb + .055) / 1.055) ** 2.4)
        result[..., :3] = ((1 - amount) * pixels[..., :3].astype(np.float64) + amount * rgb).astype(np.float32)
    blend = style['blendIf']
    coverage = np.ones(pixels.shape[:-1], dtype=np.float32)
    if blend['enabled']:
        def coordinate(values):
            rgb = np.clip(values[..., :3].astype(np.float64), 0, 1)
            encoded = np.where(rgb <= .0031308, 12.92 * rgb, 1.055 * rgb ** (1 / 2.4) - .055) * 255
            encoded[rgb == 1] = 255
            if blend['channel'] == 'luminance':
                return np.clip(encoded[..., 0] * .2126 + encoded[..., 1] * .7152 + encoded[..., 2] * .0722, 0, 255)
            return encoded[..., ['red', 'green', 'blue'].index(blend['channel'])]
        def ramp(values, handles):
            a, b, c, d = handles
            low = np.clip((values - a) / (b - a), 0, 1) if b != a else np.ones_like(values)
            high = np.clip((d - values) / (d - c), 0, 1) if d != c else np.ones_like(values)
            return np.where((values >= a) & (values <= d), np.minimum(low, high), 0)
        coverage = (ramp(coordinate(result), blend['source']) * ramp(coordinate(backdrop), blend['underlying'])).astype(np.float32)
    return result, coverage


def render(source, layers, origin=(0, 0)):
    height, width = source.shape[:2]
    empty = lambda: np.zeros_like(source)
    def mask(layer):
        spec = layer.get('mask')
        if spec is None:
            return None
        x, y, w, h = spec['rect']
        raw = np.broadcast_to((np.arange(width)[None, :] + origin[0] >= x) & (np.arange(width)[None, :] + origin[0] < x+w) &
                              (np.arange(height)[:, None] + origin[1] >= y) & (np.arange(height)[:, None] + origin[1] < y+h), (height, width))
        if spec.get('inverted', False):
            raw = ~raw
        density = spec.get('density', 1.)
        return (np.floor(((1-density) + density*raw) * 255 + .5) / 255).astype(np.float32)
    def raster(layer, parent):
        dx, dy = parent[0]+layer.get('x', 0), parent[1]+layer.get('y', 0)
        assert dx == int(dx) and dy == int(dy)
        if origin != (0, 0):
            assert dx == dy == 0, 'Streaming reference requires native placement.'
        values = source.copy()
        for effect in layer.get('tones', []):
            values = tone(values, effect)
        values[values[..., 3] == 0, :3] = 0
        result = empty()
        left, right, top, bottom = max(0, dx), min(width, width+dx), max(0, dy), min(height, height+dy)
        if right > left and bottom > top:
            result[top:bottom, left:right] = values[top-dy:bottom-dy, left-dx:right-dx]
        return result
    def stacks(nodes, flat):
        rows = []
        for node in nodes:
            if flat or not node.get('clipped', False):
                rows.append((node, []))
            elif rows and rows[-1][0]['kind'] != 'adjustment':
                rows[-1][1].append(node)
        return rows
    def styled(node, pixels, backdrop, coverage):
        if 'styles' not in node:
            return pixels, coverage
        pixels, gate = appearance(pixels, backdrop, node['styles'])
        if node['styles']['blendIf']['enabled']:
            coverage = gate if coverage is None else (gate.astype(np.float64) * coverage.astype(np.float64)).astype(np.float32)
        return pixels, coverage
    def paint(nodes, initial, parent=(0, 0), flat=False):
        backdrop = initial
        for node, members in stacks(nodes, flat):
            if not node.get('visible', True) or node.get('opacity', 1) == 0:
                continue
            members = [m for m in members if m.get('visible', True) and m.get('opacity', 1) > 0]
            world = parent[0]+node.get('x', 0), parent[1]+node.get('y', 0)
            coverage, opacity, fill = mask(node), node.get('opacity', 1), node.get('fillOpacity', 1)
            if members:
                raw = raster(node, parent) if node['kind'] == 'raster' else paint(node['children'], empty(), world)
                shape = raw[..., 3].copy()
                raw[..., 3] = np.where(shape > 0, fill, 0).astype(np.float32)
                raw[shape == 0, :3] = 0
                pixels = paint(members, raw, parent, True)
                pixels[..., 3] = (pixels[..., 3].astype(np.float64) * shape.astype(np.float64)).astype(np.float32)
                pixels[pixels[..., 3] == 0, :3] = 0
                pixels, coverage = styled(node, pixels, backdrop, coverage)
                backdrop = over(pixels, backdrop, opacity, coverage, node.get('blendMode', 'normal'))
            elif node['kind'] == 'group' and node.get('blendMode') == 'pass-through':
                assert 'styles' not in node
                backdrop = interpolate(backdrop, paint(node['children'], backdrop.copy(), world), opacity, coverage)
            elif node['kind'] == 'adjustment':
                pixels, coverage = styled(node, tone(backdrop, node.get('tone', {})), backdrop, coverage)
                if node.get('blendMode', 'normal') != 'normal':
                    pixels[..., :3] = blend_color(backdrop[..., :3], pixels[..., :3], node['blendMode']).astype(np.float32)
                backdrop = interpolate(backdrop, pixels, opacity*fill, coverage)
            else:
                raw = raster(node, parent) if node['kind'] == 'raster' else paint(node['children'], empty(), world)
                pixels, coverage = styled(node, raw, backdrop, coverage)
                backdrop = over(pixels, backdrop, opacity*fill, coverage, node.get('blendMode', 'normal'))
        return backdrop
    return paint(layers, empty())
