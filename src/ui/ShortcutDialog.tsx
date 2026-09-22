import { X } from "lucide-react";
import { Dialog } from "./Dialog";
import { IconButton } from "./controls";
import { formatShortcut } from "./shortcuts";
import type { ShortcutRegistry } from "./shortcuts";

export interface ShortcutDialogProps {
  shortcuts: ShortcutRegistry;
  onClose(): void;
}

export function ShortcutDialog({ shortcuts, onClose }: ShortcutDialogProps) {
  return (
    <Dialog titleId="shortcut-title" onClose={onClose}>
      <div className="dialog-heading">
        <div>
          <span className="section-caption">A LITTLE LESS CLICKING</span>
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
      <div className="shortcut-grid">
        {shortcuts.actions
          .filter(
            (action) =>
              !action.id.startsWith("nudge-") ||
              action.id === "nudge-Right-1" ||
              action.id === "nudge-Right-10",
          )
          .map((action) => (
            <div key={action.id}>
              <span>{action.label}</span>
              <kbd>{formatShortcut(action.keys[0])}</kbd>
            </div>
          ))}
        <div>
          <span>Temporary hand tool</span>
          <kbd>Hold Space</kbd>
        </div>
      </div>
      <p>
        Shortcuts pause while you type. Use any arrow key to nudge; hold
        Shift for 10 pixels.
      </p>
    </Dialog>
  );
}
