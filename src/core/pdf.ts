/** PDF 1.7 objects with a 64-bit cross-reference stream. Payloads remain Blobs. */
const ascii = (text: string) => new TextEncoder().encode(text);
const exact = (value: number) => Number.isSafeInteger(value) && value >= 0;

/** PDF real syntax has no exponent notation. Preserve the JS value's digits. */
export function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) throw new Error("PDF numbers must be finite.");
  if (Object.is(value, -0)) return "0";
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const negative = value < 0, [mantissa, exponent] = text.replace(/^-/, "").split(/[eE]/);
  const [whole, fraction = ""] = mantissa.split("."), digits = whole + fraction;
  const point = whole.length + Number(exponent);
  const expanded = point <= 0 ? "0." + "0".repeat(-point) + digits
    : point >= digits.length ? digits + "0".repeat(point - digits.length)
    : digits.slice(0, point) + "." + digits.slice(point);
  return (negative ? "-" : "") + expanded;
}

export function pdfPageGeometry(width: number, height: number, dpi: unknown = 72) {
  if (![width, height].every(n => Number.isSafeInteger(n) && n > 0))
    throw new Error("PDF dimensions must be positive safe integers.");
  if (typeof dpi !== "number" || !Number.isFinite(dpi) || dpi <= 0)
    throw new Error("PDF resolution must be a positive finite DPI value.");
  const pointsWidth = width * (72 / dpi), pointsHeight = height * (72 / dpi);
  const userUnit = Math.max(1, Math.ceil(Math.max(pointsWidth, pointsHeight) / 14400));
  if (![pointsWidth, pointsHeight].every(n => Number.isFinite(n) && n > 0) || userUnit > 75000)
    throw new Error("This PDF page exceeds supported physical page geometry. Increase PDF DPI or save a native project.");
  return { width: pointsWidth / userUnit, height: pointsHeight / userUnit, userUnit, scale: 72 / dpi / userUnit, dpi };
}

/** @internal Exposed separately so multi-GiB addresses can be checked without allocating such files. */
export function pdfCrossReferences(offsets: readonly number[]): Uint8Array<ArrayBuffer> {
  if (!offsets.length || offsets[0] !== 0 || !offsets.every(exact)) throw new Error("Invalid PDF object offsets.");
  const bytes = new Uint8Array(offsets.length * 11), view = new DataView(bytes.buffer);
  view.setUint16(9, 65535);
  for (let i = 1; i < offsets.length; i++) {
    if (offsets[i] === 0) throw new Error("Unwritten PDF object.");
    const at = i * 11; bytes[at] = 1; view.setBigUint64(at + 1, BigInt(offsets[i]));
  }
  return bytes;
}

export class PdfWriter {
  private parts: BlobPart[] = [new Uint8Array([37,80,68,70,45,49,46,55,10,37,226,227,207,211,10])];
  private bytes = 15;
  private offsets: number[] = [0];
  private closed = false;
  reserve(): number {
    if (this.closed) throw new Error("PDF writer is closed.");
    return this.offsets.push(0) - 1;
  }
  private append(part: Blob | Uint8Array<ArrayBuffer>) {
    const length = part instanceof Blob ? part.size : part.length;
    if (!exact(this.bytes + length)) throw new Error("PDF output exceeds exact browser file addressing.");
    this.bytes += length; this.parts.push(part);
  }
  object(id: number, body: string | Blob): void {
    if (this.closed || !Number.isInteger(id) || id < 1 || id >= this.offsets.length || this.offsets[id])
      throw new Error("Invalid or duplicate PDF object.");
    this.offsets[id] = this.bytes;
    this.append(ascii(`${id} 0 obj\n`));
    this.append(typeof body === "string" ? ascii(body) : body);
    this.append(ascii("\nendobj\n"));
  }
  stream(id: number, dictionary: string, data: Blob): void {
    this.object(id, new Blob([`<< ${dictionary} /Length ${data.size} >>\nstream\n`, data, "\nendstream"]));
  }
  finish(root: number, info: number): Blob {
    if (!this.offsets[root] || !this.offsets[info]) throw new Error("Missing PDF root or producer.");
    const xref = this.reserve(), start = this.bytes;
    this.offsets[xref] = start;
    const references = pdfCrossReferences(this.offsets);
    this.offsets[xref] = 0;
    this.stream(xref, `/Type /XRef /Size ${this.offsets.length} /W [1 8 2] /Root ${root} 0 R /Info ${info} 0 R`, new Blob([references]));
    this.append(ascii(`startxref\n${start}\n%%EOF\n`));
    const result = new Blob(this.parts, {type:"application/pdf"});
    if (result.size !== this.bytes) throw new Error("PDF output size does not match its cross references.");
    this.closed = true; this.parts = []; this.offsets = []; return result;
  }
  abort(): void { this.closed = true; this.parts = []; this.offsets = []; }
}
