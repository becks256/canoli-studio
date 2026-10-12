import { RecoveryRepository, type RecoveryEntry } from "./recovery";
import type { RecoveryJob } from "./recovery-persistence";

self.onmessage = async ({ data }: MessageEvent<RecoveryJob>) => {
  try {
    const repository = new RecoveryRepository();
    if (data.kind === "summaries") {
      self.postMessage({ result: await repository.readSummaries() });
      return;
    }
    if (data.kind === "restore") {
      self.postMessage({ result: await repository.readRestoration(data.id) });
      return;
    }
    const entry: RecoveryEntry = JSON.parse(new TextDecoder().decode(data.bytes));
    entry.version = 2;
    entry.checksum = data.checksum;
    self.postMessage({ result: await repository.persist(entry, data.assets) });
  } catch (error) {
    self.postMessage({ error: {
      name: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    } });
  }
};
