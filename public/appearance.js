// Shared, parser-blocking bootstrap for the editor and static developer docs.
(() => {
  const key = "luma.appearance.v1";
  const root = document.documentElement;
  const system = matchMedia("(prefers-color-scheme: dark)");
  const valid = value => ["light", "dark", "system"].includes(value);
  const read = () => {
    try { const value = localStorage.getItem(key); return valid(value) ? value : "system"; }
    catch { return "system"; }
  };
  let preference = read();
  const syncControls = () => {
    document.querySelectorAll("select[data-static-appearance]").forEach(control => {
      control.value = preference;
      control.disabled = false;
    });
  };
  const apply = () => {
    const theme = preference === "system" ? (system.matches ? "dark" : "light") : preference;
    root.dataset.theme = theme;
    root.dataset.appearance = preference;
    root.style.colorScheme = theme;
    syncControls();
    window.dispatchEvent(new Event("luma:appearance-change"));
  };
  const set = value => {
    if (!valid(value)) return;
    preference = value;
    try { localStorage.setItem(key, value); } catch { /* Keep the choice for this page. */ }
    apply();
  };
  window.addEventListener("luma:set-appearance", event => set(event.detail));
  document.addEventListener("change", event => {
    if (event.target instanceof HTMLSelectElement && event.target.hasAttribute("data-static-appearance")) set(event.target.value);
  });
  window.addEventListener("storage", event => {
    if (event.key !== key && event.key !== null) return;
    try { if (event.storageArea !== localStorage) return; } catch { return; }
    preference = read();
    apply();
  });
  system.addEventListener("change", () => { if (preference === "system") apply(); });
  document.addEventListener("DOMContentLoaded", syncControls);
  window.addEventListener("pageshow", apply);
  apply();
})();
