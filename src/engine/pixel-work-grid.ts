/** Partitions bound working arrays, never source-image or document geometry. */
export interface PixelWorkGrid {
  columns: number;
  rows: number;
}

const maxAxis = 8192;

function checkDimensions(width: number, height: number) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width <= 0 || height <= 0) {
    throw new Error('Pixel working dimensions must be positive safe integers.');
  }
}

/** Independent RGBA operations retain the previous 1024-by-1024 pixel budget. */
export function pixelWorkGrid(width: number, height: number): PixelWorkGrid {
  checkDimensions(width, height);
  const columns = Math.min(width, maxAxis);
  const rows = Math.min(height, maxAxis, Math.floor(1024 * 1024 / columns));
  return {columns, rows};
}

/** Native source sampling may combine requests when doing so reduces their
 * count without increasing halo work. Overscan includes nested projection
 * margins. The established grid remains the fallback for large halos. */
export function nativeSamplingGrid(
  width: number, height: number, legacy: number, halo: number, overscan = 4,
): PixelWorkGrid {
  checkDimensions(width, height);
  if (!Number.isSafeInteger(legacy) || legacy <= 0 || !Number.isSafeInteger(halo) || halo < 0 ||
      !Number.isSafeInteger(overscan) || overscan < 0) {
    throw new Error('Invalid native sampling partition.');
  }
  const original = {columns: legacy, rows: legacy};
  const pad = overscan + 2 * halo, maxCore = maxAxis - pad, budget = 1_000_000;
  if (maxCore < 1 || (pad + 1) * (pad + 1) > budget) return original;

  const fullColumns = Math.min(width, maxCore), fullRows = Math.min(height, maxCore);
  // Try both orientations: filling the width can duplicate more halo pixels
  // than filling the height when the filter radius is large.
  const candidates = [
    {columns: fullColumns, rows: Math.min(fullRows, Math.floor(budget / (fullColumns + pad)) - pad)},
    {columns: Math.min(fullColumns, Math.floor(budget / (fullRows + pad)) - pad), rows: fullRows},
  ];
  const jobs = (grid: PixelWorkGrid) => Math.ceil(width / grid.columns) * Math.ceil(height / grid.rows);
  const pixels = (grid: PixelWorkGrid) =>
    (width + Math.ceil(width / grid.columns) * pad) * (height + Math.ceil(height / grid.rows) * pad);
  const originalJobs = jobs(original), originalPixels = pixels(original);
  let best = original, count = originalJobs, work = originalPixels;
  for (const grid of candidates) {
    if (grid.columns < 1 || grid.rows < 1) continue;
    const next = jobs(grid), area = pixels(grid);
    if (area <= originalPixels &&
        (next < count || (next === count && next < originalJobs && area < work))) {
      best = grid;
      count = next;
      work = area;
    }
  }
  return best;
}
