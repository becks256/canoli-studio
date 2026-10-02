import { defaultStyle } from "../../core/drawing";
import type { Recipe } from "./types";
import { RECIPE_SCHEMA_VERSION } from "./types";

export const PRESET_VIGNETTE_WARM: Recipe = {
  schemaVersion: RECIPE_SCHEMA_VERSION,
  id: "preset-vignette-warm",
  name: "Warm Tone & Contrast",
  description:
    "Adjusts tone on the selected raster and adds an editable warm RGB curve above the root composition. No vignette is added.",
  version: 2,
  parameters: [
    {
      name: "exposure",
      label: "Exposure Offset",
      type: "number",
      default: 0.2,
      min: -2,
      max: 2,
      step: 0.05,
      description: "Fine exposure adjustment on the base image.",
    },
    {
      name: "contrast",
      label: "Contrast Boost",
      type: "number",
      default: 30,
      min: -100,
      max: 100,
      step: 1,
      description: "Increases highlight/shadow separation.",
    },
    {
      name: "saturation",
      label: "Saturation",
      type: "number",
      default: 25,
      min: -100,
      max: 100,
      step: 1,
      description: "Vibrancy enhancement for warm colors.",
    },
  ],
  steps: [
    {
      id: "step-warm-tone",
      name: "Adjust Image Tone",
      target: { role: "selected" },
      action: {
        type: "effect.tone",
        values: {
          exposure: "${exposure}",
          contrast: "${contrast}",
          saturation: "${saturation}",
        },
      },
    },
    {
      id: "step-adjustment-layer",
      name: "Add Warm Color Curve",
      action: {
        type: "layer.add",
        layerTemplate: {
          kind: "adjustment",
          name: "Warm Tone Curve",
          opacity: 0.75,
          blendMode: "normal",
          adjustment: {
            kind: "curves",
            rgb: [
              { x: 0, y: 0 },
              { x: 255, y: 255 },
            ],
            red: [
              { x: 0, y: 0 },
              { x: 128, y: 148 },
              { x: 255, y: 255 },
            ],
            blue: [
              { x: 0, y: 0 },
              { x: 128, y: 108 },
              { x: 255, y: 255 },
            ],
          },
        },
      },
      outputVar: "warmAdjustment",
    },
  ],
  tags: ["color", "retouch", "warmth", "preset"],
  author: "Luma Studio",
};

export const PRESET_PRODUCT_DROP_SHADOW: Recipe = {
  schemaVersion: RECIPE_SCHEMA_VERSION,
  id: "preset-product-drop-shadow",
  name: "Create Product Drop Shadow",
  description:
    "Creates an editable black silhouette behind the selected subject with configurable opacity and offset. Edges follow source transparency; no blur is added.",
  version: 2,
  parameters: [
    {
      name: "shadowOpacity",
      label: "Shadow Opacity",
      type: "number",
      default: 0.35,
      min: 0.05,
      max: 1.0,
      step: 0.05,
      description: "Transparency of the cast shadow.",
    },
    {
      name: "offsetX",
      label: "Horizontal Offset (px)",
      type: "number",
      default: 20,
      min: -150,
      max: 150,
      step: 1,
      description: "Horizontal displacement in pixels.",
    },
    {
      name: "offsetY",
      label: "Vertical Offset (px)",
      type: "number",
      default: 30,
      min: -150,
      max: 150,
      step: 1,
      description: "Vertical displacement in pixels.",
    },
  ],
  steps: [
    {
      id: "step-dup-shadow",
      name: "Duplicate Subject for Shadow",
      target: { role: "selected" },
      action: {
        type: "layer.duplicate",
        newName: "Drop Shadow",
        inPlace: true,
      },
      outputVar: "shadowLayer",
    },
    {
      id: "step-reorder-shadow",
      name: "Place Shadow Behind Subject",
      target: { by: "stepResult", stepId: "shadowLayer" },
      action: {
        type: "layer.reorder",
        direction: "down",
      },
    },
    {
      id: "step-configure-shadow",
      name: "Apply Shadow Opacity and Offset",
      target: { by: "stepResult", stepId: "shadowLayer" },
      action: {
        type: "layer.update",
        patch: {
          opacity: "${shadowOpacity}",
          blendMode: "multiply",
          fillOpacity: 1,
          styles: {
            ...defaultStyle(),
            colorOverlay: { enabled: true, color: "#000000", opacity: 1 },
          },
        },
      },
    },
    {
      id: "step-offset-shadow",
      name: "Offset Shadow from Subject",
      target: { by: "stepResult", stepId: "shadowLayer" },
      action: { type: "layer.translate", dx: "${offsetX}", dy: "${offsetY}" },
    },
  ],
  tags: ["composition", "mockup", "depth", "preset"],
  author: "Luma Studio",
};

export const PRESET_HIGH_CONTRAST_BW: Recipe = {
  schemaVersion: RECIPE_SCHEMA_VERSION,
  id: "preset-high-contrast-bw",
  name: "High Contrast Monochrome",
  description:
    "Converts the target image to black and white with adjustable contrast and exposure.",
  version: 2,
  parameters: [
    {
      name: "contrast",
      label: "Monochrome Contrast",
      type: "number",
      default: 45,
      min: 0,
      max: 100,
      step: 1,
      description: "Deepens black points and brightens highlights.",
    },
    {
      name: "exposure",
      label: "Highlight Compensation",
      type: "number",
      default: 0.1,
      min: -1,
      max: 1,
      step: 0.05,
      description:
        "Exposure offset in EV; positive values brighten and can clip highlights.",
    },
  ],
  steps: [
    {
      id: "step-bw-tone",
      name: "Desaturate and Contrast Tune",
      target: { role: "selected" },
      action: {
        type: "effect.tone",
        values: {
          saturation: -100,
          contrast: "${contrast}",
          exposure: "${exposure}",
        },
      },
    },
  ],
  tags: ["monochrome", "contrast", "preset"],
  author: "Luma Studio",
};

export const PRESET_WATERMARK_STAMP: Recipe = {
  schemaVersion: RECIPE_SCHEMA_VERSION,
  id: "preset-watermark-stamp",
  name: "Watermark Stamp",
  description:
    "Inserts a crisp text watermark layer with configurable branding copy and opacity.",
  version: 1,
  parameters: [
    {
      name: "watermarkText",
      label: "Watermark Copy",
      type: "string",
      default: "© LUMA STUDIO",
      required: true,
      description: "Text line to render as the watermark.",
    },
    {
      name: "fontSize",
      label: "Font Size (pt)",
      type: "number",
      default: 28,
      min: 12,
      max: 96,
      step: 2,
    },
    {
      name: "opacity",
      label: "Watermark Opacity",
      type: "number",
      default: 0.65,
      min: 0.1,
      max: 1.0,
      step: 0.05,
    },
  ],
  steps: [
    {
      id: "step-add-watermark",
      name: "Insert Text Watermark Layer",
      action: {
        type: "layer.add",
        layerTemplate: {
          kind: "text",
          name: "Watermark",
          text: "${watermarkText}",
          fontSize: "${fontSize}",
          color: "#ffffff",
          opacity: "${opacity}",
          x: 48,
          y: 48,
        },
      },
      outputVar: "watermarkLayer",
    },
  ],
  tags: ["branding", "export", "text", "preset"],
  author: "Luma Studio",
};

export const PRESET_HSL_RECOLOR: Recipe = {
  schemaVersion: RECIPE_SCHEMA_VERSION,
  id: "preset-hsl-recolor",
  name: "Recolor with HSL",
  description:
    "Adds an editable HSL adjustment above the root composition. Source pixels remain unchanged.",
  version: 1,
  author: "Luma Studio",
  tags: ["color", "hue", "saturation", "batch"],
  parameters: [
    {
      name: "hue",
      label: "Hue",
      type: "number",
      default: 0,
      min: -180,
      max: 180,
      step: 1,
    },
    {
      name: "saturation",
      label: "Saturation",
      type: "number",
      default: 0,
      min: -100,
      max: 100,
      step: 1,
    },
    {
      name: "lightness",
      label: "Lightness",
      type: "number",
      default: 0,
      min: -100,
      max: 100,
      step: 1,
    },
  ],
  steps: [
    {
      id: "hsl",
      name: "Add HSL adjustment",
      outputVar: "hslLayer",
      action: {
        type: "layer.add",
        layerTemplate: {
          kind: "adjustment",
          name: "HSL recolor",
          adjustment: {
            kind: "hsl",
            hue: "${hue}",
            saturation: "${saturation}",
            lightness: "${lightness}",
          },
        },
      },
    },
  ],
};

export const BUILTIN_PRESETS: Recipe[] = [
  PRESET_HSL_RECOLOR,
  PRESET_VIGNETTE_WARM,
  PRESET_PRODUCT_DROP_SHADOW,
  PRESET_HIGH_CONTRAST_BW,
  PRESET_WATERMARK_STAMP,
];
