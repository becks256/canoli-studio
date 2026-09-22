import { useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  window.addEventListener("luma:appearance-change", notify);
  return () => window.removeEventListener("luma:appearance-change", notify);
};
const snapshot = () => document.documentElement.dataset.appearance ?? "system";

/** Shares the early appearance bootstrap with static docs (no React hydration needed). */
export function AppearanceSelect({ staticPage = false }: { staticPage?: boolean }) {
  const preference = useSyncExternalStore(subscribe, snapshot, () => "system");
  return (
    <label className="appearance-select">
      <span>Appearance</span>
      <select
        aria-label="Appearance"
        value={preference}
        disabled={staticPage}
        data-static-appearance={staticPage ? "" : undefined}
        onChange={event => window.dispatchEvent(new CustomEvent("luma:set-appearance", { detail: event.target.value }))}
      >
        <option value="system">System</option>
        <option value="light">Light</option>
        <option value="dark">Dark</option>
      </select>
    </label>
  );
}
