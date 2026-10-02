import { useRef, useState, useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";
import { AppearanceSelect } from "./AppearanceSelect";
import { IconButton } from "./controls";

const subscribe = (notify: () => void) => {
  window.addEventListener("luma:appearance-change", notify);
  return () => window.removeEventListener("luma:appearance-change", notify);
};
const snapshot = () => document.documentElement.dataset.theme ?? "dark";

export function AppearanceToggle() {
  const theme = useSyncExternalStore(subscribe, snapshot, () => "dark");
  const settings = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const label = `Switch to ${theme === "dark" ? "light" : "dark"} mode`;
  const showSettings = () => {
    const panel = settings.current;
    const anchor = trigger.current;
    if (!panel || !anchor) return;
    const rect = anchor.getBoundingClientRect();
    panel.style.left = `${rect.right + 8}px`;
    panel.style.top = `${Math.max(8, Math.min(rect.top, window.innerHeight - 90))}px`;
    panel.showPopover();
    panel.querySelector("select")?.focus();
  };
  return (
    <div ref={trigger} className="appearance-toggle">
      <IconButton
        label={label}
        title={`${label} · Right-click or press ↓ for appearance settings`}
        className="tool-button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("luma:set-appearance", {
              detail: theme === "dark" ? "light" : "dark",
            }),
          )
        }
        onContextMenu={(event) => {
          event.preventDefault();
          showSettings();
        }}
        onKeyDown={(event) => {
          if (
            event.key === "ArrowDown" ||
            (event.shiftKey && event.key === "F10")
          ) {
            event.preventDefault();
            showSettings();
          }
        }}
      >
        {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
      </IconButton>
      <div
        ref={settings}
        popover="auto"
        role="dialog"
        aria-label="Appearance settings"
        className="appearance-popover"
        onToggle={() =>
          setOpen(settings.current?.matches(":popover-open") ?? false)
        }
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            event.preventDefault();
            event.stopPropagation();
            settings.current?.hidePopover();
            trigger.current?.querySelector("button")?.focus();
          }
        }}
      >
        <AppearanceSelect />
      </div>
    </div>
  );
}
