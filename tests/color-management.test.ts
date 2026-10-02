import { describe, expect, it } from "vitest";
import {
  convertColor,
  deltaE2000,
  deltaE76,
  evaluateGamut,
  generateGamutWarningMask,
  isInsideGamut,
} from "../src/core/color/engine";
import {
  adobeRgbToLinear,
  cmykToRgb,
  labToXyzD50,
  linearToAdobeRgb,
  linearToSrgb,
  rgbToCmyk,
  srgbToLinear,
  xyzD50ToD65,
  xyzD50ToLab,
  xyzD65ToD50,
} from "../src/core/color/spaces";
import {
  buildStandardIccProfile,
  parseIccProfile,
  STANDARD_PROFILES,
} from "../src/core/color/icc";
import type { Vector3 } from "../src/core/color/types";

// Polyfill ImageData for test environment if missing
if (typeof globalThis.ImageData === "undefined") {
  globalThis.ImageData = class ImageData {
    readonly width: number;
    readonly height: number;
    readonly data: Uint8ClampedArray;
    constructor(arg1: number | Uint8ClampedArray, arg2: number, arg3?: number) {
      if (typeof arg1 === "number") {
        this.width = arg1;
        this.height = arg2;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      } else {
        this.data = arg1;
        this.width = arg2;
        this.height = arg3 ?? arg1.length / (arg2 * 4);
      }
    }
  } as unknown as typeof ImageData;
}

describe("Color Management and Precision Kernel (F10)", () => {
  describe("Mathematical spaces and transfer functions", () => {
    it("round-trips sRGB transfer function across full [0, 1] range", () => {
      const testValues = [0.0, 0.001, 0.039, 0.04045, 0.1, 0.5, 0.73, 1.0];
      for (const val of testValues) {
        const linear = srgbToLinear(val);
        const restored = linearToSrgb(linear);
        expect(restored).toBeCloseTo(val, 5);
      }
    });

    it("round-trips Adobe RGB gamma 2.2 transfer function", () => {
      const testValues = [0.0, 0.05, 0.25, 0.5, 0.8, 1.0];
      for (const val of testValues) {
        const linear = adobeRgbToLinear(val);
        const restored = linearToAdobeRgb(linear);
        expect(restored).toBeCloseTo(val, 5);
      }
    });

    it("round-trips Bradford chromatic adaptation D65 <-> D50", () => {
      const d65White: Vector3 = [0.95047, 1.0, 1.08883];
      const d50 = xyzD65ToD50(d65White);
      expect(d50[0]).toBeCloseTo(0.96422, 3);
      expect(d50[1]).toBeCloseTo(1.0, 3);
      expect(d50[2]).toBeCloseTo(0.82521, 3);

      const restoredD65 = xyzD50ToD65(d50);
      expect(restoredD65[0]).toBeCloseTo(d65White[0], 5);
      expect(restoredD65[1]).toBeCloseTo(d65White[1], 5);
      expect(restoredD65[2]).toBeCloseTo(d65White[2], 5);
    });

    it("converts D50 XYZ white point to Lab [100, 0, 0]", () => {
      const d50White: Vector3 = [0.96422, 1.0, 0.82521];
      const lab = xyzD50ToLab(d50White);
      expect(lab[0]).toBeCloseTo(100.0, 3);
      expect(lab[1]).toBeCloseTo(0.0, 3);
      expect(lab[2]).toBeCloseTo(0.0, 3);

      const restoredXyz = labToXyzD50(lab);
      expect(restoredXyz[0]).toBeCloseTo(d50White[0], 4);
      expect(restoredXyz[1]).toBeCloseTo(d50White[1], 4);
      expect(restoredXyz[2]).toBeCloseTo(d50White[2], 4);
    });

    it("converts RGB to CMYK and back with neutral tones", () => {
      const black = rgbToCmyk([0, 0, 0]);
      expect(black[3]).toBe(1);

      const white = rgbToCmyk([1, 1, 1]);
      expect(white[0]).toBe(0);
      expect(white[1]).toBe(0);
      expect(white[2]).toBe(0);
      expect(white[3]).toBe(0);

      const gray: Vector3 = [0.5, 0.5, 0.5];
      const cmyk = rgbToCmyk(gray);
      const restored = cmykToRgb(cmyk);
      expect(restored[0]).toBeCloseTo(0.5, 4);
      expect(restored[1]).toBeCloseTo(0.5, 4);
      expect(restored[2]).toBeCloseTo(0.5, 4);
    });
  });

  describe("Color conversion engine", () => {
    it("converts sRGB white [1, 1, 1] to CIELAB [100, 0, 0]", () => {
      const lab = convertColor([1, 1, 1], "srgb", "cielab");
      expect(lab[0]).toBeCloseTo(100.0, 1);
      expect(lab[1]).toBeCloseTo(0.0, 1);
      expect(lab[2]).toBeCloseTo(0.0, 1);
    });

    it("converts sRGB black [0, 0, 0] to CIELAB [0, 0, 0]", () => {
      const lab = convertColor([0, 0, 0], "srgb", "cielab");
      expect(lab[0]).toBeCloseTo(0.0, 3);
      expect(lab[1]).toBeCloseTo(0.0, 3);
      expect(lab[2]).toBeCloseTo(0.0, 3);
    });

    it("round-trips colors between sRGB and Display P3 within sRGB gamut", () => {
      const testColors: Vector3[] = [
        [0.2, 0.4, 0.6],
        [0.8, 0.3, 0.1],
        [0.5, 0.5, 0.5],
      ];
      for (const col of testColors) {
        const p3 = convertColor(col, "srgb", "display-p3");
        const restored = convertColor(p3, "display-p3", "srgb");
        expect(restored[0]).toBeCloseTo(col[0], 3);
        expect(restored[1]).toBeCloseTo(col[1], 3);
        expect(restored[2]).toBeCloseTo(col[2], 3);
      }
    });

    it("detects wide-gamut Display P3 colors that exceed sRGB gamut", () => {
      // Pure Display P3 green [0, 1, 0] is outside sRGB gamut
      const p3Green: Vector3 = [0, 1, 0];
      const unclippedSrgb = convertColor(
        p3Green,
        "display-p3",
        "srgb",
        "absolute-colorimetric",
      );

      // sRGB representation should have negative red or green > 1
      expect(isInsideGamut(unclippedSrgb)).toBe(false);

      const evalRes = evaluateGamut(p3Green, "display-p3", "srgb");
      expect(evalRes.inGamut).toBe(false);
      expect(evalRes.maxExcursion).toBeGreaterThan(0.1);
      expect(evalRes.deltaE76).toBeGreaterThan(5.0);
      expect(evalRes.deltaE2000).toBeGreaterThan(3.0);
    });
  });

  describe("Color difference metrics (Delta E)", () => {
    it("yields 0 for identical colors in Delta E 76 and Delta E 2000", () => {
      const col: Vector3 = [50, 12, -24];
      expect(deltaE76(col, col)).toBe(0);
      expect(deltaE2000(col, col)).toBe(0);
    });

    it("computes accurate Delta E 2000 for standard reference pairs", () => {
      // Standard CIE test pair
      const lab1: Vector3 = [50.0, 2.6772, -79.7751];
      const lab2: Vector3 = [50.0, 0.0, -82.7485];
      const dE2000 = deltaE2000(lab1, lab2);
      expect(dE2000).toBeCloseTo(2.0425, 2);
    });
  });

  describe("Gamut warning mask for soft-proofing", () => {
    it("creates an out-of-gamut mask highlighting pixels that exceed target space", () => {
      const img = new ImageData(2, 2);
      const data = img.data;

      // Pixel (0, 0): sRGB neutral (inside P3 and sRGB) -> [128, 128, 128, 255]
      data[0] = 128;
      data[1] = 128;
      data[2] = 128;
      data[3] = 255;

      // Pixel (1, 0): Display P3 saturated wide green in P3 space -> [0, 255, 0, 255]
      data[4] = 0;
      data[5] = 255;
      data[6] = 0;
      data[7] = 255;

      const warningMask = generateGamutWarningMask(
        img,
        "display-p3",
        "srgb",
        [255, 0, 255, 255],
      );

      // Pixel (0, 0) should be in-gamut (alpha 0)
      expect(warningMask.data[3]).toBe(0);

      // Pixel (1, 0) should be out-of-gamut (highlighted with warning color [255, 0, 255, 255])
      expect(warningMask.data[4]).toBe(255);
      expect(warningMask.data[5]).toBe(0);
      expect(warningMask.data[6]).toBe(255);
      expect(warningMask.data[7]).toBe(255);
    });
  });

  describe("Binary ICC Profile parser and generator", () => {
    it("generates and parses standard sRGB ICC profile", () => {
      const iccBytes = buildStandardIccProfile("srgb", "sRGB IEC61966-2.1");
      expect(iccBytes.length).toBeGreaterThan(128);

      const parsed = parseIccProfile(iccBytes);
      expect(parsed.header.signature).toBe("acsp");
      expect(parsed.header.version).toBe("2.4");
      expect(parsed.header.colorSpace).toBe("RGB ");
      expect(parsed.header.connectionSpace).toBe("XYZ ");
      expect(parsed.description).toBe("sRGB IEC61966-2.1");
      expect(parsed.tags["desc"]).toBeDefined();
      expect(parsed.tags["wtpt"]).toBeDefined();
      expect(parsed.tags["rXYZ"]).toBeDefined();
      expect(parsed.tags["gXYZ"]).toBeDefined();
      expect(parsed.tags["bXYZ"]).toBeDefined();
    });

    it("verifies pre-baked standard profiles in STANDARD_PROFILES", () => {
      for (const key of ["srgb", "display-p3", "adobe-rgb"] as const) {
        const descriptor = STANDARD_PROFILES[key];
        expect(descriptor.id).toBe(key);
        expect(descriptor.iccBytes).toBeDefined();

        const parsed = parseIccProfile(descriptor.iccBytes!);
        expect(parsed.header.colorSpace).toBe("RGB ");
        expect(parsed.description).toBe(descriptor.name);
      }
    });

    it("rejects invalid or truncated ICC profile buffers", () => {
      expect(() => parseIccProfile(new Uint8Array(50))).toThrow(
        /Invalid ICC profile/,
      );

      const fakeHeader = new Uint8Array(140);
      fakeHeader[36] = 65; // 'A' instead of 'acsp'
      expect(() => parseIccProfile(fakeHeader)).toThrow(/missing 'acsp'/);
    });
  });
});
