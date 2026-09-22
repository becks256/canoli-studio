import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import type { TextLayer } from "../dom";
import type { EditorCommand } from "../core/commands";
import {
  ColorField,
  NumberField,
  SegmentedControl,
  Select,
  Slider,
  TextArea,
} from "./controls";

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
  return (
    <section className="typography-panel">
      <h2>Text</h2>
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
        options={FONT_FAMILIES}
        onChange={(val) => {
          onAction(() => {
            layer.fontFamily = val;
          });
        }}
      />
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
    </section>
  );
}

// Re-export alias for backwards compatibility
export const TextProperties = TypographyPanel;
