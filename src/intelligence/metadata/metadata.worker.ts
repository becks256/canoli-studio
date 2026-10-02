import { extractMetadata } from "./extract";
import type { MetadataInput } from "./model";
self.onmessage = async (event: MessageEvent<MetadataInput>) => {
  try {
    self.postMessage({ result: await extractMetadata(event.data) });
  } catch {
    self.postMessage({
      error: "Metadata extraction failed. The original image is unchanged.",
    });
  }
};
