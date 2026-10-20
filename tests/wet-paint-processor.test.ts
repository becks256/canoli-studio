import { afterEach, expect, it, vi } from 'vitest';
import { PixelProcessor } from '../src/engine/processor';

class ControlledWorker {
  static current: ControlledWorker;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() { ControlledWorker.current = this; }
  ready() { this.onmessage?.({ data: { type: 'ready' } }); }
  result(id: number, result: object) { this.onmessage?.({ data: { id, ...result } }); }
}
afterEach(() => vi.unstubAllGlobals());
function create() { vi.stubGlobal('Worker', ControlledWorker); const processor = new PixelProcessor(); return { processor, worker: ControlledWorker.current }; }

it('captures all wet paint inputs synchronously and transfers exclusively private copies', async () => {
  const { processor, worker } = create();
  try {
    const pixels = new Uint8ClampedArray([0, 0, 255, 255]), carried = new Float32Array([1, 0, 0, 1]), mask = new Uint8Array([128]), options = { flow: .5, wetness: .25, pickup: .5 };
    const pending = processor.mixWetPaint(pixels, carried, mask, options);
    void pending.catch(() => {});
    pixels.fill(0); carried.fill(0); mask.fill(0); options.flow = 0;
    worker.ready(); await processor.ready;
    const [message, transfer] = worker.postMessage.mock.calls[0];
    expect([...message.pixels]).toEqual([0, 0, 255, 255]);
    expect([...message.wetPaintMix.carried]).toEqual([1, 0, 0, 1]);
    expect([...message.wetPaintMix.coverage]).toEqual([128]);
    expect(message.wetPaintMix.settings).toEqual({ flow: .5, wetness: .25, pickup: .5 });
    expect(transfer).toEqual([message.pixels.buffer, message.wetPaintMix.carried.buffer, message.wetPaintMix.coverage.buffer]);
    expect(transfer).not.toContain(pixels.buffer); expect(transfer).not.toContain(carried.buffer); expect(transfer).not.toContain(mask.buffer);
    worker.result(message.id, { wetPaint: { pixels: new Uint8ClampedArray([255, 0, 0, 255]), carried: new Float32Array([1, 0, 0, 1]) } });
    expect([...(await pending).pixels]).toEqual([255, 0, 0, 255]);
  } finally { processor.dispose(); }
});

it('rejects malformed worker pixels and nonfinite/nonpremultiplied reservoirs without poisoning later requests', async () => {
  const { processor, worker } = create(); worker.ready(); await processor.ready;
  try {
    const pixels = new Uint8ClampedArray(4), carried = new Float32Array(4), mask = new Uint8Array([255]);
    for (const result of [null, { pixels: new Uint8Array(4), carried }, { pixels: new Uint8ClampedArray(8), carried }, { pixels, carried: new Float32Array(8) }, { pixels, carried: new Float32Array([1, 0, 0, .5]) }, { pixels, carried: new Float32Array([NaN, 0, 0, 0]) }]) {
      const pending = processor.mixWetPaint(pixels, carried, mask);
      await Promise.resolve(); const message = worker.postMessage.mock.calls.at(-1)![0];
      worker.result(message.id, { wetPaint: result }); await expect(pending).rejects.toThrow();
    }
    const badLoad = processor.loadWetPaint(pixels); await Promise.resolve();
    worker.result(worker.postMessage.mock.calls.at(-1)![0].id, { wetPaintCarried: new Float32Array([0, 0, 0, 2]) });
    await expect(badLoad).rejects.toThrow(/alpha/);
    const goodLoad = processor.loadWetPaint(pixels); await Promise.resolve();
    worker.result(worker.postMessage.mock.calls.at(-1)![0].id, { wetPaintCarried: new Float32Array(4) });
    expect(await goodLoad).toEqual(new Float32Array(4));
  } finally { processor.dispose(); }
});

it('disposal rejects wet paint work queued before readiness or in flight and retains caller ownership', async () => {
  for (const ready of [false, true]) {
    const { processor, worker } = create();
    if (ready) { worker.ready(); await processor.ready; }
    const pixels = new Uint8ClampedArray([255, 0, 0, 255]), carried = new Float32Array([1, 0, 0, 1]), mask = new Uint8Array([255]);
    const load = processor.loadWetPaint(pixels), mix = processor.mixWetPaint(pixels, carried, mask);
    if (ready) await Promise.resolve();
    processor.dispose(); await expect(load).rejects.toThrow(/closed/); await expect(mix).rejects.toThrow(/closed/);
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect([...pixels]).toEqual([255, 0, 0, 255]); expect([...carried]).toEqual([1, 0, 0, 1]); expect([...mask]).toEqual([255]);
    if (!ready) expect(worker.postMessage).not.toHaveBeenCalled();
  }
});

it('red-eye processing snapshots queued inputs, validates result type and extent, and rejects disposal', async () => {
  const {processor,worker}=create();
  try {
    const pixels=new Uint8ClampedArray([220,20,40,255]),settings={kind:'red-eye' as const,threshold:32,strength:100};
    const pending=processor.redEye(pixels,settings);pixels.fill(0);settings.strength=0;worker.ready();await processor.ready;await Promise.resolve();
    const sent=worker.postMessage.mock.calls.at(-1)![0];expect([...sent.pixels]).toEqual([220,20,40,255]);expect(sent.redEye.strength).toBe(100);
    worker.result(sent.id,{pixels:new Uint8ClampedArray([30,20,40,255])});expect([...await pending]).toEqual([30,20,40,255]);
    for(const value of [new Uint8Array(4),new Uint8ClampedArray(3)]){
      const bad=processor.redEye(pixels,settings);await Promise.resolve();worker.result(worker.postMessage.mock.calls.at(-1)![0].id,{pixels:value});await expect(bad).rejects.toThrow(/worker result/);
    }
    await expect(processor.redEye(new Uint8ClampedArray(3),settings)).rejects.toThrow(/RGBA/);
    const stopped=processor.redEye(pixels,settings);processor.dispose();await expect(stopped).rejects.toThrow(/closed/);
  } finally {processor.dispose();}
});
