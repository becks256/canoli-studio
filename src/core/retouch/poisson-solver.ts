/** Internal numerical backend; updates x, preserving matrix/factor/RHS inputs. */
export type PoissonLinearSolver = (
  neighbors: Int32Array,
  inverseDiagonal: Float64Array,
  x: Float64Array,
  b: Float64Array,
  tolerance: number,
  limit: number,
) => { iterations: number; residual: number };

/** Independent TypeScript reference for the allocation-free WASM solve. */
export const solvePoissonSystem: PoissonLinearSolver = (
  neighbors,
  inverseDiagonal,
  x,
  b,
  tolerance,
  limit,
) => {
  const n = x.length;
  const precondition = (input: Float64Array, output: Float64Array) => {
    for (let i = 0; i < n; i++) {
      const left = neighbors[i * 4],
        up = neighbors[i * 4 + 2];
      output[i] =
        (input[i] +
          (left < 0 ? 0 : output[left] * inverseDiagonal[left]) +
          (up < 0 ? 0 : output[up] * inverseDiagonal[up])) *
        inverseDiagonal[i];
    }
    for (let i = n - 1; i >= 0; i--) {
      const right = neighbors[i * 4 + 1],
        down = neighbors[i * 4 + 3];
      output[i] =
        (output[i] +
          ((right < 0 ? 0 : output[right]) + (down < 0 ? 0 : output[down])) *
            inverseDiagonal[i]) *
        inverseDiagonal[i];
    }
  };
  const multiply = (input: Float64Array, output: Float64Array) => {
    for (let i = 0; i < n; i++) {
      let value = 4 * input[i];
      for (let k = 0; k < 4; k++) {
        const j = neighbors[i * 4 + k];
        if (j >= 0) value -= input[j];
      }
      output[i] = value;
    }
  };
  const r = new Float64Array(n),
    direction = new Float64Array(n);
  const product = new Float64Array(n),
    conditioned = new Float64Array(n);
  multiply(x, product);
  let rr = 0,
    maximum = 0;
  for (let i = 0; i < n; i++) {
    r[i] = b[i] - product[i];
    maximum = Math.max(maximum, Math.abs(r[i]));
  }
  precondition(r, conditioned);
  direction.set(conditioned);
  for (let i = 0; i < n; i++) rr += r[i] * conditioned[i];
  let iterations = 0;
  while (maximum > tolerance && iterations < limit) {
    multiply(direction, product);
    let denominator = 0;
    for (let i = 0; i < n; i++) denominator += direction[i] * product[i];
    if (!(denominator > 0) || !Number.isFinite(denominator)) break;
    const alpha = rr / denominator;
    let next = 0;
    maximum = 0;
    for (let i = 0; i < n; i++) {
      x[i] += alpha * direction[i];
      r[i] -= alpha * product[i];
      maximum = Math.max(maximum, Math.abs(r[i]));
    }
    precondition(r, conditioned);
    for (let i = 0; i < n; i++) next += r[i] * conditioned[i];
    const beta = next / rr;
    for (let i = 0; i < n; i++)
      direction[i] = conditioned[i] + beta * direction[i];
    rr = next;
    iterations++;
  }
  multiply(x, product);
  let residual = 0;
  for (let i = 0; i < n; i++)
    residual = Math.max(residual, Math.abs(b[i] - product[i]));
  return { iterations, residual };
};
