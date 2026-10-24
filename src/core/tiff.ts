/** TIFF 6 tiled RGBA8 / BigTIFF directories. Pixel payloads stay separate. */
export type TiffVariant = 'auto' | 'classic' | 'big';
export interface TiffPagesExportOptions {variant?: TiffVariant}
export interface TiffDirectoryInput {
  width: number; height: number; tileWidth: number; tileHeight: number;
  /** Page-local offsets relative to its first pixel payload, eight-byte aligned. */
  offsets: readonly number[]; counts: readonly number[]; payloadBytes: number; profile: Uint8Array;
  variant?: TiffVariant;
}
export type TiffPageDirectoryInput = Omit<TiffDirectoryInput, 'variant'>;
export interface TiffDirectory {header: Uint8Array<ArrayBuffer>; directory: Uint8Array<ArrayBuffer>; bigTiff: boolean; fileBytes: number}
export interface TiffDirectories {header: Uint8Array<ArrayBuffer>; directories: Uint8Array<ArrayBuffer>[]; bigTiff: boolean; fileBytes: number}
const align = (n: number) => Math.ceil(n / 8) * 8;
const safe = (n: number) => Number.isSafeInteger(n) && n >= 0;
export function validateTiffVariant(value: unknown): TiffVariant {
  if (value === undefined) return 'auto';
  if (value !== 'auto' && value !== 'classic' && value !== 'big') throw new Error('TIFF container must be auto, classic or big.');
  return value;
}
export function validateTiffGeometry(width: number, height: number) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff)) throw new Error('These dimensions exceed TIFF’s unsigned 32-bit image geometry.');
}
interface Field {tag: number; type: number; count: number; data: Uint8Array<ArrayBuffer>}
function values(type: number, items: readonly number[]): Uint8Array<ArrayBuffer> {
  const size = type === 3 ? 2 : type === 16 ? 8 : 4, data = new Uint8Array(size * items.length), view = new DataView(data.buffer);
  items.forEach((n, i) => {
    if (!safe(n) || (type !== 16 && n > (type === 3 ? 0xffff : 0xffffffff))) throw new Error('TIFF field exceeds its integer representation.');
    if (type === 3) view.setUint16(i * size, n, true);
    else if (type === 16) view.setBigUint64(i * size, BigInt(n), true);
    else view.setUint32(i * size, n, true);
  });
  return data;
}
function validatePage(input: TiffPageDirectoryInput) {
  validateTiffGeometry(input.width, input.height);
  if (![input.tileWidth, input.tileHeight].every(n => Number.isSafeInteger(n) && n > 0 && n <= 0xffffffff && n % 16 === 0)) throw new Error('TIFF tile dimensions must be positive multiples of 16.');
  const count = Math.ceil(input.width / input.tileWidth) * Math.ceil(input.height / input.tileHeight);
  if (!safe(count) || input.offsets.length !== count || input.counts.length !== count || !safe(input.payloadBytes) || input.payloadBytes % 8) throw new Error('TIFF tile table does not match native image geometry.');
  if (!input.profile.length || input.profile.length > 0xffffffff) throw new Error('TIFF requires an embedded output ICC profile.');
  let end = 0;
  for (let i = 0; i < count; i++) {
    const start = input.offsets[i], size = input.counts[i];
    if (!safe(start) || start % 8 || start < end || !safe(size) || size === 0 || !safe(start + size) || start + size > input.payloadBytes) throw new Error('Invalid TIFF pixel payload offsets.');
    end = align(start + size);
  }
  if (end !== input.payloadBytes) throw new Error('TIFF pixel payload contains an unaccounted tail.');
}
function build(pages: readonly TiffPageDirectoryInput[], payloadBytes: number, big: boolean): TiffDirectories {
  const headerSize = big ? 16 : 8, slot = big ? 8 : 4, entrySize = big ? 20 : 12;
  const firstIfd = headerSize + payloadBytes, directories: Uint8Array<ArrayBuffer>[] = [];
  let ifdOffset = firstIfd, pixelOffset = headerSize, previousNext: DataView | undefined;
  const field = (tag: number, type: number, items: readonly number[]): Field => ({tag, type, count: items.length, data: values(type, items)});
  for (let page = 0; page < pages.length; page++) {
    const input = pages[page], ascii = new TextEncoder().encode('Canoli Studio\0');
    const fields: Field[] = [field(256, 4, [input.width]), field(257, 4, [input.height]), field(258, 3, [8, 8, 8, 8]), field(259, 3, [8]), field(262, 3, [2]), field(274, 3, [1]), field(277, 3, [4]),
      {tag: 282, type: 5, count: 1, data: values(4, [72, 1])}, {tag: 283, type: 5, count: 1, data: values(4, [72, 1])}, field(284, 3, [1]), field(296, 3, [2]), {tag: 305, type: 2, count: ascii.length, data: ascii},
      field(322, 4, [input.tileWidth]), field(323, 4, [input.tileHeight]), field(324, big ? 16 : 4, input.offsets.map(n => pixelOffset + n)), field(325, big ? 16 : 4, input.counts), field(338, 3, [2]),
      {tag: 34675, type: 7, count: input.profile.length, data: new Uint8Array(input.profile)}];
    if (pages.length > 1) {
      fields.push(field(254, 4, [2])); // One page of a multipage image.
      // PageNumber is optional and contains two SHORTs. Never truncate a large chain.
      if (pages.length <= 0xffff) fields.push(field(297, 3, [page, pages.length]));
      fields.sort((a, b) => a.tag - b.tag);
    }
    const nextAt = (big ? 8 : 2) + fields.length * entrySize;
    const fixed = nextAt + (big ? 8 : 4);
    let length = align(fixed);
    for (const f of fields) if (f.data.length > slot) length = align(length + f.data.length);
    const end = ifdOffset + length;
    if (!safe(end)) throw new Error('TIFF output exceeds exact browser file addressing.');
    if (!big && end > 0xffffffff) throw new Error('TIFF output exceeds the classic 4 GiB address range. Choose Automatic or BigTIFF.');
    const directory = new Uint8Array(length), view = new DataView(directory.buffer);
    if (big) view.setBigUint64(0, BigInt(fields.length), true); else view.setUint16(0, fields.length, true);
    let extra = align(fixed);
    fields.forEach((f, i) => {
      const at = (big ? 8 : 2) + i * entrySize;
      view.setUint16(at, f.tag, true); view.setUint16(at + 2, f.type, true);
      if (big) view.setBigUint64(at + 4, BigInt(f.count), true); else view.setUint32(at + 4, f.count, true);
      const value = at + (big ? 12 : 8);
      if (f.data.length <= slot) directory.set(f.data, value);
      else {
        const address = ifdOffset + extra;
        if (big) view.setBigUint64(value, BigInt(address), true); else view.setUint32(value, address, true);
        directory.set(f.data, extra); extra = align(extra + f.data.length);
      }
    });
    if (previousNext) {
      if (big) previousNext.setBigUint64(0, BigInt(ifdOffset), true); else previousNext.setUint32(0, ifdOffset, true);
    }
    previousNext = new DataView(directory.buffer, nextAt, big ? 8 : 4);
    directories.push(directory); ifdOffset = end; pixelOffset += input.payloadBytes;
  }
  const header = new Uint8Array(headerSize), h = new DataView(header.buffer);
  header[0] = header[1] = 73; h.setUint16(2, big ? 43 : 42, true);
  if (big) {h.setUint16(4, 8, true); h.setBigUint64(8, BigInt(firstIfd), true);} else h.setUint32(4, firstIfd, true);
  return {header, directories, bigTiff: big, fileBytes: ifdOffset};
}
/** One main-IFD chain; each page retains independent native geometry and tile tables. */
export function planTiffDirectories(pages: readonly TiffPageDirectoryInput[], variant: TiffVariant = 'auto'): TiffDirectories {
  variant = validateTiffVariant(variant);
  if (!Array.isArray(pages) || !pages.length) throw new Error('Choose at least one TIFF page.');
  let payloadBytes = 0;
  for (const page of pages) {
    validatePage(page); payloadBytes += page.payloadBytes;
    if (!safe(payloadBytes) || !safe(payloadBytes + 16)) throw new Error('TIFF output exceeds exact browser file addressing.');
  }
  if (variant === 'big') return build(pages, payloadBytes, true);
  if (payloadBytes <= 0xffffffff - 8) {
    try {return build(pages, payloadBytes, false);}
    catch (error) {if (variant === 'classic' || !(error instanceof Error) || !error.message.includes('classic 4 GiB')) throw error;}
  }
  if (variant === 'classic') throw new Error('TIFF output exceeds the classic 4 GiB address range. Choose Automatic or BigTIFF.');
  return build(pages, payloadBytes, true);
}
export function planTiffDirectory(input: TiffDirectoryInput): TiffDirectory {
  const result = planTiffDirectories([input], input.variant);
  return {header: result.header, directory: result.directories[0], bigTiff: result.bigTiff, fileBytes: result.fileBytes};
}
