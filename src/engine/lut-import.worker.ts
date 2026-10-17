import { parseCubeLut, serializeCubeLut, type CubeLutData } from "../core/lut";

self.onmessage = async (event: MessageEvent<{ file?: File; lut?: CubeLutData }>) => {
  try {
    if (event.data.file) self.postMessage({ lut: parseCubeLut(await event.data.file.text()) });
    else if (event.data.lut) self.postMessage({ source: serializeCubeLut(event.data.lut) });
    else throw new Error("Choose a .cube LUT file.");
  } catch (error) { self.postMessage({ error: error instanceof Error ? error.message : String(error) }); }
};
