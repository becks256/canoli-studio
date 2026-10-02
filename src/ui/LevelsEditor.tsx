import { useState, useCallback } from "react";
import type {
  LevelChannelData,
  LevelsAdjustmentData,
} from "../core/adjustments";
import { defaultLevelChannel } from "../core/adjustments";
import type { HistogramData } from "../core/histogram";
import { HistogramView } from "./HistogramView";
import { Slider, IconButton } from "./controls";
import { RotateCcw } from "lucide-react";

export interface LevelsEditorProps {
  value: LevelsAdjustmentData;
  histogram?: HistogramData | null;
  disabled?: boolean;
  onPreview?(value: LevelsAdjustmentData): void;
  onCommit(value: LevelsAdjustmentData): void;
}

type LevelChannel = "rgb" | "red" | "green" | "blue";

export function LevelsEditor({
  value,
  histogram,
  disabled = false,
  onPreview,
  onCommit,
}: LevelsEditorProps) {
  const [activeChannel, setActiveChannel] = useState<LevelChannel>("rgb");

  const getChannelData = useCallback(
    (ch: LevelChannel): LevelChannelData => {
      switch (ch) {
        case "rgb":
          return value.rgb;
        case "red":
          return value.red ?? defaultLevelChannel();
        case "green":
          return value.green ?? defaultLevelChannel();
        case "blue":
          return value.blue ?? defaultLevelChannel();
      }
    },
    [value],
  );

  const currentChannelData = getChannelData(activeChannel);

  const updateChannel = useCallback(
    (ch: LevelChannel, patch: Partial<LevelChannelData>, commit: boolean) => {
      const prev = getChannelData(ch);
      const updatedChannel: LevelChannelData = {
        ...prev,
        ...patch,
      };
      // Ensure inputWhite > inputBlack
      if (updatedChannel.inputWhite <= updatedChannel.inputBlack) {
        if (patch.inputBlack !== undefined) {
          updatedChannel.inputWhite = Math.min(
            255,
            updatedChannel.inputBlack + 1,
          );
        } else if (patch.inputWhite !== undefined) {
          updatedChannel.inputBlack = Math.max(
            0,
            updatedChannel.inputWhite - 1,
          );
        }
      }

      const updated: LevelsAdjustmentData = {
        ...value,
        [ch]: updatedChannel,
      };

      if (commit) {
        onCommit(updated);
      } else {
        onPreview?.(updated);
      }
    },
    [value, getChannelData, onCommit, onPreview],
  );

  const handleResetChannel = () => {
    if (disabled) return;
    const updated: LevelsAdjustmentData = {
      ...value,
      [activeChannel]: defaultLevelChannel(),
    };
    onCommit(updated);
  };

  const isDefault =
    currentChannelData.inputBlack === 0 &&
    currentChannelData.inputWhite === 255 &&
    currentChannelData.gamma === 1.0 &&
    currentChannelData.outputBlack === 0 &&
    currentChannelData.outputWhite === 255;

  return (
    <div className="levels-editor">
      <div className="levels-header">
        <div
          className="levels-channel-selector"
          role="group"
          aria-label="Levels channel"
        >
          {(
            [
              ["rgb", "RGB"],
              ["red", "Red"],
              ["green", "Green"],
              ["blue", "Blue"],
            ] as const
          ).map(([ch, label]) => (
            <button
              key={ch}
              type="button"
              className={`levels-tab ${activeChannel === ch ? "active" : ""}`}
              aria-pressed={activeChannel === ch}
              disabled={disabled}
              onClick={() => setActiveChannel(ch)}
            >
              {label}
            </button>
          ))}
        </div>
        <IconButton
          label={`Reset ${activeChannel} levels`}
          disabled={disabled || isDefault}
          onClick={handleResetChannel}
        >
          <RotateCcw size={13} />
        </IconButton>
      </div>

      {histogram && (
        <div className="levels-histogram-box">
          <HistogramView
            histogram={histogram}
            channel={activeChannel === "rgb" ? "luminance" : activeChannel}
            compact
            height={70}
          />
        </div>
      )}

      <div className="levels-section-heading">Input Levels</div>
      <Slider
        label="Black point"
        value={currentChannelData.inputBlack}
        min={0}
        max={Math.max(0, currentChannelData.inputWhite - 1)}
        step={1}
        disabled={disabled}
        onPreview={(val) =>
          updateChannel(activeChannel, { inputBlack: val }, false)
        }
        onCommit={(val) =>
          updateChannel(activeChannel, { inputBlack: val }, true)
        }
      />
      <Slider
        label="Midtones (gamma)"
        value={currentChannelData.gamma}
        min={0.1}
        max={5.0}
        step={0.01}
        disabled={disabled}
        onPreview={(val) => updateChannel(activeChannel, { gamma: val }, false)}
        onCommit={(val) => updateChannel(activeChannel, { gamma: val }, true)}
      />
      <Slider
        label="White point"
        value={currentChannelData.inputWhite}
        min={Math.min(255, currentChannelData.inputBlack + 1)}
        max={255}
        step={1}
        disabled={disabled}
        onPreview={(val) =>
          updateChannel(activeChannel, { inputWhite: val }, false)
        }
        onCommit={(val) =>
          updateChannel(activeChannel, { inputWhite: val }, true)
        }
      />

      <div className="levels-section-heading">Output Levels</div>
      <Slider
        label="Output black"
        value={currentChannelData.outputBlack}
        min={0}
        max={255}
        step={1}
        disabled={disabled}
        onPreview={(val) =>
          updateChannel(activeChannel, { outputBlack: val }, false)
        }
        onCommit={(val) =>
          updateChannel(activeChannel, { outputBlack: val }, true)
        }
      />
      <Slider
        label="Output white"
        value={currentChannelData.outputWhite}
        min={0}
        max={255}
        step={1}
        disabled={disabled}
        onPreview={(val) =>
          updateChannel(activeChannel, { outputWhite: val }, false)
        }
        onCommit={(val) =>
          updateChannel(activeChannel, { outputWhite: val }, true)
        }
      />
    </div>
  );
}
