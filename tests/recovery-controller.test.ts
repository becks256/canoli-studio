import { expect, it, vi } from "vitest";
import { RecoveryController } from "../src/core/recovery-controller";
import { createDocument } from "../src/core/model";
import { AssetStore } from "../src/core/assets";
import { storageErrorMessage } from "../src/core/storage-errors";

it("retains a failed capture for explicit retry without spinning or requiring another edit", async () => {
  const controller = new RecoveryController();
  const assets = {} as AssetStore; // Empty documents reference no assets.
  const doc = createDocument("Captured");
  const save = vi
    .spyOn(controller.repository, "save")
    .mockRejectedValueOnce(new DOMException("Full", "QuotaExceededError"))
    .mockResolvedValue(42);
  try {
    controller.schedule("session", doc, assets);
    await controller.flush();
    expect(save).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({
      status: "error",
      savedAt: null,
    });
    expect(controller.getSnapshot().message).toContain(
      "Browser storage is full",
    );
    await controller.flush();
    expect(save).toHaveBeenCalledTimes(2);
    expect(save.mock.calls[1][1].name).toBe("Captured");
    expect(controller.getSnapshot()).toMatchObject({
      status: "saved",
      savedAt: 42,
    });
  } finally {
    controller.dispose();
  }
});

it("a newer capture replaces failed work while other sessions keep progressing", async () => {
  const controller = new RecoveryController();
  const assets = {} as AssetStore;
  const save = vi
    .spyOn(controller.repository, "save")
    .mockRejectedValueOnce(new Error("Storage failed"))
    .mockResolvedValue(42);
  try {
    controller.schedule("first", createDocument("Old"), assets);
    controller.schedule("second", createDocument("Other"), assets);
    await controller.flush();
    expect(save).toHaveBeenCalledTimes(2);
    controller.schedule("first", createDocument("New"), assets);
    await controller.flush();
    expect(save.mock.calls.map((call) => call[1].name)).toEqual([
      "Old",
      "Other",
      "New",
    ]);
  } finally {
    controller.dispose();
  }
});

it("recognizes quota errors by name without misclassifying unrelated failures", () => {
  expect(storageErrorMessage({ name: "QuotaExceededError" })).toContain(
    "Download",
  );
  expect(storageErrorMessage(new Error("Decode failed"))).toBe("Decode failed");
  expect(storageErrorMessage("offline")).toBe("offline");
});
