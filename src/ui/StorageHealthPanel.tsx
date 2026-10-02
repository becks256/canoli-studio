import { useEffect, useRef, useState } from "react";
import {
  readStorageHealth,
  requestStoragePersistence,
  type StorageHealth,
} from "../core/storage-health";
import { Button } from "./controls";

function formatBytes(value: number | undefined): string {
  if (value === undefined) return "Unavailable";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${units[unit]}`;
}

export function StorageHealthPanel() {
  const [health, setHealth] = useState<StorageHealth>();
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    void readStorageHealth()
      .then((value) => {
        if (current === generation.current) setHealth(value);
      })
      .catch(() => {
        if (current === generation.current)
          setMessage("Storage diagnostics are unavailable.");
      })
      .finally(() => {
        if (current === generation.current) setBusy(false);
      });
    return () => {
      generation.current++;
    };
  }, []);
  async function refresh(requestPersistence = false) {
    const current = ++generation.current;
    setBusy(true);
    setMessage("");
    try {
      if (requestPersistence) {
        const granted = await requestStoragePersistence();
        if (current !== generation.current) return;
        setMessage(
          granted
            ? "Persistent storage granted."
            : "The browser did not grant persistent storage. Existing checkpoints remain available.",
        );
      }
      const next = await readStorageHealth();
      if (current === generation.current) setHealth(next);
    } catch (error) {
      if (current === generation.current)
        setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      if (current === generation.current) setBusy(false);
    }
  }
  const remaining =
    health?.usage !== undefined && health.quota !== undefined
      ? Math.max(0, health.quota - health.usage)
      : undefined;
  return (
    <section aria-label="Browser storage" className="storage-health">
      <h3>Browser storage</h3>
      <dl>
        <div>
          <dt>Estimated usage</dt>
          <dd>{formatBytes(health?.usage)}</dd>
        </div>
        <div>
          <dt>Estimated quota</dt>
          <dd>{formatBytes(health?.quota)}</dd>
        </div>
        <div>
          <dt>Estimated remaining</dt>
          <dd>{formatBytes(remaining)}</dd>
        </div>
        <div>
          <dt>Persistence</dt>
          <dd>
            {health?.persisted === true
              ? "Granted"
              : health?.persisted === false
                ? "Not granted"
                : "Unavailable"}
          </dd>
        </div>
      </dl>
      <p className="text-muted">
        Estimates cover all data for this site, including projects, recovery,
        recipes and batch outputs. Available space can change; an estimate does
        not guarantee that a save will succeed. Persistence reduces automatic
        eviction, but clearing site data still removes saved work. Keep
        downloaded backups.
      </p>
      <div className="storage-health-actions">
        <Button variant="subtle" disabled={busy} onClick={() => void refresh()}>
          Refresh storage estimate
        </Button>
        <Button
          variant="subtle"
          disabled={
            busy || !health?.canRequestPersistence || health.persisted === true
          }
          onClick={() => void refresh(true)}
        >
          Request persistent storage
        </Button>
      </div>
      <div role="status">{busy ? "Reading browser storage…" : message}</div>
      {health?.errors.map((error) => (
        <p key={error} role="status">
          {error}
        </p>
      ))}
    </section>
  );
}
