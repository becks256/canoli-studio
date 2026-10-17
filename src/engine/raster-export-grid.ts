/** Canonical native readback grid: all lossless raster writers share its pixels.
 * Storage tiles may crop these frames, but must not move their native origins.
 */
export const RASTER_EXPORT_COLUMNS=2048;
export function rasterExportRows(width:number):number{
 return Math.max(1,Math.min(64,Math.floor(4_000_000/(width*4+1))));
}
