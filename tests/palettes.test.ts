import {it, expect} from 'vitest';
import {paletteSchema, paletteEntrySchema, paletteMatches, paletteIdentity,
  readPalettePack, writePalettePack, PALETTE_PACK_BYTES} from '../src/palettes/model';
const palette = {name: 'Botanical', description: 'Approved print colors', tags: ['Print'],
  swatches: [{name: 'Leaf', color: '#315b2a'}, {name: 'Flower', color: '#A43E29'}]};

it('normalizes hex and tags, retaining deliberate duplicate colors and order', async () => {
  const value = paletteSchema.parse({...palette, tags: ['Print', 'ＰＲＩＮＴ'], swatches: [...palette.swatches, {name: 'Second leaf', color: '#315b2a'}]});
  expect(value.tags).toEqual(['ＰＲＩＮＴ']);
  expect(value.swatches.map(swatch => swatch.color)).toEqual(['#315b2a', '#a43e29', '#315b2a']);
  expect(await readPalettePack(writePalettePack([value]))).toEqual([value]);
});
it('finds names, descriptions, tags and swatches with normalized all-term search', () => {
  expect(paletteMatches(palette, 'ＢＯＴＡＮＩＣＡＬ leaf PRINT #315')).toBe(true);
  expect(paletteMatches(palette, 'botanical missing')).toBe(false);
});
it.each([
  {...palette, swatches: []}, {...palette, name: '  '}, {...palette, surprise: true},
  {...palette, swatches: [{name: 'Alpha unsupported', color: '#11223344'}]},
  {...palette, swatches: [{name: 'CSS unsupported', color: 'red'}]},
  {...palette, swatches: [{name: '  ', color: '#112233'}]},
])('rejects invalid or unsupported palette values atomically (%#)', value => {
  expect(() => writePalettePack([palette, value] as typeof palette[])).toThrow();
});
it('uses complete reviewed metadata and ordered values for duplicate identity', () => {
  expect(paletteIdentity(palette)).toBe(paletteIdentity({...palette, swatches: palette.swatches.map(swatch => ({...swatch, color: swatch.color.toUpperCase()}))}));
  expect(paletteIdentity(palette)).not.toBe(paletteIdentity({...palette, name: 'Different review'}));
  expect(paletteIdentity(palette)).not.toBe(paletteIdentity({...palette, swatches: [...palette.swatches].reverse()}));
});
it.each([
  {format: 'canoli-color-palettes', version: 2, palettes: [palette]},
  {format: 'canoli-color-palettes', version: 1, palettes: [palette, {...palette, swatches: []}]},
  {format: 'canoli-color-palettes', version: 1, palettes: [palette], command: 'execute()'},
])('rejects entire invalid packs rather than accepting usable siblings (%#)', async value => {
  await expect(readPalettePack(new Blob([JSON.stringify(value)]))).rejects.toThrow();
});
it('rejects malformed UTF-8 and oversized metadata without image-resolution restrictions', async () => {
  await expect(readPalettePack(new Blob([new Uint8Array([0xff])]))).rejects.toThrow();
  await expect(readPalettePack(new Blob([new Uint8Array(PALETTE_PACK_BYTES + 1)]))).rejects.toThrow(/4 MiB/);
});
it('portable packs omit local IDs and durable revision authority', async () => {
  const entry = paletteEntrySchema.parse({version: 1, id: crypto.randomUUID(), revision: crypto.randomUUID(), createdAt: 1, updatedAt: 1, palette});
  const text = await writePalettePack([entry.palette]).text();
  expect(text).not.toContain(entry.id); expect(text).not.toContain(entry.revision);
  expect(await readPalettePack(new Blob([text]))).toEqual([entry.palette]);
});
