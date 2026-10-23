import {z} from 'zod';

export const swatchSchema = z.object({
  name: z.string().trim().min(1).max(120),
  color: z.string().regex(/^#[\da-f]{6}$/i).transform(color => color.toLowerCase()),
}).strict();
export const paletteSchema = z.object({
  name: z.string().trim().min(1).max(120),
  description: z.string().max(4096),
  tags: z.array(z.string().trim().min(1).max(80)).max(64)
    .transform(tags => [...new Map(tags.map(tag => [normalize(tag), tag])).values()]),
  swatches: z.array(swatchSchema).min(1).max(4096),
}).strict();
export type Swatch = z.infer<typeof swatchSchema>;
export type Palette = z.infer<typeof paletteSchema>;
export const paletteEntrySchema = z.object({
  version: z.literal(1), id: z.string().uuid(), revision: z.string().uuid(),
  createdAt: z.number().int().nonnegative().safe(), updatedAt: z.number().int().nonnegative().safe(),
  palette: paletteSchema,
}).strict();
export type PaletteEntry = z.infer<typeof paletteEntrySchema>;
export interface PaletteRow {key: IDBValidKey; value: unknown}
export interface PaletteSummary {key: IDBValidKey; entry: PaletteEntry | null; error: string}
export function normalize(value: string) {return value.normalize('NFKC').toLocaleLowerCase('en');}
export function paletteRow(row: PaletteRow) {
  const entry = paletteEntrySchema.parse(row.value);
  if (row.key !== entry.id) throw new Error('Palette identifier changed.');
  return entry;
}
export function paletteMatches(palette: Palette, query: string) {
  const text = normalize([palette.name, palette.description, ...palette.tags,
    ...palette.swatches.flatMap(swatch => [swatch.name, swatch.color])].join('\n'));
  return normalize(query).trim().split(/\s+/u).filter(Boolean).every(word => text.includes(word));
}
/** Equality includes reviewed metadata and swatch order. Color-only matches are not duplicates. */
export function paletteIdentity(value: Palette) {return JSON.stringify(paletteSchema.parse(value));}
export const PALETTE_PACK_BYTES = 4 * 1024 * 1024;
export const palettePackSchema = z.object({
  format: z.literal('canoli-color-palettes'), version: z.literal(1),
  palettes: z.array(paletteSchema).min(1).max(256),
}).strict();
export async function readPalettePack(blob: Blob): Promise<Palette[]> {
  if (blob.size > PALETTE_PACK_BYTES) throw new Error('Palette metadata pack exceeds 4 MiB.');
  const text = new TextDecoder('utf-8', {fatal: true}).decode(await blob.arrayBuffer());
  return palettePackSchema.parse(JSON.parse(text)).palettes;
}
export function writePalettePack(palettes: Palette[]): Blob {
  const value = palettePackSchema.parse({format: 'canoli-color-palettes', version: 1, palettes});
  const blob = new Blob([JSON.stringify(value, null, 2)], {type: 'application/json'});
  if (blob.size > PALETTE_PACK_BYTES) throw new Error('Palette metadata pack exceeds 4 MiB. Export fewer palettes.');
  return blob;
}
