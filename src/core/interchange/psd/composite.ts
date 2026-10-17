/** PSD merged previews store RGB over white; layer channels store straight RGB. */
export function mattePreviewChannel(value: number, alpha: number): number {
  return Math.round(value * alpha / 255 + 255 - alpha);
}
export function unmattePreviewChannel(value: number, alpha: number): number {
  return alpha === 0 ? 0 : Math.max(0, Math.min(255, Math.round((value + alpha - 255) * 255 / alpha)));
}
