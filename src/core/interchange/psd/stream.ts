/**
 * Big-Endian Binary Stream Reader & Writer for PSD/PSB file interchange.
 */

export class ByteReader {
  private view: DataView;
  private offset = 0;

  constructor(public readonly buffer: Uint8Array) {
    this.view = new DataView(
      buffer.buffer,
      buffer.byteOffset,
      buffer.byteLength,
    );
  }

  get position(): number {
    return this.offset;
  }

  get length(): number {
    return this.buffer.byteLength;
  }

  remaining(): number {
    return this.buffer.byteLength - this.offset;
  }

  seek(pos: number): void {
    if (!Number.isSafeInteger(pos)||pos < 0 || pos > this.buffer.byteLength) {
      throw new RangeError(
        `ByteReader seek out of bounds: ${pos} (max: ${this.buffer.byteLength})`,
      );
    }
    this.offset = pos;
  }

  skip(bytes: number): void {
    this.seek(this.offset + bytes);
  }

  readUint8(): number {
    const val = this.view.getUint8(this.offset);
    this.offset += 1;
    return val;
  }

  readInt8(): number {
    const val = this.view.getInt8(this.offset);
    this.offset += 1;
    return val;
  }

  readUint16(): number {
    const val = this.view.getUint16(this.offset, false);
    this.offset += 2;
    return val;
  }

  readInt16(): number {
    const val = this.view.getInt16(this.offset, false);
    this.offset += 2;
    return val;
  }

  readUint32(): number {
    const val = this.view.getUint32(this.offset, false);
    this.offset += 4;
    return val;
  }

  readUint64(): number {
    const high = this.view.getUint32(this.offset, false);
    const low = this.view.getUint32(this.offset + 4, false);
    this.offset += 8;
    const value=high * 0x100000000 + low;
    if(!Number.isSafeInteger(value))throw new Error('Photoshop length exceeds exact browser addressing.');
    return value;
  }

  readInt32(): number {
    const val = this.view.getInt32(this.offset, false);
    this.offset += 4;
    return val;
  }

  readAscii(len: number): string {
    let str = "";
    for (let i = 0; i < len; i++) {
      const c = this.readUint8();
      if (c !== 0) str += String.fromCharCode(c);
    }
    return str;
  }

  readPascalString(paddedTo = 1): string {
    const len = this.readUint8();
    let str = "";
    for (let i = 0; i < len; i++) {
      str += String.fromCharCode(this.readUint8());
    }
    const totalRead = 1 + len;
    const remainder = totalRead % paddedTo;
    if (remainder !== 0) {
      this.skip(paddedTo - remainder);
    }
    return str;
  }

  readUnicodeString(): string {
    const charCount = this.readUint32();
    let str = "";
    for (let i = 0; i < charCount; i++) {
      const code = this.readUint16();
      if (code !== 0) str += String.fromCharCode(code);
    }
    return str;
  }

  readBytes(len: number): Uint8Array {
    if (!Number.isSafeInteger(len)||len<0||this.offset + len > this.buffer.byteLength) {
      throw new RangeError(
        `ByteReader readBytes out of bounds: requested ${len}, remaining ${this.remaining()}`,
      );
    }
    const slice = this.buffer.subarray(this.offset, this.offset + len);
    this.offset += len;
    return slice;
  }
}

export class ByteWriter {
  private buffer: Uint8Array;
  private view: DataView;
  private offset = 0;

  constructor(initialCapacity = 65536) {
    this.buffer = new Uint8Array(initialCapacity);
    this.view = new DataView(this.buffer.buffer);
  }

  get position(): number {
    return this.offset;
  }

  private ensureCapacity(neededBytes: number): void {
    if (this.offset + neededBytes > this.buffer.byteLength) {
      let newCapacity = Math.max(
        this.buffer.byteLength * 2,
        this.offset + neededBytes + 65536,
      );
      const newBuf = new Uint8Array(newCapacity);
      newBuf.set(this.buffer);
      this.buffer = newBuf;
      this.view = new DataView(this.buffer.buffer);
    }
  }

  seek(pos: number): void {
    if (pos > this.buffer.byteLength) {
      this.ensureCapacity(pos - this.offset);
    }
    this.offset = pos;
  }

  skip(bytes: number): void {
    this.ensureCapacity(bytes);
    this.offset += bytes;
  }

  writeUint8(val: number): void {
    this.ensureCapacity(1);
    this.view.setUint8(this.offset, val & 0xff);
    this.offset += 1;
  }

  writeInt8(val: number): void {
    this.ensureCapacity(1);
    this.view.setInt8(this.offset, val);
    this.offset += 1;
  }

  writeUint16(val: number): void {
    this.ensureCapacity(2);
    this.view.setUint16(this.offset, val & 0xffff, false);
    this.offset += 2;
  }

  writeInt16(val: number): void {
    this.ensureCapacity(2);
    this.view.setInt16(this.offset, val, false);
    this.offset += 2;
  }

  writeUint32(val: number): void {
    this.ensureCapacity(4);
    this.view.setUint32(this.offset, val >>> 0, false);
    this.offset += 4;
  }

  writeUint64(val: number): void {
    if(!Number.isSafeInteger(val)||val<0)throw new Error('Photoshop length exceeds exact browser addressing.');
    this.ensureCapacity(8);
    const high = Math.floor(val / 0x100000000);
    const low = val >>> 0;
    this.view.setUint32(this.offset, high, false);
    this.view.setUint32(this.offset + 4, low, false);
    this.offset += 8;
  }

  writeInt32(val: number): void {
    this.ensureCapacity(4);
    this.view.setInt32(this.offset, val, false);
    this.offset += 4;
  }

  writeAscii(str: string, exactLen?: number): void {
    const len = exactLen ?? str.length;
    this.ensureCapacity(len);
    for (let i = 0; i < len; i++) {
      this.writeUint8(i < str.length ? str.charCodeAt(i) : 0);
    }
  }

  writePascalString(str: string, paddedTo = 1): void {
    const len = Math.min(255, str.length);
    this.writeUint8(len);
    for (let i = 0; i < len; i++) {
      this.writeUint8(str.charCodeAt(i));
    }
    const total = 1 + len;
    const remainder = total % paddedTo;
    if (remainder !== 0) {
      const pad = paddedTo - remainder;
      for (let i = 0; i < pad; i++) {
        this.writeUint8(0);
      }
    }
  }

  writeUnicodeString(str: string): void {
    this.writeUint32(str.length);
    for (let i = 0; i < str.length; i++) {
      this.writeUint16(str.charCodeAt(i));
    }
  }

  writeBytes(bytes: Uint8Array): void {
    this.ensureCapacity(bytes.byteLength);
    this.buffer.set(bytes, this.offset);
    this.offset += bytes.byteLength;
  }

  getBuffer(): Uint8Array {
    return this.buffer.subarray(0, this.offset);
  }
}
