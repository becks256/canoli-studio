import { useCallback, useEffect, useRef, useState } from "react";
import type { GenerationJobService } from "../ai/jobs/service";
import type { GenerationJournalEntry } from "../ai/jobs/journal";
import { Button } from "./controls";

export function GenerationRecoveryPanel({
  service,
  refreshKey,
  onAccountingChange,
}: {
  service: GenerationJobService;
  refreshKey: string;
  onAccountingChange(): void;
}) {
  const [entries, setEntries] = useState<GenerationJournalEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const sequence = useRef(0);
  const mounted = useRef(false);
  const refresh = useCallback(
    async (keepError = false) => {
      const request = ++sequence.current;
      setLoading(true);
      if (!keepError) setError(null);
      try {
        const saved = await service.recoveredAccounting();
        if (!mounted.current || request !== sequence.current) return;
        setEntries(saved.filter((entry) => entry.billingState !== "settled"));
        onAccountingChange();
      } catch (value) {
        if (mounted.current && request === sequence.current)
          setError(String(value));
      } finally {
        if (mounted.current && request === sequence.current) setLoading(false);
      }
    },
    [service, onAccountingChange],
  );

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const focus = () => {
      void refresh();
    };
    window.addEventListener("focus", focus);
    return () => {
      mounted.current = false;
      sequence.current++;
      window.removeEventListener("focus", focus);
    };
  }, [refresh, refreshKey]);

  const cancel = async (jobId: string) => {
    setCancelling(jobId);
    setError(null);
    try {
      await service.cancelRecoveredQueued(jobId);
    } catch (value) {
      if (mounted.current) setError(String(value));
    } finally {
      if (mounted.current) {
        setCancelling(null);
        await refresh(true);
      }
    }
  };

  if (entries.length === 0 && !error) return null;
  return (
    <details className="generation-recovery">
      <summary>Unfinished generation requests ({entries.length})</summary>
      <div className="generation-recovery-content">
        <p>
          Saved reservations remain part of your approved budget after closing
          the editor.
        </p>
        <Button
          size="sm"
          variant="secondary"
          disabled={loading || cancelling !== null}
          onClick={() => {
            void refresh();
          }}
        >
          {loading ? "Refreshing…" : "Refresh requests"}
        </Button>
        {error && <p role="alert">{error}</p>}
        <ul aria-label="Unfinished generation requests">
          {entries.map((entry) => (
            <li key={entry.jobId} data-job-id={entry.jobId}>
              <div className="generation-recovery-heading">
                <strong>
                  {service.providerRegistry
                    .listProviders()
                    .find((provider) => provider.id === entry.providerId)
                    ?.name ?? entry.providerId}
                </strong>
                <span>{entry.estimatedCostCents.toFixed(1)}¢ reserved</span>
              </div>
              <small>
                Request {entry.jobId} ·{" "}
                {new Date(entry.createdAt).toLocaleString()}
              </small>
              {entry.billingState === "reserved" ? (
                <>
                  <p>Not dispatched. Cancelling releases this reservation.</p>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={loading || cancelling !== null}
                    onClick={() => {
                      void cancel(entry.jobId);
                    }}
                  >
                    {cancelling === entry.jobId
                      ? "Cancelling…"
                      : "Cancel queued request"}
                  </Button>
                </>
              ) : (
                <p>
                  Dispatched; final charge not confirmed. The reservation
                  remains until the provider’s final charge is reconciled. No
                  automatic retry will be sent.
                </p>
              )}
            </li>
          ))}
        </ul>
      </div>
    </details>
  );
}
