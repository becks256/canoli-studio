/** Exact native filtered RGBA with optional retained originals; bounded working storage, never a document size limit. */
export class FilterTileCache {
  private entries = new Map<
    string,
    {
      signature: string;
      original?: Uint8ClampedArray;
      filtered: Uint8ClampedArray;
      bytes: number;
    }
  >();
  private bytes = 0;
  constructor(readonly budget = 32 * 1024 * 1024) {}
  get byteLength() {
    return this.bytes;
  }
  private lookup(key: string, signature: string) {
    const entry = this.entries.get(key);
    if (!entry || entry.signature !== signature) return undefined;
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }
  readOriginal(key: string, signature: string) {
    return this.lookup(key, signature)?.original?.slice();
  }
  read(key: string, signature: string, includeOriginal = true) {
    const entry = this.lookup(key, signature);
    if (!entry) return undefined;
    // Worker transfer and concurrent render jobs must never own retained buffers.
    return {
      original: includeOriginal ? entry.original?.slice() : undefined,
      filtered: entry.filtered.slice(),
    };
  }
  write(
    key: string,
    signature: string,
    original: Uint8ClampedArray,
    filtered: Uint8ClampedArray,
  ) {
    this.remove(key);
    const filteredBytes =
      filtered.byteLength + (key.length + signature.length) * 2;
    if (filteredBytes > this.budget) return;
    let keepOriginal = true;
    let bytes = filteredBytes + original.byteLength;
    // Prefer recomputing unfiltered source pixels over losing an expensive filter result.
    for (const entry of this.entries.values()) {
      if (this.bytes + bytes <= this.budget) break;
      if (!entry.original) continue;
      this.bytes -= entry.original.byteLength;
      entry.bytes -= entry.original.byteLength;
      entry.original = undefined;
    }
    if (this.bytes + bytes > this.budget) {
      keepOriginal = false;
      bytes = filteredBytes;
    }
    while (this.bytes + bytes > this.budget || this.entries.size >= 64)
      this.remove(this.entries.keys().next().value!);
    this.entries.set(key, {
      signature,
      original: keepOriginal ? original.slice() : undefined,
      filtered: filtered.slice(),
      bytes,
    });
    this.bytes += bytes;
  }
  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) {
      this.bytes -= entry.bytes;
      this.entries.delete(key);
    }
  }
  clear() {
    this.entries.clear();
    this.bytes = 0;
  }
}
