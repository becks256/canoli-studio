import { expect, it } from "vitest";
import { createZipArchive, zipEntryHeaders } from "../src/ai/batch/zip";

it.each([65534, 65535, 65536])(
  "encodes %i directory entries without count truncation",
  async (count) => {
    const blob = createZipArchive(
      Array.from({ length: count }, (_, i) => ({
        name: `${i}.txt`,
        data: new Uint8Array(),
      })),
    );
    const data = new Uint8Array(await blob.arrayBuffer()),
      view = new DataView(data.buffer),
      end = data.length - 22;
    expect(view.getUint32(end, true)).toBe(0x06054b50);
    expect(view.getUint16(end + 10, true)).toBe(Math.min(count, 65535));
    const directory = view.getUint32(end + 16, true);
    let cursor = directory;
    for (let i = 0; i < count; i++) {
      expect(view.getUint32(cursor, true)).toBe(0x02014b50);
      const nameLength = view.getUint16(cursor + 28, true);
      expect(
        new TextDecoder().decode(
          data.subarray(cursor + 46, cursor + 46 + nameLength),
        ),
      ).toBe(`${i}.txt`);
      cursor +=
        46 +
        nameLength +
        view.getUint16(cursor + 30, true) +
        view.getUint16(cursor + 32, true);
    }
    if (count >= 65535) {
      expect(view.getUint32(cursor, true)).toBe(0x06064b50);
      expect(view.getBigUint64(cursor + 4, true)).toBe(44n);
      expect(view.getBigUint64(cursor + 24, true)).toBe(BigInt(count));
      expect(view.getBigUint64(cursor + 32, true)).toBe(BigInt(count));
      expect(view.getBigUint64(cursor + 40, true)).toBe(
        BigInt(cursor - directory),
      );
      expect(view.getBigUint64(cursor + 48, true)).toBe(BigInt(directory));
      expect(view.getUint32(end - 20, true)).toBe(0x07064b50);
      expect(view.getBigUint64(end - 12, true)).toBe(BigInt(cursor));
      expect(view.getUint32(end - 4, true)).toBe(1);
    } else expect(cursor).toBe(end);
  },
  20000,
);

it("encodes size and offset overflow independently and in the required ZIP64 field order", () => {
  for (const size of [0xfffffffe, 0xffffffff, 0x100000001])
    for (const offset of [0xfffffffe, 0xffffffff, 0x100000002]) {
      const { local, central } = zipEntryHeaders("x", size, 123, offset);
      const l = new DataView(local.buffer),
        c = new DataView(central.buffer);
      expect(l.getUint32(18, true)).toBe(Math.min(size, 0xffffffff));
      expect(l.getUint32(22, true)).toBe(Math.min(size, 0xffffffff));
      expect(c.getUint32(42, true)).toBe(Math.min(offset, 0xffffffff));
      if (size >= 0xffffffff) {
        expect(l.getUint16(4, true)).toBe(45);
        expect(l.getUint16(31, true)).toBe(1);
        expect(l.getUint16(33, true)).toBe(16);
        expect(l.getBigUint64(35, true)).toBe(BigInt(size));
        expect(l.getBigUint64(43, true)).toBe(BigInt(size));
      } else expect(l.getUint16(28, true)).toBe(0);
      const values = [
        ...(size >= 0xffffffff ? [size, size] : []),
        ...(offset >= 0xffffffff ? [offset] : []),
      ];
      expect(c.getUint16(30, true)).toBe(
        values.length ? 4 + values.length * 8 : 0,
      );
      if (values.length) {
        expect(c.getUint16(47, true)).toBe(1);
        values.forEach((value, i) =>
          expect(c.getBigUint64(51 + i * 8, true)).toBe(BigInt(value)),
        );
      }
    }
});

it("snapshots payload bytes and preserves UTF-8 and normalized path names", async () => {
  const bytes = new Uint8Array([1, 2, 3]);
  const archive = createZipArchive([{ name: "art\\é.png", data: bytes }]);
  bytes.fill(9);
  const data = new Uint8Array(await archive.arrayBuffer()),
    view = new DataView(data.buffer);
  const length = view.getUint16(26, true);
  expect(new TextDecoder().decode(data.subarray(30, 30 + length))).toBe(
    "art/é.png",
  );
  expect([...data.subarray(30 + length, 33 + length)]).toEqual([1, 2, 3]);
});
