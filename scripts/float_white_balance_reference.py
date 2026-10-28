"""Independent float White Balance oracle for the registered reference corpus.

Matrices come from Colour Science's Kang/Bradford implementation and a numerical
tint tangent, not application coefficients. The lookup deliberately admits only
registered fixture parameters; it is not a production white-balance API.
"""
from pathlib import Path
import json
import numpy as np
from float_clipping_reference import render as compose
from float_transfer_reference import adjust as transfer

root = Path(__file__).resolve().parents[1]
matrix_path = root / 'tests/fixtures/white-balance-reference.json'
matrices = {(r['temperature'], r['tint']): np.array(r['matrix'], dtype=np.float64)
            for r in json.loads(matrix_path.read_text())['cases']}


def balance(pixels, settings):
    assert set(settings) == {'kind', 'temperature', 'tint'}
    assert settings['kind'] == 'white-balance'
    key = settings['temperature'], settings['tint']
    assert key in matrices, 'Use a registered independent matrix reference'
    output = pixels.copy()
    if key == (6504, 0):
        return output
    rgb = pixels[..., :3].astype(np.float64)
    matrix = matrices[key]
    for channel in range(3):
        output[..., channel] = (matrix[channel, 0] * rgb[..., 0]
                                + matrix[channel, 1] * rgb[..., 1]
                                + matrix[channel, 2] * rgb[..., 2]).astype(np.float32)
    assert np.isfinite(output).all()
    return output


def adjust(pixels, settings):
    return balance(pixels, settings) if settings['kind'] == 'white-balance' else transfer(pixels, settings)


def render(source, layers, origin=(0, 0)):
    def check(nodes):
        for node in nodes:
            assert node.get('blendMode', 'normal') in ['normal', 'pass-through']
            if node['kind'] == 'group':
                check(node['children'])
    check(layers)
    return compose(source, layers, origin=origin, transfer=adjust)
