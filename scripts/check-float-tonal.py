"""Independent NumPy reference for native linear exposure and layer mixing."""
import argparse
import gzip
import json
from pathlib import Path
import numpy as np


def reference(source, coverage, options):
    rgb = source[:, :3].astype(np.float64)
    luminance = np.clip(rgb @ np.array([.2126, .7152, .0722]), 0, 1)
    weight = {'shadows': 1 - luminance,
              'midtones': 4 * luminance * (1 - luminance),
              'highlights': luminance}[options['range']]
    stops = (2 if options['mode'] == 'dodge' else -2) * options['exposure'] * options.get('flow', 1)
    gain = np.exp2(stops * coverage.astype(np.float64) * weight)
    if options.get('protectTones', True):
        peak = rgb.max(axis=1)
        positive = peak > 0
        gain[positive] = np.minimum(gain[positive], np.maximum(1., 1. / peak[positive]))
    result = source.copy()
    active = (source[:, 3] != 0) & (coverage != 0) & (gain != 1)
    result[active, :3] = (rgb[active] * gain[active, None]).astype('<f4')
    return result


def read(path, channels):
    data = Path(path).read_bytes()
    if str(path).endswith('.gz'):
        data = gzip.decompress(data)
    return np.frombuffer(data, dtype='<f4').reshape(-1, channels).copy()


def interpolate(before, after, amount):
    amount = np.broadcast_to(amount, (len(before),)).astype(np.float64)
    result = before.copy()
    whole = amount == 1
    result[whole] = after[whole]
    partial = (amount > 0) & (amount < 1)
    a = before[partial, 3].astype(np.float64) * (1 - amount[partial])
    b = after[partial, 3].astype(np.float64) * amount[partial]
    alpha = a + b
    rgb = np.zeros((len(alpha), 3), dtype=np.float64)
    present = alpha > 0
    rgb[present] = (before[partial, :3][present].astype(np.float64) * a[present, None] +
                    after[partial, :3][present].astype(np.float64) * b[present, None]) / alpha[present, None]
    result[partial, :3] = rgb.astype('<f4')
    result[partial, 3] = alpha.astype('<f4')
    return result


def rect_scene(source, spec, origin=(0, 0)):
    """A solid brush clipped to explicit integer document rectangles."""
    height, width, _ = source.shape
    before = source.reshape(-1, 4).copy()
    result = before.copy()
    xx = np.tile(np.arange(width) + origin[0], height)
    yy = np.repeat(np.arange(height) + origin[1], width)
    for stroke in spec['strokes']:
        x, y, w, h = stroke['rect']
        coverage = (((xx >= x) & (xx < x + w) & (yy >= y) & (yy < y + h)) *
                    stroke.get('coverage', 1)).astype('<f4')
        result = reference(result, coverage, stroke['options'])
    return interpolate(before, result, spec.get('opacity', 1)).reshape(source.shape)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('record')
    args = parser.parse_args()
    spec = json.loads(Path(args.record).read_text())
    before = read(spec['before'], 4)
    expected = before.copy()
    for stroke in spec['strokes']:
        expected = reference(expected, read(stroke['coverage'], 1).reshape(-1), stroke['options'])
    amount = np.full(len(before), spec.get('opacity', 1), dtype=np.float64)
    if 'mask' in spec:
        x, y, width, height = spec['mask']
        xx = np.arange(len(before)) % spec['width']
        yy = np.arange(len(before)) // spec['width']
        amount *= (xx >= x) & (xx < x + width) & (yy >= y) & (yy < y + height)
    expected = interpolate(before, expected, amount)
    expected = interpolate(before, expected, spec.get('groupOpacity', 1))
    actual = read(spec['actual'], 4)
    assert actual.shape == before.shape and np.isfinite(actual).all()
    maximum = float(np.max(np.abs(actual[:, :3].astype(np.float64) - expected[:, :3]) /
                           np.maximum(1, np.abs(expected[:, :3]))))
    alpha_differences = int(np.count_nonzero(actual[:, 3].view('<u4') != before[:, 3].view('<u4')))
    assert maximum <= 2**-22, maximum
    assert alpha_differences == 0, alpha_differences
    print(json.dumps(dict(samples=int(actual.size), maximumRelativeColorError=maximum,
                          alphaWordsDifferent=alpha_differences, tolerance=2**-22)))
