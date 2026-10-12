import { expect, it } from "vitest";
import { GraphReceiver, sendGraph, type GraphChunk } from "../src/workspace/graph-transfer";

it("transports shared history graphs across batches without duplicating artwork", async () => {
  const points = Array.from({ length: 8000 }, (_, x) => ({ x, y: -x, pressure: 0.5 }));
  const layer = { points };
  const root = { document: { layer }, history: [{ layer }, { layer }], empty: {}, undef: undefined };
  const receiver = new GraphReceiver();
  let batches = 0, firstReturn = false, yielded = false;
  const pending = sendGraph(root, chunk => {
    if (firstReturn) yielded = true;
    batches++;
    receiver.add(structuredClone(chunk));
  });
  firstReturn = true;
  await pending;
  const result = receiver.finish<typeof root>();
  expect(batches).toBeGreaterThan(1);
  expect(yielded).toBe(true);
  expect(result).toEqual(root);
  expect(result.document.layer).toBe(result.history[0].layer);
  expect(result.history[0].layer).toBe(result.history[1].layer);
  expect(result.document.layer).not.toBe(layer);
  expect(Object.hasOwn(result, "undef")).toBe(true);
});

it("preserves sparse arrays and own prototype-named properties safely", async () => {
  const root = JSON.parse('{"__proto__":{"safe":true},"constructor":"own"}');
  root.array = new Array(20); root.array[10] = null;
  const receiver = new GraphReceiver();
  await sendGraph(root, chunk => receiver.add(structuredClone(chunk)));
  const result = receiver.finish<typeof root>();
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype);
  expect(Object.hasOwn(result, "__proto__")).toBe(true);
  expect(result).toEqual(root);
  expect(0 in result.array).toBe(false);
  expect(result.array.length).toBe(20);
});

it("stops transport when its owner cancels and rejects unsupported data", async () => {
  const chunks: GraphChunk[] = [];
  await expect(sendGraph({ values: Array.from({ length: 8000 }, (_, x) => ({ x })) }, chunk => {
    chunks.push(chunk);
    throw new Error("Cancelled");
  })).rejects.toThrow("Cancelled");
  expect(chunks).toHaveLength(1);
  await expect(sendGraph({ date: new Date() }, () => {})).rejects.toThrow("plain data");
});
