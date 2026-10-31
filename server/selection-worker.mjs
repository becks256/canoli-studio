import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import './typescript-worker.mjs';
try {
  const { instantiateKernel } = await import('../src/engine/wasm.ts');
  const { modifySelectionCoverage } = await import('../src/engine/selection-modification.ts');
  const bytes = await readFile(new URL('../public/wasm/pixels.wasm', import.meta.url)).catch(() => {
    throw new Error('Could not load the WASM module. Run npm run build:wasm.');
  });
  const kernel = await instantiateKernel(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const selection = workerData.channelSelection
    ? await (await import('../src/engine/channel-selection.ts')).composeChannelSelection(kernel,workerData.channelSelection)
    : await modifySelectionCoverage(kernel,workerData);
  parentPort.postMessage({selection});
} catch (error) {
  parentPort.postMessage({error:error instanceof Error ? error.message : String(error)});
}
