import { useState } from "react";
import { X } from "lucide-react";
import { Dialog } from "./Dialog";
import { Button, IconButton } from "./controls";
import { formatShortcut } from "./shortcuts";
import { bindingFromEvent } from "./shortcut-bindings";
import type { ShortcutRegistry } from "./shortcuts";

export interface ShortcutDialogProps {
  shortcuts: ShortcutRegistry;
  error?: string;
  onBinding(id: string, keys: string[] | null): void;
  onResetAll(): void;
  onClose(): void;
}
export function ShortcutDialog({
  shortcuts,
  error,
  onBinding,
  onResetAll,
  onClose,
}: ShortcutDialogProps) {
  const [recording, setRecording] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const attempt = (action: () => void) => {
    try {
      action();
      setFailure("");
      setRecording(null);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : String(error));
    }
  };
  return (
    <Dialog titleId="shortcut-title" onClose={onClose}>
      <div className="dialog-heading">
        <div>
          <span className="section-caption">MAKE IT YOURS</span>
          <h2 id="shortcut-title">Keyboard shortcuts</h2>
        </div>
        <IconButton
          label="Close keyboard shortcuts"
          autoFocus
          onClick={onClose}
        >
          <X size={19} />
        </IconButton>
      </div>
      <p>
        Choose Change, then press a shortcut. Escape cancels capture. Shortcuts
        pause while typing; Space remains the temporary hand tool.
      </p>
      {(failure || error) && <p role="alert">{failure || error}</p>}
      <div className="shortcut-editor">
        {shortcuts.actions.map((action) => (
          <div
            className="shortcut-editor-row"
            role="group"
            aria-label={`${action.label} shortcut`}
            key={action.id}
            data-action={action.id}
          >
            <span>{action.label}</span>
            <kbd>
              {action.keys.length
                ? action.keys.map(formatShortcut).join(" / ")
                : "Unassigned"}
            </kbd>
            <div className="shortcut-editor-actions">
              <Button
                aria-label={`Change ${action.label} shortcut`}
                aria-pressed={recording === action.id}
                onClick={() => {
                  setRecording(action.id);
                  setFailure("");
                }}
                onBlur={() => setRecording(null)}
                onKeyDown={(event) => {
                  if (recording !== action.id) return;
                  event.stopPropagation();
                  if (event.key === "Tab") {
                    setRecording(null);
                    return;
                  }
                  event.preventDefault();
                  if (event.key === "Escape") {
                    setRecording(null);
                    return;
                  }
                  if (
                    event.repeat ||
                    ["Control", "Meta", "Alt", "Shift"].includes(event.key)
                  )
                    return;
                  attempt(() =>
                    onBinding(action.id, [bindingFromEvent(event)]),
                  );
                }}
              >
                {recording === action.id ? "Press shortcut…" : "Change"}
              </Button>
              <Button
                aria-label={`Clear ${action.label} shortcut`}
                onClick={() => attempt(() => onBinding(action.id, []))}
              >
                Clear
              </Button>
              <Button
                aria-label={`Reset ${action.label} shortcut`}
                onClick={() => attempt(() => onBinding(action.id, null))}
              >
                Reset
              </Button>
            </div>
          </div>
        ))}
      </div>
      <Button onClick={() => attempt(onResetAll)}>
        Restore default shortcuts
      </Button>
    </Dialog>
  );
}
