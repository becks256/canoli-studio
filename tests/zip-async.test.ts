import { expect, it } from "vitest";
import { createZipArchive, createZipArchiveAsync } from "../src/ai/batch/zip";

it("cooperatively packages immutable blobs with identical archive bytes", async () => {
  const data = new Uint8Array(2 * 1024 * 1024 + 3).fill(37);
  const entries = [
    { name: "art/é.bin", data },
    { name: "empty", data: new Uint8Array() },
  ];
  let heartbeat = false;
  setTimeout(() => {
    heartbeat = true;
  }, 0);
  const progress: number[] = [];
  const archive = await createZipArchiveAsync(
    entries.map((e) => ({ name: e.name, data: new Blob([e.data]) })),
    {
      onProgress: (completed) => progress.push(completed),
    },
  );
  expect(heartbeat).toBe(true);
  expect(progress).toEqual([1, 2]);
  expect(await archive.arrayBuffer()).toEqual(
    await createZipArchive(entries).arrayBuffer(),
  );
});

it("cancels before work and during a large entry without publishing completion", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    createZipArchiveAsync([], { signal: controller.signal }),
  ).rejects.toMatchObject({ name: "AbortError" });
  const active = new AbortController();
  const progress: number[] = [];
  const blob = new Blob([new Uint8Array(8 * 1024 * 1024)]);
  const promise = createZipArchiveAsync([{ name: "large", data: blob }], {
    signal: active.signal,
    onProgress: (completed) => progress.push(completed),
  });
  setTimeout(() => active.abort(), 5);
  await expect(promise).rejects.toMatchObject({ name: "AbortError" });
  expect(progress).toEqual([]);
});
