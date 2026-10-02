import { expect, it } from "vitest";
import { generationFingerprint } from "../src/ai/jobs/fingerprint";

it("binds idempotency to request semantics and actual image bytes independent of object key order", async () => {
  const request = {
    prompt: "same",
    modality: "masked-edit" as const,
    targetWidth: 1,
    targetHeight: 1,
    referenceImage: {
      width: 1,
      height: 1,
      mimeType: "image/png",
      data: new Uint8Array([255, 0, 0, 255]),
    },
  };
  const hash = await generationFingerprint(request);
  expect(hash).toMatch(/^[a-f0-9]{64}$/);
  expect(
    await generationFingerprint({ ...request, prompt: "different" }),
  ).not.toBe(hash);
  expect(
    await generationFingerprint({
      ...request,
      referenceImage: {
        ...request.referenceImage,
        data: new Uint8Array([0, 0, 0, 255]),
      },
    }),
  ).not.toBe(hash);
  expect(
    await generationFingerprint({
      referenceImage: request.referenceImage,
      targetHeight: 1,
      targetWidth: 1,
      modality: "masked-edit",
      prompt: "same",
    }),
  ).toBe(hash);
});
