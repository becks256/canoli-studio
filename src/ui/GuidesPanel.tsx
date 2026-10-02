import { useState } from "react";
import { Guide, type Document } from "../dom";
import { Button, NumberField, Select } from "./controls";
import { InspectorSection } from "./InspectorSection";

export function GuidesPanel({
  document,
  visible,
  onVisible,
  disabled,
  onAttempt,
}: {
  document: Document;
  visible: boolean;
  onVisible(value: boolean): void;
  disabled: boolean;
  onAttempt(action: () => void): void;
}) {
  const [orientation, setOrientation] = useState<"vertical" | "horizontal">(
    "vertical",
  );
  const [position, setPosition] = useState(0);
  const guides = document.guides.items;
  return (
    <InspectorSection
      title="Guides"
      defaultCollapsed
      className="guides-panel"
      badge={guides.length}
    >
      <div className="guide-controls">
        <label className="checkbox-field">
          <input
            type="checkbox"
            checked={visible}
            onChange={(event) => onVisible(event.target.checked)}
          />
          Show guides
        </label>
        <Select
          label="New guide orientation"
          value={orientation}
          disabled={disabled}
          options={[
            { value: "vertical", label: "Vertical" },
            { value: "horizontal", label: "Horizontal" },
          ]}
          onChange={(value) => setOrientation(value as typeof orientation)}
        />
        <NumberField
          label="New guide position"
          value={position}
          min={-Number.MAX_SAFE_INTEGER}
          max={Number.MAX_SAFE_INTEGER}
          suffix="px"
          disabled={disabled}
          onCommit={setPosition}
        />
        <Button
          disabled={disabled}
          onClick={() =>
            onAttempt(() =>
              document.guides.add(new Guide({ orientation, position })),
            )
          }
        >
          Add guide
        </Button>
        {guides.map((guide, index) => (
          <div className="guide-entry" key={guide.id}>
            <Select
              label={`Guide ${index + 1} orientation`}
              value={guide.orientation}
              disabled={disabled}
              options={[
                { value: "vertical", label: "Vertical" },
                { value: "horizontal", label: "Horizontal" },
              ]}
              onChange={(value) =>
                onAttempt(() =>
                  document.guides.update(guide.id, {
                    orientation: value as typeof orientation,
                  }),
                )
              }
            />
            <NumberField
              label={`Guide ${index + 1} position`}
              value={guide.position}
              suffix="px"
              disabled={disabled}
              min={-Number.MAX_SAFE_INTEGER}
              max={Number.MAX_SAFE_INTEGER}
              onCommit={(value) =>
                onAttempt(() =>
                  document.guides.update(guide.id, { position: value }),
                )
              }
            />
            <Button
              disabled={disabled}
              aria-label={`Delete guide ${index + 1}`}
              onClick={() => onAttempt(() => document.guides.remove(guide.id))}
            >
              Delete
            </Button>
          </div>
        ))}
        <Button
          disabled={disabled || !guides.length}
          onClick={() => onAttempt(() => document.guides.clear())}
        >
          Clear guides
        </Button>
      </div>
    </InspectorSection>
  );
}
