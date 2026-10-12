import {createDeflate} from "node:zlib";
import {once} from "node:events";

function pngChunk(name: string, data: Buffer) {
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length);
  result.write(name, 4);
  data.copy(result, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < result.length - 4; i++) {
    crc ^= result[i];
    for (let bit = 0; bit < 8; bit++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
export async function sourcePng(width: number, height: number) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 6;
  const row = Buffer.alloc(width * 4 + 1);
  for (let x = 0; x < width; x++) {
    row[1 + x * 4] = 40;
    row[2 + x * 4] = 60;
    row[3 + x * 4] = 80;
    row[4 + x * 4] = 255;
  }
  const deflate = createDeflate();
  const chunks: Buffer[] = [];
  deflate.on("data", (chunk) => chunks.push(chunk));
  const end = once(deflate, "end");
  for (let y = 0; y < height; y++)
    if (!deflate.write(row)) await once(deflate, "drain");
  deflate.end();
  await end;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", Buffer.concat(chunks)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}
