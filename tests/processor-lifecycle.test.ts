import { afterEach, expect, it, vi } from "vitest";
import { PixelProcessor } from "../src/engine/processor";

class ControlledWorker {
  static current: ControlledWorker;
  onmessage?: (event: { data: any }) => void;
  onerror?: () => void;
  postMessage = vi.fn();
  terminate = vi.fn();
  constructor() {
    ControlledWorker.current = this;
  }
  ready() {
    this.onmessage?.({ data: { type: "ready" } });
  }
}
afterEach(() => vi.unstubAllGlobals());
function processor() {
  vi.stubGlobal("Worker", ControlledWorker);
  return new PixelProcessor();
}
it("shutdown before worker readiness rejects queued work and future requests", async () => {
  const p = processor(),
    worker = ControlledWorker.current;
  const pixels = new Uint8ClampedArray([1, 2, 3, 255]);
  const first = p.process(pixels, []);
  p.dispose();
  p.dispose();
  await expect(first).rejects.toThrow("closed");
  await expect(p.ready).rejects.toThrow("closed");
  worker.ready();
  await expect(p.process(pixels, [])).rejects.toThrow("closed");
  expect(worker.postMessage).not.toHaveBeenCalled();
  expect(worker.terminate).toHaveBeenCalledTimes(1);
  expect([...pixels]).toEqual([1, 2, 3, 255]);
});
it("shutdown rejects active search and solver requests without waiting for replies", async () => {
  const p = processor(),
    worker = ControlledWorker.current;
  worker.ready();
  await p.ready;
  const pixels = new Uint8ClampedArray(36),
    mask = new Uint8Array(9);
  const search = p.findDonor(pixels, 3, 3, mask);
  const solve = p.poissonBlend(pixels, pixels, 3, 3, mask);
  await Promise.resolve();
  expect(worker.postMessage).toHaveBeenCalledTimes(2);
  p.dispose();
  await expect(search).rejects.toThrow("closed");
  await expect(solve).rejects.toThrow("closed");
});
it("a message cloning error rejects only its request and does not retain it", async () => {
  const p = processor(),
    worker = ControlledWorker.current;
  worker.ready();
  await p.ready;
  worker.postMessage.mockImplementationOnce(() => {
    throw new Error("clone failed");
  });
  await expect(p.process(new Uint8ClampedArray(4), [])).rejects.toThrow(
    "clone failed",
  );
  const next = p.process(new Uint8ClampedArray(4), []);
  await Promise.resolve();
  const id = worker.postMessage.mock.calls.at(-1)![0].id;
  worker.onmessage?.({
    data: { id, pixels: new Uint8ClampedArray([9, 8, 7, 6]) },
  });
  expect([...(await next)]).toEqual([9, 8, 7, 6]);
  p.dispose();
});

it('selection progress retains the pending result and snapshots inputs before readiness',async()=>{
  const p=processor(),worker=ControlledWorker.current;
  const input={operation:'expand' as const,radius:2,width:20,height:20,selection:{regions:[{shape:'rectangle' as const,operation:'add' as const,x:2,y:2,width:4,height:4}]}};
  const progress=vi.fn();let settled=false;
  const pending=p.modifySelection(input,progress).then(value=>{settled=true;return value;});
  input.radius=10;input.selection.regions[0].width=19;
  worker.ready();await p.ready;await Promise.resolve();
  const message=worker.postMessage.mock.calls.at(-1)![0];
  expect(message.selectionModification.radius).toBe(2);
  expect(message.selectionModification.selection.regions[0].width).toBe(4);
  worker.onmessage?.({data:{id:message.id,type:'progress',progress:{completed:1,total:2}}});
  await Promise.resolve();expect(settled).toBe(false);
  expect(progress).toHaveBeenCalledWith({completed:1,total:2});
  worker.onmessage?.({data:{id:message.id,selectionResult:{regions:[]}}});
  expect(await pending).toEqual({regions:[]});p.dispose();
});

it('a failing progress callback rejects only its request and ignores late output',async()=>{
  const p=processor(),worker=ControlledWorker.current;worker.ready();await p.ready;
  const failed=p.modifySelection({operation:'feather',radius:1,width:1,height:1,selection:{regions:[]}},()=>{throw new Error('Progress callback failed');});
  const next=p.process(new Uint8ClampedArray(4),[]);
  await Promise.resolve();
  const first=worker.postMessage.mock.calls[0][0],second=worker.postMessage.mock.calls[1][0];
  worker.onmessage?.({data:{id:first.id,type:'progress',progress:{completed:0,total:1}}});
  await expect(failed).rejects.toThrow('Progress callback failed');
  worker.onmessage?.({data:{id:first.id,selectionResult:{regions:[]}}});
  worker.onmessage?.({data:{id:second.id,pixels:new Uint8ClampedArray([1,2,3,4])}});
  expect([...(await next)]).toEqual([1,2,3,4]);p.dispose();
});
