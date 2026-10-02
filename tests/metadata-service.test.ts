import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MetadataService } from "../src/intelligence/metadata/service";
import { normalizeMetadata } from "../src/intelligence/metadata/model";

const input = {
  blob: new Blob(["fixture"]),
  name: "fixture.jpg",
  width: 8,
  height: 4,
};
const result = normalizeMetadata(
  { ...input, size: 7, type: "image/jpeg" },
  undefined,
);
class TestWorker {
  static instances: TestWorker[] = [];
  static failure = false;
  onmessage?: (event: { data: unknown }) => void;
  onerror?: (event: { preventDefault(): void }) => void;
  onmessageerror?: () => void;
  terminate = vi.fn();
  postMessage = vi.fn();
  constructor() {
    if (TestWorker.failure) throw new Error("Worker unavailable");
    TestWorker.instances.push(this);
  }
  respond() {
    this.onmessage?.({ data: { result } });
  }
}

describe("metadata worker lifecycle", () => {
  let service: MetadataService;
  beforeEach(() => {
    vi.useFakeTimers();
    TestWorker.instances = [];
    TestWorker.failure = false;
    vi.stubGlobal("Worker", TestWorker);
    service = new MetadataService();
  });
  afterEach(() => {
    service.dispose();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("terminates stalled analysis and lets the next asset finish", async () => {
    service.analyze("slow", input);
    service.analyze("next", input);
    expect(TestWorker.instances).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(8000);
    expect(service.get("slow")).toMatchObject({
      status: "error",
      message: expect.stringContaining("timed out"),
    });
    expect(TestWorker.instances[0].terminate).toHaveBeenCalledOnce();
    expect(TestWorker.instances).toHaveLength(2);
    TestWorker.instances[1].respond();
    expect(service.get("next")).toEqual({ status: "ready", result });
  });

  it("ignores late callbacks after an asset ID is removed and reused", () => {
    service.analyze("same-id", input);
    const old = TestWorker.instances[0];
    service.remove("same-id");
    service.analyze("same-id", input);
    const current = TestWorker.instances[1];
    old.respond();
    expect(service.get("same-id")).toEqual({ status: "pending" });
    expect(current.terminate).not.toHaveBeenCalled();
    current.respond();
    expect(service.get("same-id")).toEqual({ status: "ready", result });
  });

  it("cancels queued work and never restarts a disposed store", async () => {
    service.analyze("active", input);
    service.analyze("removed", input);
    service.remove("removed");
    const old = TestWorker.instances[0];
    service.dispose();
    old.respond();
    service.analyze("after-dispose", input);
    await vi.advanceTimersByTimeAsync(16000);
    expect(TestWorker.instances).toHaveLength(1);
    expect(old.terminate).toHaveBeenCalledOnce();
    expect(service.get("active")).toBeUndefined();
    expect(service.get("removed")).toBeUndefined();
    expect(service.get("after-dispose")).toBeUndefined();
  });

  it("recovers its queue after worker decoding and construction failures", async () => {
    service.analyze("unreadable", input);
    service.analyze("unavailable", input);
    TestWorker.failure = true;
    TestWorker.instances[0].onmessageerror?.();
    await vi.advanceTimersByTimeAsync(0);
    expect(service.get("unreadable")).toMatchObject({ status: "error" });
    expect(service.get("unavailable")).toMatchObject({ status: "error" });
    TestWorker.failure = false;
    service.analyze("working", input);
    TestWorker.instances[1].respond();
    expect(service.get("working")).toEqual({ status: "ready", result });
  });
});
