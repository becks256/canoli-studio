import type { RecoveryAsset, RecoverySummary, RecoveryRestoration } from "./recovery";

type RecoveryJob =
  | { kind: "save"; bytes: Uint8Array<ArrayBuffer>; checksum: string; assets: RecoveryAsset[] }
  | { kind: "summaries" }
  | { kind: "restore"; id: string };

/** A job owns its worker until completion, including after editor disposal. */
function runRecoveryJob<T>(job: RecoveryJob, transfer: Transferable[] = []): Promise<T> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./recovery-persistence.worker.ts", import.meta.url), { type: "module" });
    const fail = (error: Error) => { worker.terminate(); reject(error); };
    worker.onerror = (event) => { event.preventDefault(); fail(new Error(event.message || "Recovery worker failed.")); };
    worker.onmessageerror = () => fail(new Error("Recovery worker response could not be read."));
    worker.onmessage = ({ data }: MessageEvent<{result?: T; error?: {name: string; message: string}}>) => {
      worker.terminate();
      if (data.error) {
        const error = new Error(data.error.message);
        error.name = data.error.name;
        reject(error);
      } else if ("result" in data) resolve(data.result as T);
      else reject(new Error("Invalid recovery worker response."));
    };
    try { worker.postMessage(job, transfer); }
    catch (error) { fail(error instanceof Error ? error : new Error(String(error))); }
  });
}

export function persistRecovery(bytes: Uint8Array<ArrayBuffer>, checksum: string, assets: RecoveryAsset[]): Promise<number> {
  return runRecoveryJob({ kind: "save", bytes, checksum, assets }, [bytes.buffer]);
}

export function listRecoverySummaries(): Promise<RecoverySummary[]> {
  return runRecoveryJob({ kind: "summaries" });
}

export function restoreRecovery(id: string): Promise<RecoveryRestoration> {
  return runRecoveryJob({ kind: "restore", id });
}

export type { RecoveryJob };
