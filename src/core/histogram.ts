export interface HistogramData {
  red: Uint32Array;
  green: Uint32Array;
  blue: Uint32Array;
  luminance: Uint32Array;
  totalPixels: number;
  maxCount: number;
  mean: number;
  median: number;
  stdDev: number;
  min: number;
  max: number;
}

export function emptyHistogram(): HistogramData {
  return {
    red: new Uint32Array(256),
    green: new Uint32Array(256),
    blue: new Uint32Array(256),
    luminance: new Uint32Array(256),
    totalPixels: 0,
    maxCount: 0,
    mean: 0,
    median: 0,
    stdDev: 0,
    min: 0,
    max: 0,
  };
}

/**
 * Computes 256-bin histograms and tonal statistics from an RGBA byte buffer.
 * Transparent pixels (alpha === 0) are excluded from the distribution.
 */
export function computeHistogram(pixels: Uint8ClampedArray): HistogramData {
  const red = new Uint32Array(256);
  const green = new Uint32Array(256);
  const blue = new Uint32Array(256);
  const luminance = new Uint32Array(256);

  let totalPixels = 0;
  let maxCount = 0;
  let sumLuminance = 0;
  let minLum = 255;
  let maxLum = 0;

  const len = pixels.length;
  for (let i = 0; i < len; i += 4) {
    const a = pixels[i + 3];
    if (a === 0) continue; // Exclude fully transparent pixels

    const r = pixels[i];
    const g = pixels[i + 1];
    const b = pixels[i + 2];
    const lum = Math.round(0.2126 * r + 0.7152 * g + 0.0722 * b);

    red[r]++;
    green[g]++;
    blue[b]++;
    luminance[lum]++;

    if (red[r] > maxCount) maxCount = red[r];
    if (green[g] > maxCount) maxCount = green[g];
    if (blue[b] > maxCount) maxCount = blue[b];
    if (luminance[lum] > maxCount) maxCount = luminance[lum];

    sumLuminance += lum;
    if (lum < minLum) minLum = lum;
    if (lum > maxLum) maxLum = lum;
    totalPixels++;
  }

  if (totalPixels === 0) {
    return emptyHistogram();
  }

  const mean = sumLuminance / totalPixels;

  // Compute standard deviation
  let varianceSum = 0;
  for (let val = 0; val < 256; val++) {
    const count = luminance[val];
    if (count > 0) {
      const diff = val - mean;
      varianceSum += diff * diff * count;
    }
  }
  const stdDev = Math.sqrt(varianceSum / totalPixels);

  // Compute median
  const half = Math.floor(totalPixels / 2);
  let accumulated = 0;
  let median = 0;
  for (let val = 0; val < 256; val++) {
    accumulated += luminance[val];
    if (accumulated >= half) {
      median = val;
      break;
    }
  }

  return {
    red,
    green,
    blue,
    luminance,
    totalPixels,
    maxCount,
    mean: Math.round(mean * 100) / 100,
    median,
    stdDev: Math.round(stdDev * 100) / 100,
    min: minLum,
    max: maxLum,
  };
}

/** The isolated sibling stack that supplies an adjustment layer's input pixels. */
export function adjustmentBackdrop(
  document: import("./model").DocumentData,
  id: string,
): import("./model").DocumentData | null {
  type Layer = import("./model").LayerData;
  const walk = (nodes: Layer[]): Layer[] | null => {
    const index = nodes.findIndex((layer) => layer.id === id);
    if (index >= 0) return nodes.slice(0, index);
    for (const layer of nodes)
      if (layer.kind === "group") {
        const children = walk(layer.children);
        if (children)
          return [
            {
              ...layer,
              children,
              visible: true,
              opacity: 1,
              fillOpacity: 1,
              blendMode: "normal",
              mask: null,
              styles: undefined,
            },
          ];
      }
    return null;
  };
  const children = walk(document.children);
  return children ? { ...document, children } : null;
}
