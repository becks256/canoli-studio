import { storageErrorMessage } from "../core/storage-errors";
import { StorageHealthPanel } from "./StorageHealthPanel";
import { useEffect, useState, useSyncExternalStore } from "react";
import { X } from "lucide-react";
import type { EditorApplication } from "../editor";
import type { RecoveryEntry } from "../core/recovery";
import type { AutomaticWorkspaceEntry } from "../workspace/repository";
import { download, fileName } from "./utils";
import { Dialog } from "./Dialog";
import { Button, IconButton } from "./controls";

export function RecoveryPanel({
  editor,
  onClose,
}: {
  editor: EditorApplication;
  onClose(): void;
}) {
  const recovery = useSyncExternalStore(
    editor.recovery.subscribe,
    editor.recovery.getSnapshot,
  );
  const autosave = useSyncExternalStore(
    editor.workspaceAutosave.subscribe,
    editor.workspaceAutosave.getSnapshot,
  );
  const [versionName, setVersionName] = useState("");
  const [versions, setVersions] = useState<
    { id: string; name: string; savedAt: number }[]
  >([]);
  const [automatic, setAutomatic] = useState<AutomaticWorkspaceEntry[]>([]);
  const [restoreOnStartup, setRestoreOnStartup] = useState(
    editor.workspaceRepository.restoreOnStartup,
  );
  const [entries, setEntries] = useState<RecoveryEntry[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [backupStamp, setBackupStamp] = useState("");
  const stamp = () =>
    `${editor.document.id}:${editor.document.getSnapshot().revision}`;
  useEffect(() => {
    let active = true;
    void editor.workspaceRepository
      .listVersions()
      .then((value) => {
        if (active) setVersions(value);
      })
      .catch((cause) => {
        if (active) setError(storageErrorMessage(cause));
      });
    void editor.workspaceRepository
      .listAutomatic()
      .then((value) => {
        if (active) setAutomatic(value);
      })
      .catch((cause) => {
        if (active) setError(storageErrorMessage(cause));
      });
    editor.recovery
      .flush()
      .then(() => editor.recovery.repository.list())
      .then((value) => {
        if (active) setEntries(value);
      })
      .catch((cause) => {
        if (active) setError(storageErrorMessage(cause));
      })
      .finally(() => {
        if (active) setBusy(false);
      });
    return () => {
      active = false;
    };
  }, [editor]);
  async function restore(entry: RecoveryEntry) {
    setBusy(true);
    try {
      await editor.recovery.flush();
      if (
        editor.recovery.getSnapshot().status === "error" &&
        backupStamp !== stamp()
      )
        throw new Error(
          "Save the current project before restoring: recovery storage is unavailable.",
        );
      const restored = await editor.recovery.repository.restore(entry.id);
      await editor.openProject(
        new File([restored.blob], `${entry.document.name}.luma`),
      );
      if (restored.skipped) {
        setNotice(
          `Recovered the intact checkpoint from ${new Date(restored.savedAt).toLocaleString()}. Skipped ${restored.skipped} damaged checkpoint(s). Newer edits may be missing.`,
        );
      } else onClose();
    } catch (cause) {
      setError(storageErrorMessage(cause));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog titleId="recovery-title" onClose={onClose}>
      <div className="dialog-heading">
        <div>
          <span className="eyebrow">LOCAL WORKSPACE</span>
          <h2 id="recovery-title">Recover work</h2>
        </div>
        <IconButton label="Close recovery" onClick={onClose}>
          <X size={18} />
        </IconButton>
      </div>
      <p>
        Completed checkpoints from this browser, including other tabs. Restoring
        opens a copy. Keep downloaded project files as backups; clearing browser
        storage removes these checkpoints.
      </p>
      <StorageHealthPanel />
      {error && <p role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
      {recovery.status === "error" && (
        <>
          <p role="alert">{recovery.message}</p>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await editor.recovery.flush();
                setEntries(await editor.recovery.repository.list());
              } catch (cause) {
                setError(storageErrorMessage(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            Retry document recovery
          </Button>
        </>
      )}
      <Button
        disabled={busy}
        onClick={async () => {
          const savedStamp = stamp();
          setBusy(true);
          try {
            download(
              await editor.saveProject(),
              `${fileName(editor.document.name)}.luma`,
            );
            setBackupStamp(savedStamp);
          } catch (cause) {
            setError(storageErrorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        Download current project
      </Button>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await editor.saveWorkspace();
            setNotice(
              "Workspace saved in this browser, including tab order and canvas views.",
            );
          } catch (cause) {
            setError(storageErrorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        Save workspace
      </Button>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await editor.restoreWorkspace();
            onClose();
          } catch (cause) {
            setError(storageErrorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        Restore workspace
      </Button>
      <label className="field-checkbox">
        <input
          type="checkbox"
          checked={restoreOnStartup}
          disabled={busy}
          onChange={(event) => {
            try {
              editor.workspaceRepository.restoreOnStartup =
                event.target.checked;
              setRestoreOnStartup(event.target.checked);
            } catch (cause) {
              setError(storageErrorMessage(cause));
            }
          }}
        />
        Restore saved workspace on startup
      </label>
      <p role="status">{autosave.message}</p>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await editor.workspaceAutosave.flush();
            setAutomatic(await editor.workspaceRepository.listAutomatic());
          } catch (cause) {
            setError(storageErrorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        Save pending workspace changes
      </Button>
      <Button
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await editor.restoreAutomaticWorkspace();
            onClose();
          } catch (cause) {
            setError(storageErrorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        Restore automatic workspace
      </Button>
      <p className="text-muted">
        Automatic checkpoints preserve this browser tab’s documents and views.
        Startup restoration uses its latest automatic checkpoint, or your manual
        Save workspace checkpoint if none exists. Named versions and document
        recovery remain separate.
      </p>
      <h3>Saved browser workspaces</h3>
      <Button
        disabled={busy}
        variant="subtle"
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            setAutomatic(await editor.workspaceRepository.listAutomatic());
          } catch (cause) {
            setError(storageErrorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        Refresh automatic workspaces
      </Button>
      {!automatic.length && (
        <p className="text-muted">No automatic checkpoints found.</p>
      )}
      {automatic.map((entry) => (
        <div
          className="recovery-row"
          role="group"
          aria-label={`Automatic workspace ${entry.names.join(", ")}`}
          key={entry.id}
        >
          <div>
            <strong>{entry.names.join(", ")}</strong>
            <small>
              {entry.savedAt === null
                ? "Unknown save time"
                : new Date(entry.savedAt).toLocaleString()}
            </small>
            {entry.error && <p role="status">{entry.error}</p>}
          </div>
          <Button
            disabled={busy || !!entry.error}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await editor.restoreAutomaticWorkspace(entry.id);
                onClose();
              } catch (cause) {
                setError(storageErrorMessage(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            Open workspace copy
          </Button>
          <Button
            disabled={busy}
            variant="subtle"
            onClick={async () => {
              if (removeId !== entry.id) {
                setRemoveId(entry.id);
                return;
              }
              setBusy(true);
              setError("");
              try {
                await editor.workspaceRepository.removeAutomatic(entry.id);
                setAutomatic(await editor.workspaceRepository.listAutomatic());
                setRemoveId(null);
              } catch (cause) {
                setError(storageErrorMessage(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            {removeId === entry.id
              ? "Confirm remove checkpoint"
              : "Remove checkpoint"}
          </Button>
        </div>
      ))}
      <label>
        Version name
        <input
          aria-label="Workspace version name"
          maxLength={120}
          value={versionName}
          disabled={busy}
          onChange={(event) => setVersionName(event.target.value)}
        />
      </label>
      <Button
        disabled={busy || !versionName.trim()}
        onClick={async () => {
          setBusy(true);
          setError("");
          try {
            await editor.saveWorkspaceVersion(versionName);
            setVersions(await editor.workspaceRepository.listVersions());
            setVersionName("");
            setNotice("Named workspace version saved.");
          } catch (cause) {
            setError(storageErrorMessage(cause));
          } finally {
            setBusy(false);
          }
        }}
      >
        Save named version
      </Button>
      {versions.map((version) => (
        <div className="recovery-row" key={version.id}>
          <div>
            <strong>{version.name}</strong>
            <small>{new Date(version.savedAt).toLocaleString()}</small>
          </div>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError("");
              try {
                await editor.restoreWorkspace(version.id);
                onClose();
              } catch (cause) {
                setError(storageErrorMessage(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            Restore version
          </Button>
          <Button
            disabled={busy}
            variant="subtle"
            onClick={async () => {
              if (removeId !== version.id) {
                setRemoveId(version.id);
                return;
              }
              setBusy(true);
              setError("");
              try {
                await editor.workspaceRepository.removeVersion(version.id);
                setVersions(await editor.workspaceRepository.listVersions());
                setRemoveId(null);
              } catch (cause) {
                setError(storageErrorMessage(cause));
              } finally {
                setBusy(false);
              }
            }}
          >
            {removeId === version.id
              ? "Confirm remove version"
              : "Remove version"}
          </Button>
        </div>
      ))}
      {busy && <p role="status">Reading recovery storage…</p>}
      {!busy && !entries.length && !error && <p>No saved checkpoints yet.</p>}
      <div className="recovery-list">
        {entries.map((entry) => (
          <div className="recovery-row" key={entry.id}>
            <div>
              <strong>{entry.document.name}</strong>
              <small>
                {entry.document.width} × {entry.document.height} ·{" "}
                {new Date(entry.savedAt).toLocaleString()}
              </small>
            </div>
            <Button disabled={busy} onClick={() => void restore(entry)}>
              Restore
            </Button>
            {entry.id !== editor.recoverySessionId && (
              <Button
                disabled={busy}
                variant="subtle"
                onClick={async () => {
                  if (removeId !== entry.id) {
                    setRemoveId(entry.id);
                    return;
                  }
                  setBusy(true);
                  try {
                    await editor.recovery.repository.remove(entry.id);
                    setEntries(await editor.recovery.repository.list());
                    setRemoveId(null);
                  } catch (cause) {
                    setError(storageErrorMessage(cause));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                {removeId === entry.id ? "Confirm remove" : "Remove"}
              </Button>
            )}
          </div>
        ))}
      </div>
    </Dialog>
  );
}
