import { expect, it, vi } from "vitest";
import {
  readStorageHealth,
  requestStoragePersistence,
} from "../src/core/storage-health";

it("reads origin estimates and persistence without requesting a grant", async () => {
  const persist = vi.fn(async () => true);
  const manager = {
    estimate: async () => ({ usage: 32, quota: 128 }),
    persisted: async () => false,
    persist,
  };
  expect(await readStorageHealth(manager)).toEqual({
    usage: 32,
    quota: 128,
    persisted: false,
    canRequestPersistence: true,
    errors: [],
  });
  expect(persist).not.toHaveBeenCalled();
  expect(await requestStoragePersistence(manager)).toBe(true);
  expect(persist).toHaveBeenCalledOnce();
});

it("keeps independent diagnostics when one browser API fails or is absent", async () => {
  const failedEstimate = await readStorageHealth({
    estimate: () => {
      throw new Error("Denied");
    },
    persisted: async () => true,
  });
  expect(failedEstimate.persisted).toBe(true);
  expect(failedEstimate.errors).toHaveLength(1);
  const failedStatus = await readStorageHealth({
    estimate: async () => ({ usage: 32, quota: 128 }),
    persisted: async () => {
      throw new Error("Denied");
    },
  });
  expect(failedStatus.usage).toBe(32);
  expect(failedStatus.persisted).toBeUndefined();
  expect(failedStatus.errors).toHaveLength(1);
  expect(await readStorageHealth({})).toEqual({
    canRequestPersistence: false,
    errors: [],
  });
});

it("does not present malformed estimates as storage capacity or treat denial as approval", async () => {
  for (const value of [-1, NaN, Infinity]) {
    const result = await readStorageHealth({
      estimate: async () => ({ usage: value, quota: value }),
    });
    expect(result.usage).toBeUndefined();
    expect(result.quota).toBeUndefined();
  }
  expect(
    (
      await readStorageHealth({
        estimate: async () => ({ usage: 0, quota: 0 }),
      })
    ).quota,
  ).toBeUndefined();
  expect(await requestStoragePersistence({ persist: async () => false })).toBe(
    false,
  );
  await expect(requestStoragePersistence({})).rejects.toThrow("unavailable");
  await expect(
    requestStoragePersistence({
      persist: async () => {
        throw new Error("Blocked");
      },
    }),
  ).rejects.toThrow("Blocked");
});
