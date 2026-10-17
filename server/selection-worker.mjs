import { parentPort, workerData } from 'node:worker_threads';
import { readFile } from 'node:fs/promises';
import { tsImport } from 'tsx/esm/api';
try {
  const { instantiateKernel } = await tsImport('../src/engine/wasm.ts', import.meta.url);
  const { modifySelectionCoverage } = await tsImport('../src/engine/selection-modification.ts', import.meta.url);
  const bytes = await readFile(new URL('../public/wasm/pixels.wasm', import.meta.url)).catch(() => {
    throw new Error('Could not load the WASM module. Run npm run build:wasm.');
  });
  const kernel = await instantiateKernel(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength));
  const selection = workerData.channelSelection
    ? await (await tsImport('../src/engine/channel-selection.ts',import.meta.url)).composeChannelSelection(kernel,workerData.channelSelection)
    : await modifySelectionCoverage(kernel,workerData);
  parentPort.postMessage({selection});
} catch (error) {
  parentPort.postMessage({error:error instanceof Error ? error.message : String(error)});
}
