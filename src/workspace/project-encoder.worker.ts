import { freeze } from "../core/immutable";
import { serializeProject } from "../core/project";
import { GraphReceiver } from "./graph-transfer";
import type { ProjectEncodingRequest, ProjectEncodingMessage } from "./project-encoder";
let queue = Promise.resolve();
const receiving = new Map<number, GraphReceiver>();
self.onmessage = ({ data: message }: MessageEvent<ProjectEncodingMessage>) => {
  if (message.type === "abort") { receiving.delete(message.id); return; }
  if (message.type === "chunk") {
    let receiver = receiving.get(message.id);
    if (!receiver) { receiver = new GraphReceiver(); receiving.set(message.id, receiver); }
    receiver.add(message.chunk);
    return;
  }
  const receiver = receiving.get(message.id);
  receiving.delete(message.id);
  const data = { ...receiver!.finish<Pick<ProjectEncodingRequest, "document" | "history">>(), id: message.id, assets: message.assets };
  queue = queue.then(async () => {
    try {
      freeze(data.document);
      freeze(data.history);
      const assets = new Map(data.assets.map(asset => [asset.id, asset]));
      const blob = await serializeProject(data.document, { get(id) {
        const asset = assets.get(id);
        if (!asset) throw new Error(`Missing project asset: ${id}`);
        return asset;
      } }, data.history);
      self.postMessage({ id: data.id, blob });
    } catch (error) {
      self.postMessage({ id: data.id, error: error instanceof Error ? error.message : String(error) });
    }
  });
};
