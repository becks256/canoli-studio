import runtimeSource from "../generated/script-runtime.js?raw";
import type { Document } from "../dom";
import type { EditorCommand } from "../core/commands";
import { parseCommands } from "../core/validation";

export interface ScriptResult {
  commands: EditorCommand[];
  selectedId: string | null;
  logs: string[];
}

export class ScriptRunner {
  private cancelCurrent: (() => void) | null = null;
  cancel() {
    this.cancelCurrent?.();
  }

  run(document: Document, code: string): Promise<ScriptResult> {
    this.cancel();
    if (code.length > 50_000)
      return Promise.reject(
        new Error("Scripts must be smaller than 50,000 characters."),
      );
    const snapshot = document.toJSON();
    const selectedId = document.selectedLayer?.id ?? null;
    const iframe = window.document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.hidden = true;
    const source = JSON.stringify(runtimeSource).replaceAll("<", "\\u003c");
    // Inherited by the blob worker: network access and external code imports are
    // denied, and no same-origin permission is granted to the frame.
    iframe.srcdoc = `<!doctype html><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' blob:; worker-src blob:; connect-src 'none';"><script>
      window.onmessage = (event) => {
        if (!event.ports[0]) return;
        const port = event.ports[0]; window.onmessage = null;
        try {
          const url = URL.createObjectURL(new Blob([${source}], { type: 'application/javascript' }));
          const worker = new Worker(url); URL.revokeObjectURL(url);
          worker.onmessage = (event) => port.postMessage(event.data);
          worker.onerror = () => port.postMessage({ type: 'error', error: 'Script worker failed.' });
          port.onmessage = (event) => worker.postMessage(event.data); port.start();
          port.postMessage({ type: 'ready' });
        } catch (error) { port.postMessage({ type: 'error', error: error.message }); }
      };
    <\/script>`;
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      let finished = false;
      const cleanup = () => {
        clearTimeout(timer);
        channel.port1.close();
        iframe.remove();
        this.cancelCurrent = null;
      };
      const fail = (error: Error) => {
        if (finished) return;
        finished = true;
        cleanup();
        reject(error);
      };
      const timer = setTimeout(
        () =>
          fail(
            new Error(
              "Script exceeded its 5-second time limit. No edits were applied.",
            ),
          ),
        5000,
      );
      this.cancelCurrent = () =>
        fail(new Error("Script stopped. No edits were applied."));
      channel.port1.onmessage = (event) => {
        if (finished) return;
        const data = event.data;
        if (data?.type === "ready") {
          channel.port1.postMessage({ document: snapshot, selectedId, code });
          return;
        }
        if (data?.type === "error") {
          fail(
            new Error(
              typeof data.error === "string"
                ? data.error.slice(0, 2000)
                : "Script failed.",
            ),
          );
          return;
        }
        if (data?.type !== "result") {
          fail(new Error("Unexpected script result."));
          return;
        }
        try {
          const commands = parseCommands(data.commands);
          const logs = Array.isArray(data.logs)
            ? data.logs
                .slice(0, 100)
                .map((line: unknown) => String(line).slice(0, 2000))
            : [];
          const selectedId =
            typeof data.selectedId === "string" && data.selectedId.length <= 240
              ? data.selectedId
              : null;
          finished = true;
          cleanup();
          resolve({ commands, selectedId, logs });
        } catch {
          fail(
            new Error(
              "The script returned invalid or unsupported document operations.",
            ),
          );
        }
      };
      iframe.onload = () => {
        iframe.contentWindow?.postMessage("start", "*", [channel.port2]);
      };
      window.document.body.append(iframe);
    });
  }
}
