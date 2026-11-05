import { expect, test } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

for (const fault of ["abort", "release", "font"] as const)
  test("repeated native rejection " + fault + " prevents publication and permits an original-source retry", async ({ page }, info) => {
    const sources = await Promise.all(
      ["native-fallback/Latin-no-mark.ttf", "shaping-font/Shaping.ttf"].map(async name => [...await readFile("tests/fixtures/" + name)]),
    );
    await page.goto("/");
    const result = await page.evaluate(async ({ sources, fault }) => {
      const { AssetStore } = await import(/* @vite-ignore */ String("/src/core/assets.ts")) as typeof import("../src/core/assets");
      const { Document } = await import(/* @vite-ignore */ String("/src/dom/index.ts")) as typeof import("../src/dom");
      const { captureStyledTextPlan } = await import(/* @vite-ignore */ String("/src/engine/styled-text.ts")) as typeof import("../src/engine/styled-text");
      const { NativeSvgRejectedPaints } = await import(/* @vite-ignore */ String("/src/engine/native-svg-rejected-paint.ts")) as typeof import("../src/engine/native-svg-rejected-paint");
      const assets = new AssetStore(), doc = new Document({ assets }), fonts = [];
      for (const source of sources) fonts.push(await doc.fonts.embed(new Blob([new Uint8Array(source)])));
      const before = JSON.stringify(doc.toJSON()), fontFamily = fonts.map(f => f.family).join(", "),
        abort = new AbortController(), has = NativeSvgRejectedPaints.prototype.has,
        create = URL.createObjectURL, revoke = URL.revokeObjectURL, urls = new Set<string>();
      URL.createObjectURL = function (blob) { const url = create.call(this, blob); urls.add(url); return url; };
      URL.revokeObjectURL = function (url) { urls.delete(url); return revoke.call(this, url); };
      let hits = 0, error = "", published = false, retiredFont = false;
      try {
        const first = "color(srgb-linear 4 -.25 1.5 / .5)", second = "color(srgb-linear .125 3 -.5 / .64123012345)",
          plan = await captureStyledTextPlan({ width: 512, height: 512, style: { fontFamily, fontSize: 40, letterSpacing: 0 }, lines: [{ x: 220, y: 160, direction: "ltr", align: "center", writing: { mode: "vertical-rl", orientation: "sideways" }, spans: [{ text: "AV a", style: { color: first } }, { text: "\u0301 ", style: { color: second } }, { text: "fi", style: { color: second } }] }] }, doc.toJSON(), assets, { captureLinearPaint: true });
        NativeSvgRejectedPaints.prototype.has = function (key) {
          const rejected = has.call(this, key);
          if (rejected && ++hits === 1) {
            if (fault === "abort") abort.abort(new Error("Expected repeated-paint abort"));
            else if (fault === "release") plan.release();
            else {
              const face = [...document.fonts].find(face => /CanoliGlyph_/.test(face.family));
              if (!face) throw new Error("Expected captured native glyph face");
              retiredFont = document.fonts.delete(face);
            }
          }
          return rejected;
        };
        try {
          plan.retireMeasurement();
          try { await plan.matchStyledGlyphLine(0, { signal: abort.signal }); published = true; }
          catch (reason) { error = String(reason); }
        } finally {
          NativeSvgRejectedPaints.prototype.has = has;
          plan.release();
        }
        const afterFailure = urls.size, probesAfterFailure = document.querySelectorAll("[data-canoli-styled-text-probe],[data-canoli-svg-glyph-probe]").length,
          retry = await captureStyledTextPlan({ width: 512, height: 256, style: { fontFamily, fontSize: 40 }, lines: [{ x: 40, y: 120, spans: [{ text: "AV fi a\u0301" }] }] }, doc.toJSON(), assets, { captureLinearPaint: true });
        let healthy;
        try { retry.retireMeasurement(); const match = await retry.matchStyledGlyphLine(0); healthy = { status: match.status, evidence: match.evidence }; }
        finally { retry.release(); }
        return { fault, hits, error, published, retiredFont, afterFailure, probesAfterFailure, healthy, afterRetry: urls.size, unchanged: JSON.stringify(doc.toJSON()) === before, probes: document.querySelectorAll("[data-canoli-styled-text-probe],[data-canoli-svg-glyph-probe]").length, privateFaces: [...document.fonts].filter(face => /Canoli(Glyph|Variation|Size)_/.test(face.family)).length };
      } finally {
        NativeSvgRejectedPaints.prototype.has = has;
        assets.dispose();
        URL.createObjectURL = create;
        URL.revokeObjectURL = revoke;
      }
    }, { sources, fault });
    await writeFile(info.outputPath("rejected-paint-guards.json"), JSON.stringify(result, null, 2));
    expect(result.hits).toBeGreaterThan(0);
    expect(result.error).not.toBe("");
    expect(result.published).toBe(false);
    if (fault === "font") expect(result.retiredFont).toBe(true);
    expect(result.afterFailure).toBe(0);
    expect(result.probesAfterFailure).toBe(0);
    expect(result.healthy.status).toBe("matched");
    expect(result.healthy.evidence?.svgMaxAlphaError).toBe(0);
    expect(result.unchanged).toBe(true);
    expect(result.afterRetry).toBe(0);
    expect(result.probes).toBe(0);
    expect(result.privateFaces).toBe(0);
  });
