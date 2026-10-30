"""Independent perspective oracle: NumPy 8x8 solve, half-plane line arrangement,
polygon moments, and SciPy float64 premultiplied interpolation. No editor code.
Run with the established native-reference Python environment.
"""
import gzip
import hashlib
import json
from pathlib import Path
import numpy as np
from scipy.ndimage import map_coordinates

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'tests/fixtures/projective'


def homography(width, height, quad):
    origin = quad[0].copy()
    target = quad - origin
    rows, values = [], []
    for (x, y), (u, v) in zip([(0, 0), (width, 0), (width, height), (0, height)], target):
        rows.extend([[x, y, 1, 0, 0, 0, -u*x, -u*y], [0, 0, 0, x, y, 1, -v*x, -v*y]])
        values.extend([u, v])
    forward = np.append(np.linalg.solve(np.array(rows, dtype=np.float64), values), 1).reshape(3, 3)
    return origin, np.linalg.inv(forward)


def pixel_polygon(quad, x, y):
    # Intersect every pair of the eight boundary lines, rather than using the
    # implementation's sequential polygon clipping algorithm.
    q = quad - [x, y]
    signed = np.sum(q[:, 0] * np.roll(q[:, 1], -1) - q[:, 1] * np.roll(q[:, 0], -1))
    winding = np.sign(signed)
    edges = []
    for a, b in zip(q, np.roll(q, -1, axis=0)):
        dx, dy = b - a
        edges.append(winding * np.array([-dy, dx, dy*a[0]-dx*a[1]]))
    edges.extend([[1, 0, 0], [-1, 0, 1], [0, 1, 0], [0, -1, 1]])
    lines = np.array(edges, dtype=np.float64)
    points = []
    for i in range(8):
        for j in range(i):
            matrix = lines[[i, j], :2]
            if abs(np.linalg.det(matrix)) < 1e-18:
                continue
            point = np.linalg.solve(matrix, -lines[[i, j], 2])
            if np.min(lines[:, :2] @ point + lines[:, 2]) >= -1e-11:
                points.append(point)
    if len(points) < 3:
        return 0, np.array([.5, .5])
    points = np.unique(np.round(points, 13), axis=0)
    if len(points) < 3:
        return 0, np.array([.5, .5])
    center = points.mean(axis=0)
    points = points[np.argsort(np.arctan2(points[:, 1]-center[1], points[:, 0]-center[0]))]
    other = np.roll(points, -1, axis=0)
    cross = points[:, 0] * other[:, 1] - other[:, 0] * points[:, 1]
    area = cross.sum()
    if abs(area) < 1e-16:
        return 0, np.array([.5, .5])
    centroid = ((points + other) * cross[:, None]).sum(axis=0) / (3 * area)
    return min(1, abs(area)/2), centroid


def reference(source, quad, region):
    height, width, _ = source.shape
    origin, inverse = homography(width, height, quad)
    output = np.zeros((region['height'], region['width'], 4), dtype='<f4')
    premult = source.astype(np.float64).copy()
    premult[:, :, :3] *= premult[:, :, 3:4]
    low, high = quad.min(axis=0), quad.max(axis=0)
    for row in range(region['height']):
        for col in range(region['width']):
            x, y = region['x'] + col, region['y'] + row
            if x >= high[0] or x+1 <= low[0] or y >= high[1] or y+1 <= low[1]:
                continue
            coverage, centroid = pixel_polygon(quad, x, y)
            if coverage == 0:
                continue
            point = inverse @ np.append(np.array([x, y]) - origin + centroid, 1)
            sx, sy = point[:2] / point[2] - .5
            coordinates = np.array([[sy], [sx]])
            sample = np.array([map_coordinates(premult[:, :, c], coordinates, order=1, prefilter=False, mode='nearest')[0] for c in range(4)])
            alpha = np.float32(sample[3] * coverage)
            if alpha > 0:
                output[row, col, :3] = sample[:3] / sample[3]
                output[row, col, 3] = alpha
    return output


def write(name, pixels):
    raw = np.ascontiguousarray(pixels, dtype='<f4').tobytes()
    (OUT / name).write_bytes(gzip.compress(raw, compresslevel=9, mtime=0))
    return hashlib.sha256(raw).hexdigest()


if __name__ == '__main__':
    OUT.mkdir(parents=True, exist_ok=True)
    y, x = np.mgrid[:23, :31]
    source = np.stack([-2+x*.1+y*.025, 3-x*.03+y*.04, ((x*7+y*13) % 37)/17-.25, ((x*3+y*5) % 17)/16], axis=2).astype('<f4')
    source_hash = write('source.f32le.gz', source)
    definitions = [
        ('identity', [[0, 0], [31, 0], [31, 23], [0, 23]], [-3, -3, 39, 31]),
        ('trapezoid', [[3.25, 1.125], [39.5, 4.25], [31, 29], [7.5, 25.75]], [0, 0, 44, 33]),
        ('skew', [[-7.5, 4.25], [26.5, -2], [36, 28], [-10, 19.5]], [-12, -5, 52, 38]),
        ('reflection', [[36, 2], [2, 4], [5, 29], [31, 26]], [0, 0, 41, 33]),
        ('pixel-corner-contacts', [[-2, 2], [2, -2], [4, 2], [2, 4]], [-3, -3, 9, 9]),
        ('quarter-turn', [[26, 2], [26, 33], [3, 33], [3, 2]], [0, 0, 30, 36]),
        ('minified', [[.25, .125], [.75, .25], [.875, .875], [.125, .75]], [-1, -1, 3, 3]),
        ('strong-perspective', [[1, 1], [39.5, 3], [7.75, 30], [6, 28]], [-1, -1, 44, 34]),
        ('large-placement', [[100000003.25, -199999998.875], [100000039.5, -199999995.75], [100000031, -199999971], [100000007.5, -199999974.25]], [100000000, -200000000, 44, 33]),
    ]
    cases = []
    for name, corners, bounds in definitions:
        region = dict(zip(['x', 'y', 'width', 'height'], bounds))
        result = reference(source, np.array(corners, dtype=np.float64), region)
        filename = name + '.f32le.gz'
        digest = write(filename, result)
        cases.append({'name': name, 'source': 'source.f32le.gz', 'width': 31, 'height': 23, 'corners': [{'x': x, 'y': y} for x, y in corners], 'output': region, 'reference': filename, 'floatSha256': digest})
    manifest = {'version': 1, 'sourceSha256': source_hash, 'reference': 'Independent NumPy linear solve and line-arrangement polygon intersections; SciPy float64 premultiplied bilinear sampling.', 'colorErrorScale': 2**-21, 'cases': cases}
    (OUT / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
    print(json.dumps({'cases': len(cases), 'sourceSamples': int(source.size), 'outputSamples': sum(row['output']['width']*row['output']['height']*4 for row in cases)}))
