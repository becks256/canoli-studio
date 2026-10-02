// Internal ABI: host supplies validated, aligned buffers and four n-element scratch vectors.
function value(ptr: usize, i: i32): f64 {
  return load<f64>(ptr + ((<usize>i) << 3));
}
function set(ptr: usize, i: i32, v: f64): void {
  store<f64>(ptr + ((<usize>i) << 3), v);
}
function neighbor(matrix: usize, i: i32, k: i32): i32 {
  return load<i32>(matrix + ((<usize>(i * 4 + k)) << 2));
}
function multiply(matrix: usize, n: i32, input: usize, output: usize): void {
  for (let i = 0; i < n; i++) {
    let v = 4 * value(input, i);
    for (let k = 0; k < 4; k++) {
      const j = neighbor(matrix, i, k);
      if (j >= 0) v -= value(input, j);
    }
    set(output, i, v);
  }
}
function precondition(
  matrix: usize,
  diagonal: usize,
  n: i32,
  input: usize,
  output: usize,
): void {
  for (let i = 0; i < n; i++) {
    const left = neighbor(matrix, i, 0),
      up = neighbor(matrix, i, 2);
    set(
      output,
      i,
      (value(input, i) +
        (left < 0 ? 0 : value(output, left) * value(diagonal, left)) +
        (up < 0 ? 0 : value(output, up) * value(diagonal, up))) *
        value(diagonal, i),
    );
  }
  for (let i = n - 1; i >= 0; i--) {
    const right = neighbor(matrix, i, 1),
      down = neighbor(matrix, i, 3);
    set(
      output,
      i,
      (value(output, i) +
        ((right < 0 ? 0 : value(output, right)) +
          (down < 0 ? 0 : value(output, down))) *
          value(diagonal, i)) *
        value(diagonal, i),
    );
  }
}
export function poissonSolve(
  matrix: usize,
  diagonal: usize,
  x: usize,
  b: usize,
  scratch: usize,
  report: usize,
  n: i32,
  tolerance: f64,
  limit: i32,
): void {
  const r = scratch,
    direction = r + ((<usize>n) << 3),
    product = direction + ((<usize>n) << 3),
    conditioned = product + ((<usize>n) << 3);
  multiply(matrix, n, x, product);
  let rr: f64 = 0,
    maximum: f64 = 0;
  for (let i = 0; i < n; i++) {
    const v = value(b, i) - value(product, i);
    set(r, i, v);
    maximum = Math.max(maximum, Math.abs(v));
  }
  precondition(matrix, diagonal, n, r, conditioned);
  for (let i = 0; i < n; i++) {
    const z = value(conditioned, i);
    set(direction, i, z);
    rr += value(r, i) * z;
  }
  let iterations = 0;
  while (maximum > tolerance && iterations < limit) {
    multiply(matrix, n, direction, product);
    let denominator: f64 = 0;
    for (let i = 0; i < n; i++)
      denominator += value(direction, i) * value(product, i);
    if (!(denominator > 0) || !isFinite(denominator)) break;
    const alpha = rr / denominator;
    let next: f64 = 0;
    maximum = 0;
    for (let i = 0; i < n; i++) {
      set(x, i, value(x, i) + alpha * value(direction, i));
      const v = value(r, i) - alpha * value(product, i);
      set(r, i, v);
      maximum = Math.max(maximum, Math.abs(v));
    }
    precondition(matrix, diagonal, n, r, conditioned);
    for (let i = 0; i < n; i++) next += value(r, i) * value(conditioned, i);
    const beta = next / rr;
    for (let i = 0; i < n; i++)
      set(direction, i, value(conditioned, i) + beta * value(direction, i));
    rr = next;
    iterations++;
  }
  multiply(matrix, n, x, product);
  let residual: f64 = 0;
  for (let i = 0; i < n; i++)
    residual = Math.max(residual, Math.abs(value(b, i) - value(product, i)));
  store<f64>(report, residual);
  store<i32>(report + 8, iterations);
}
