/** Local exemplar search. Scores visible boundary context, never damaged target pixels. */
export interface DonorSearchOptions {
  radius?: number;
}
export interface DonorSearchResult {
  x: number;
  y: number;
  score: number;
  candidates: number;
}

export interface DonorValidityInput {
  blocked: Uint32Array;
  support: { row: number; column: number; bits: number }[];
  stride: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}
export type DonorValidity = (input: DonorValidityInput) => Uint8Array;

function searchDonor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  coverage: Uint8Array | Uint8ClampedArray,
  options: DonorSearchOptions,
  packed: boolean,
  validity?: DonorValidity,
): DonorSearchResult {
  if (
    ![width, height, width * height * 4].every(Number.isSafeInteger) ||
    width < 1 ||
    height < 1 ||
    pixels.length !== width * height * 4 ||
    coverage.length !== width * height
  )
    throw new Error("Invalid donor search geometry.");
  const radius = options.radius ?? 64;
  if (!Number.isSafeInteger(radius) || radius < 1)
    throw new Error("Donor search radius must be a positive safe integer.");
  const selected: number[] = [],
    boundary = new Set<number>();
  let minX = width,
    maxX = -1,
    minY = height,
    maxY = -1;
  for (let p = 0; p < coverage.length; p++)
    if (coverage[p]) {
      selected.push(p);
      const x = p % width,
        y = Math.floor(p / width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ]) {
        if (x + dx < 0 || x + dx >= width || y + dy < 0 || y + dy >= height)
          continue;
        const q = p + dy * width + dx;
        if (!coverage[q] && pixels[q * 4 + 3]) boundary.add(q);
      }
    }
  if (!selected.length) throw new Error("Donor search selection is empty.");
  if (!boundary.size)
    throw new Error(
      "Donor search requires visible context outside the selection.",
    );
  const ring = [...boundary];
  // Include context in the search bounds so candidate scoring never wraps rows.
  for (const p of ring) {
    minX = Math.min(minX, p % width);
    maxX = Math.max(maxX, p % width);
    minY = Math.min(minY, Math.floor(p / width));
    maxY = Math.max(maxY, Math.floor(p / width));
  }
  // Uniform target alpha permits exact 32-pixel validity checks. Variable-alpha
  // targets retain the scalar comparison, preserving per-pixel alpha semantics.
  const alpha = pixels[selected[0] * 4 + 3];
  const usePacked =
    packed && selected.every((p) => pixels[p * 4 + 3] === alpha);
  const packedRing =
    usePacked && ring.every((p) => pixels[p * 4 + 3] === alpha);
  const stride = Math.ceil(width / 32);
  const support: { row: number; column: number; bits: number }[] = [];
  const blocked = usePacked ? new Uint32Array(stride * height) : null;
  if (blocked) {
    const words = new Uint32Array(stride * height);
    for (let p = 0; p < coverage.length; p++) {
      const x = p % width,
        word = Math.floor(p / width) * stride + (x >>> 5),
        bit = 1 << (x & 31);
      if (coverage[p]) words[word] |= bit;
      if (coverage[p] || !pixels[p * 4 + 3] || pixels[p * 4 + 3] < alpha)
        blocked[word] |= bit;
    }
    if (packedRing)
      for (const p of ring) {
        const x = p % width;
        words[Math.floor(p / width) * stride + (x >>> 5)] |= 1 << (x & 31);
      }
    for (let word = 0; word < words.length; word++)
      if (words[word]) {
        support.push({
          row: Math.floor(word / stride),
          column: (word % stride) * 32,
          bits: words[word],
        });
      }
  }
  const minDx = Math.max(-radius, -minX),
    maxDx = Math.min(radius, width - 1 - maxX);
  const minDy = Math.max(-radius, -minY),
    maxDy = Math.min(radius, height - 1 - maxY);
  const validGrid =
    blocked && validity
      ? validity({
          blocked,
          support,
          stride,
          minX: minDx,
          maxX: maxDx,
          minY: minDy,
          maxY: maxDy,
        })
      : null;
  let best: DonorSearchResult | undefined,
    candidates = 0,
    bestDistance = Infinity;
  for (let dy = minDy; dy <= maxDy; dy++) {
    candidate: for (let dx = minDx; dx <= maxDx; dx++) {
      if (!dx && !dy) continue;
      const shift = dy * width + dx;
      if (validGrid) {
        if (!validGrid[(dy - minDy) * (maxDx - minDx + 1) + dx - minDx])
          continue;
      } else if (blocked) {
        for (const word of support) {
          const start = word.column + dx,
            sourceWord = Math.floor(start / 32),
            bit = start - sourceWord * 32;
          const row = (word.row + dy) * stride;
          const low =
            sourceWord >= 0 && sourceWord < stride
              ? blocked[row + sourceWord]
              : 0;
          const high =
            sourceWord + 1 >= 0 && sourceWord + 1 < stride
              ? blocked[row + sourceWord + 1]
              : 0;
          const invalid = bit ? (low >>> bit) | (high << (32 - bit)) : low;
          if (word.bits & invalid) continue candidate;
        }
      } else
        for (const p of selected) {
          const q = p + shift;
          if (
            coverage[q] ||
            !pixels[q * 4 + 3] ||
            pixels[q * 4 + 3] < pixels[p * 4 + 3]
          )
            continue candidate;
        }
      // Scores are nonnegative. A validated donor cannot beat a zero-score
      // winner unless it is nearer; still count every valid candidate.
      if (
        packedRing &&
        best?.score === 0 &&
        dx * dx + dy * dy >= bestDistance
      ) {
        candidates++;
        continue;
      }
      const sums = [0, 0, 0],
        squares = [0, 0, 0];
      let alphaError = 0;
      for (const p of ring) {
        const q = p + shift;
        if (coverage[q] || pixels[q * 4 + 3] < pixels[p * 4 + 3])
          continue candidate;
        for (let c = 0; c < 3; c++) {
          const difference = pixels[q * 4 + c] - pixels[p * 4 + c];
          sums[c] += difference;
          squares[c] += difference * difference;
        }
        alphaError += (pixels[q * 4 + 3] - pixels[p * 4 + 3]) ** 2;
      }
      candidates++;
      // Remove most constant illumination drift; retain a weak color preference.
      let score = alphaError / ring.length;
      for (let c = 0; c < 3; c++) {
        const mean = sums[c] / ring.length;
        score +=
          Math.max(0, squares[c] / ring.length - mean * mean) +
          0.01 * mean * mean;
      }
      const distance = dx * dx + dy * dy;
      if (
        !best ||
        score < best.score ||
        (score === best.score && distance < bestDistance)
      ) {
        best = { x: dx, y: dy, score, candidates: 0 };
        bestDistance = distance;
      }
    }
  }
  if (!best)
    throw new Error("No intact donor region found within the search radius.");
  return { ...best, candidates };
}

export function findRetouchDonor(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  coverage: Uint8Array | Uint8ClampedArray,
  options: DonorSearchOptions = {},
  validity?: DonorValidity,
): DonorSearchResult {
  return searchDonor(pixels, width, height, coverage, options, true, validity);
}

/** Scalar oracle for packed-support parity tests and profiling. */
export function findRetouchDonorReference(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
  coverage: Uint8Array | Uint8ClampedArray,
  options: DonorSearchOptions = {},
): DonorSearchResult {
  return searchDonor(pixels, width, height, coverage, options, false);
}
