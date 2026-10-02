/** Shared limits for raster tone effects and recorded recipe parameters. */
export const TONE_LIMITS = {
  exposure: { min: -3, max: 3, step: 0.1 },
  contrast: { min: -100, max: 100, step: 1 },
  saturation: { min: -100, max: 100, step: 1 },
} as const;
