import { expect, test } from "@playwright/test";
test("browser packages the ZIP64 entry-count boundary and snapshots payload bytes", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createZipArchive } = await import(
      /* @vite-ignore */ String("/src/ai/batch/zip.ts")
    );
    const payload = new Uint8Array([0, 1, 2, 255]);
    const entries = Array.from({ length: 65535 }, (_, i) => ({
      name: i === 0 ? "é.bin" : `${i}.txt`,
      data: i === 0 ? payload : new Uint8Array(),
    }));
    const archive = createZipArchive(entries);
    payload.fill(9);
    const tail = new DataView(await archive.slice(-98).arrayBuffer());
    const local = new DataView(await archive.slice(0, 30).arrayBuffer());
    const nameLength = local.getUint16(26, true);
    return {
      type: archive.type,
      record: tail.getUint32(0, true),
      count: Number(tail.getBigUint64(32, true)),
      locator: tail.getUint32(56, true),
      classic: tail.getUint32(76, true),
      sentinel: tail.getUint16(86, true),
      payload: [
        ...new Uint8Array(
          await archive.slice(30 + nameLength, 34 + nameLength).arrayBuffer(),
        ),
      ],
    };
  });
  expect(result).toEqual({
    type: "application/zip",
    record: 0x06064b50,
    count: 65535,
    locator: 0x07064b50,
    classic: 0x06054b50,
    sentinel: 65535,
    payload: [0, 1, 2, 255],
  });
});

test("large browser ZIP work yields to cancellation and can be retried", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const { createZipArchiveAsync } = await import(
      /* @vite-ignore */ String("/src/ai/batch/zip.ts")
    );
    const controller = new AbortController();
    const entries = [
      { name: "large.bin", data: new Blob([new Uint8Array(16 * 1024 * 1024)]) },
    ];
    let completed = 0,
      heartbeat = false;
    const pending = createZipArchiveAsync(entries, {
      signal: controller.signal,
      onProgress: () => completed++,
    });
    setTimeout(() => {
      heartbeat = true;
      controller.abort();
    }, 10);
    let error = "";
    try {
      await pending;
    } catch (failure) {
      error = (failure as Error).name;
    }
    const retry = await createZipArchiveAsync([
      { name: "small.bin", data: new Blob([new Uint8Array([1, 2, 3])]) },
    ]);
    const bytes = new Uint8Array(await retry.arrayBuffer());
    const view = new DataView(bytes.buffer);
    const start = 30 + view.getUint16(26, true) + view.getUint16(28, true);
    return {
      heartbeat,
      error,
      completed,
      payload: [...bytes.slice(start, start + 3)],
    };
  });
  expect(result).toEqual({
    heartbeat: true,
    error: "AbortError",
    completed: 0,
    payload: [1, 2, 3],
  });
});
