/**
 * Apple PackBits RLE compression and decompression for PSD channel data.
 */

/**
 * Decodes a PackBits RLE compressed byte buffer into raw bytes.
 */
export function decodePackBits(
  src: Uint8Array,
  expectedLength: number,
  strict=false,
): Uint8Array {
  const dest = new Uint8Array(expectedLength);
  let srcPos = 0;
  let destPos = 0;

  while (destPos < expectedLength && srcPos < src.length) {
    const flag = src[srcPos++];
    // Signed interpretation
    const n = flag > 127 ? flag - 256 : flag;

    if (n >= 0) {
      // Literal run: copy n + 1 bytes
      const count = n + 1;
      if(strict&&(srcPos+count>src.length||destPos+count>expectedLength))throw new Error('Invalid Photoshop PackBits literal extent.');
      for (
        let i = 0;
        i < count && destPos < expectedLength && srcPos < src.length;
        i++
      ) {
        dest[destPos++] = src[srcPos++];
      }
    } else if (n > -128) {
      // Replicate run: repeat next byte 1 - n times
      const count = 1 - n;
      if(strict&&(srcPos>=src.length||destPos+count>expectedLength))throw new Error('Invalid Photoshop PackBits repeat extent.');
      if (srcPos < src.length) {
        const val = src[srcPos++];
        for (let i = 0; i < count && destPos < expectedLength; i++) {
          dest[destPos++] = val;
        }
      }
    }
    // n === -128 is a no-op
  }

  if(strict&&(destPos!==expectedLength||src.subarray(srcPos).some(value=>value!==128)))throw new Error('Incomplete or trailing Photoshop PackBits pixels.');
  return dest;
}

/**
 * Encodes a scanline buffer using PackBits RLE compression.
 */
export function encodePackBits(src: Uint8Array): Uint8Array {
  if (src.length === 0) return new Uint8Array(0);
  const out = new Uint8Array(src.length * 2 + 256);
  return out.subarray(0,encodePackBitsInto(src,out));
}

/** Internal reusable destination. Returns byte count; never aliases source bytes. */
export function encodePackBitsInto(src:Uint8Array,out:Uint8Array,offset=0):number {
  const capacity=src.length?src.length*2+256:0;
  if(!Number.isSafeInteger(offset)||offset<0||offset+capacity>out.length)
    throw new RangeError('PackBits destination is too small or its offset is invalid.');
  if(src.buffer===out.buffer&&src.byteOffset<out.byteOffset+offset+capacity&&out.byteOffset+offset<src.byteOffset+src.length)
    throw new Error('PackBits source and destination must not overlap.');
  let srcPos = 0;
  let outPos = offset;

  while (srcPos < src.length) {
    // Check for run of identical bytes
    let runLen = 1;
    const currentVal = src[srcPos];

    while (
      srcPos + runLen < src.length &&
      src[srcPos + runLen] === currentVal &&
      runLen < 128
    ) {
      runLen++;
    }

    if (runLen >= 3) {
      // Emit repeat packet: count = (1 - runLen) represented as 257 - runLen
      out[outPos++] = (257 - runLen) & 0xff;
      out[outPos++] = currentVal;
      srcPos += runLen;
    } else {
      // Find literal sequence (stops at end or when run of >= 3 identical bytes begins)
      let litLen = 0;
      const litStart = srcPos;

      while (srcPos + litLen < src.length && litLen < 128) {
        const p = srcPos + litLen;
        if (
          p + 2 < src.length &&
          src[p] === src[p + 1] &&
          src[p] === src[p + 2]
        ) {
          // Run starts, stop literal
          break;
        }
        litLen++;
      }

      if (litLen > 0) {
        // Emit literal packet: count = litLen - 1
        out[outPos++] = (litLen - 1) & 0xff;
        out.set(src.subarray(litStart,litStart+litLen),outPos);
        outPos+=litLen;
        srcPos += litLen;
      }
    }
  }

  return outPos-offset;
}
