/** Minimal little-endian TIFF metadata in a JPEG APP1 segment. */
export function exifSegment() {
  const encoder = new TextEncoder();
  const make = encoder.encode("Fixture Camera\0"),
    artist = encoder.encode("<script>private author</script>\0");
  const tiff = new Uint8Array(8 + 2 + 3 * 12 + 4 + make.length + artist.length);
  const view = new DataView(tiff.buffer);
  tiff.set([73, 73, 42, 0, 8, 0, 0, 0]);
  view.setUint16(8, 3, true);
  const dataOffset = 50;
  for (const [index, tag, type, count, value] of [
    [0, 0x010f, 2, make.length, dataOffset],
    [1, 0x0112, 3, 1, 6],
    [2, 0x013b, 2, artist.length, dataOffset + make.length],
  ]) {
    const offset = 10 + index * 12;
    view.setUint16(offset, tag, true);
    view.setUint16(offset + 2, type, true);
    view.setUint32(offset + 4, count, true);
    if (type === 3) view.setUint16(offset + 8, value, true);
    else view.setUint32(offset + 8, value, true);
  }
  tiff.set(make, dataOffset);
  tiff.set(artist, dataOffset + make.length);
  const segment = new Uint8Array(tiff.length + 10);
  segment.set([255, 225]);
  new DataView(segment.buffer).setUint16(2, tiff.length + 8);
  segment.set([69, 120, 105, 102, 0, 0], 4);
  segment.set(tiff, 10);
  return segment;
}
