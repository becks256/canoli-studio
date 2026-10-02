import { useEffect, useState } from "react";
import { fontAvailability, type FontAvailability } from "./font-availability";
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import type { TextLayer } from "../dom";
import type { EditorCommand } from "../core/commands";
import {
  Button,
  ColorField,
  NumberField,
  SegmentedControl,
  Select,
  Slider,
  TextArea,
  TextInput,
} from "./controls";
import { InspectorSection } from "./InspectorSection";

export const FONT_FAMILIES = [
  "sans-serif",
  "serif",
  "monospace",
  "system-ui",
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Georgia",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
  "Impact",
];

export interface TypographyPanelProps {
  layer: TextLayer;
  disabled: boolean;
  onAction(action: () => void): void;
  onPreview(command: EditorCommand): void;
}

export function TypographyPanel({
  layer,
  disabled,
  onAction,
  onPreview,
}: TypographyPanelProps) {
  const family = layer.fontFamily;
  const [availability, setAvailability] = useState<FontAvailability>("unknown");
  useEffect(() => {
    let disposed = false,
      request = 0;
    const refresh = () => {
      const current = ++request;
      setAvailability("unknown");
      void fontAvailability(family).then((value) => {
        if (!disposed && current === request) setAvailability(value);
      });
    };
    refresh();
    document.fonts?.addEventListener("loadingdone", refresh);
    document.fonts?.addEventListener("loadingerror", refresh);
    return () => {
      disposed = true;
      document.fonts?.removeEventListener("loadingdone", refresh);
      document.fonts?.removeEventListener("loadingerror", refresh);
    };
  }, [family]);

  return (
    <InspectorSection title="Text" className="typography-panel">
      <TextArea
        label="Content"
        ariaLabel="Text content"
        value={layer.text}
        disabled={disabled}
        rows={3}
        onChange={(val) => {
          onAction(() => {
            layer.text = val;
          });
        }}
      />
      <Select
        label="Font"
        layout="stacked"
        value={layer.fontFamily}
        disabled={disabled}
        options={
          FONT_FAMILIES.includes(layer.fontFamily)
            ? FONT_FAMILIES
            : [layer.fontFamily, ...FONT_FAMILIES]
        }
        onChange={(val) => {
          onAction(() => {
            layer.fontFamily = val;
          });
        }}
      />
      <TextInput
        label="Font family"
        layout="stacked"
        value={layer.fontFamily}
        disabled={disabled}
        placeholder="Enter a local font family"
        onCommit={(value) =>
          onAction(() => {
            layer.fontFamily = value;
          })
        }
      />
      {availability === "unavailable" && (
        <div className="font-fallback-warning" role="alert">
          Font &ldquo;{layer.fontFamily}&rdquo; could not be loaded locally. A
          fallback may be in use.
        </div>
      )}
      <Button
        disabled={disabled}
        onClick={() => onAction(() => layer.reflow())}
      >
        Reflow text
      </Button>
      <NumberField
        label="Font size"
        layout="stacked"
        value={layer.fontSize}
        min={1}
        max={Number.MAX_SAFE_INTEGER}
        step={1}
        suffix="px"
        disabled={disabled}
        onPreview={(value) =>
          onPreview({
            type: "layer.update",
            id: layer.id,
            patch: { fontSize: value },
          })
        }
        onCommit={(value) =>
          onAction(() => {
            layer.fontSize = value;
          })
        }
      />
      <ColorField
        label="Color"
        ariaLabel="Text color"
        value={layer.color}
        disabled={disabled}
        onChange={(val) => {
          onAction(() => {
            layer.color = val;
          });
        }}
      />
      <SegmentedControl
        label="Alignment"
        value={layer.align}
        disabled={disabled}
        options={[
          {
            value: "left",
            label: "Align left",
            icon: <AlignLeft size={16} />,
          },
          {
            value: "center",
            label: "Align center",
            icon: <AlignCenter size={16} />,
          },
          {
            value: "right",
            label: "Align right",
            icon: <AlignRight size={16} />,
          },
        ]}
        onChange={(val) => {
          onAction(() => {
            layer.align = val;
          });
        }}
      />
      <Select
        label="Weight"
        layout="stacked"
        value={layer.fontWeight ?? "normal"}
        disabled={disabled}
        options={[
          { value: "normal", label: "Normal (400)" },
          { value: "bold", label: "Bold (700)" },
          { value: "100", label: "Thin (100)" },
          { value: "200", label: "Extra Light (200)" },
          { value: "300", label: "Light (300)" },
          { value: "500", label: "Medium (500)" },
          { value: "600", label: "Semi Bold (600)" },
          { value: "800", label: "Extra Bold (800)" },
          { value: "900", label: "Black (900)" },
        ]}
        onChange={(val) => {
          onAction(() => {
            layer.fontWeight = val;
          });
        }}
      />
      <SegmentedControl
        label="Style"
        value={layer.fontStyle ?? "normal"}
        disabled={disabled}
        options={[
          { value: "normal", label: "Normal" },
          { value: "italic", label: "Italic" },
        ]}
        onChange={(val) => {
          onAction(() => {
            layer.fontStyle = val as "normal" | "italic";
          });
        }}
      />
      <Slider
        label="Line height"
        value={layer.lineHeight}
        min={0.5}
        max={3}
        step={0.05}
        suffix="x"
        disabled={disabled}
        onPreview={(value) =>
          onPreview({
            type: "layer.update",
            id: layer.id,
            patch: { lineHeight: value },
          })
        }
        onCommit={(value) =>
          onAction(() => {
            layer.lineHeight = value;
          })
        }
      />
      <Slider
        label="Tracking"
        value={layer.letterSpacing ?? 0}
        min={-10}
        max={50}
        step={0.5}
        suffix="px"
        disabled={disabled}
        onPreview={(value) =>
          onPreview({
            type: "layer.update",
            id: layer.id,
            patch: { letterSpacing: value },
          })
        }
        onCommit={(value) =>
          onAction(() => {
            layer.letterSpacing = value;
          })
        }
      />
      <SegmentedControl
        label="Direction"
        value={layer.direction ?? "ltr"}
        disabled={disabled}
        options={[
          { value: "ltr", label: "LTR" },
          { value: "rtl", label: "RTL" },
        ]}
        onChange={(val) => {
          onAction(() => {
            layer.direction = val as "ltr" | "rtl";
          });
        }}
      />
    </InspectorSection>
  );
}

// Re-export alias for backwards compatibility
export const TextProperties = TypographyPanel;
