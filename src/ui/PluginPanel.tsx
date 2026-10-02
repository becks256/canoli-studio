import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  Download,
  FileUp,
  Play,
  Puzzle,
  Square,
  Trash2,
  X,
} from "lucide-react";
import type { EditorApplication } from "../editor";
import { examplePlugin, parsePlugin } from "../plugins";
import type { PluginManifest, PluginPermission } from "../plugins";
import { Dialog } from "./Dialog";
import { Button, IconButton } from "./controls";

export function PluginPanel({
  editor,
  onClose,
}: {
  editor: EditorApplication;
  onClose(): void;
}) {
  const { plugins, grantedPermissions, storageMessage } = useSyncExternalStore(
    editor.plugins.subscribe,
    editor.plugins.getSnapshot,
  );
  const [review, setReview] = useState<PluginManifest | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState("");
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => () => editor.scripts.cancel(), [editor]);
  const attempt = (fn: () => void) => {
    try {
      fn();
      setError("");
    } catch (error) {
      setError((error as Error).message);
    }
  };
  async function run(pluginId: string, commandId: string) {
    if (running) return;
    setRunning(`${pluginId}/${commandId}`);
    setLogs([]);
    setError("");
    try {
      setLogs([
        ...(await editor.runPlugin(pluginId, commandId)),
        "Finished. Document edits can be undone together.",
      ]);
    } catch (error) {
      setError((error as Error).message);
    } finally {
      setRunning(null);
    }
  }
  function download(id: string) {
    const url = URL.createObjectURL(
      new Blob([editor.plugins.export(id)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = `${id}.luma-plugin.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  return (
    <Dialog titleId="plugin-title" className="plugin-dialog" onClose={onClose}>
      <div className="dialog-heading">
        <div>
          <span className="section-caption">MAKE IT YOUR OWN</span>
          <h2 id="plugin-title">Plugins</h2>
        </div>
        <IconButton label="Close plugins" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      <p className="script-description">
        Install commands for your workflow. Plugins run when you choose a
        command and use the same editable document and undo history.
      </p>
      <div className="plugin-actions">
        <Button
          variant="primary"
          disabled={!!running}
          onClick={() => input.current?.click()}
        >
          <FileUp size={14} />
          Import plugin
        </Button>
        <Button
          variant="subtle"
          disabled={!!running}
          onClick={() => {
            setReview(parsePlugin(examplePlugin));
            setError("");
          }}
        >
          Load example
        </Button>
        <a
          href={`${import.meta.env.BASE_URL}developer/plugins.html`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Build a plugin ↗
        </a>
      </div>
      <input
        type="file"
        ref={input}
        data-testid="plugin-input"
        accept=".json,.luma-plugin"
        hidden
        onChange={async (event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = "";
          if (!file) return;
          if (file.size > 250_000) {
            setError("Plugin packages must be at most 250 KB.");
            return;
          }
          try {
            setReview(parsePlugin(await file.text()));
            setError("");
          } catch (error) {
            setError((error as Error).message);
          }
        }}
      />
      {storageMessage && <p className="plugin-notice">{storageMessage}</p>}
      {review && (
        <section className="plugin-review" aria-label="Review plugin">
          <h3>
            {review.name} <small>{review.version}</small>
          </h3>
          <p>{review.description}</p>
          <p>
            Access:{" "}
            {review.permissions.includes("document:write")
              ? "read and edit the open document"
              : "read the open document"}
            . No network or file access.
          </p>
          <p>
            Author: {review.author ?? "Not provided"} · {review.id}
          </p>
          {editor.plugins.get(review.id) && (
            <p>
              This replaces installed version{" "}
              {editor.plugins.get(review.id)!.version}.
            </p>
          )}
          <details>
            <summary>Review command source ({review.commands.length})</summary>
            {review.commands.map((command) => (
              <div key={command.id}>
                <h4>{command.title}</h4>
                <pre>{command.source}</pre>
              </div>
            ))}
          </details>
          <div className="plugin-actions">
            <Button
              variant="primary"
              disabled={!!running}
              onClick={() =>
                attempt(() => {
                  editor.plugins.install(review);
                  setReview(null);
                  setLogs(["Plugin installed. Choose a command to run it."]);
                })
              }
            >
              {editor.plugins.get(review.id)
                ? "Replace installed plugin"
                : "Install plugin"}
            </Button>
            <Button variant="subtle" onClick={() => setReview(null)}>
              Cancel
            </Button>
          </div>
        </section>
      )}
      <div className="plugin-list">
        {!plugins.length && !review ? (
          <div className="plugin-empty">
            <Puzzle size={24} />
            <h3>Your studio, extended.</h3>
            <p>
              Import a plugin package or load the example to try an editable
              guide frame.
            </p>
          </div>
        ) : (
          plugins.map((plugin) => (
            <section className="plugin-card" key={plugin.id}>
              <div className="plugin-card-heading">
                <h3>
                  {plugin.name} <small>{plugin.version}</small>
                </h3>
                <IconButton
                  label={`Export ${plugin.name}`}
                  disabled={!!running}
                  onClick={() => attempt(() => download(plugin.id))}
                >
                  <Download size={14} />
                </IconButton>
                <IconButton
                  label={`Remove ${plugin.name}`}
                  disabled={!!running}
                  onClick={() =>
                    attempt(() => editor.plugins.remove(plugin.id))
                  }
                >
                  <Trash2 size={14} />
                </IconButton>
              </div>
              <p>{plugin.description}</p>
              <div
                className="plugin-permissions-list"
                aria-label={`Permissions for ${plugin.name}`}
              >
                <span className="plugin-perm-label">Permissions</span>
                <div className="plugin-perm-chips">
                  {plugin.permissions.map((perm: PluginPermission) => {
                    const granted = (
                      grantedPermissions?.[plugin.id] ?? plugin.permissions
                    ).includes(perm);
                    const isRequired = perm === "document:read";
                    return (
                      <span
                        key={perm}
                        className={`plugin-perm-badge ${granted ? "granted" : "revoked"}`}
                        title={
                          granted
                            ? `Permission '${perm}' is active`
                            : `Permission '${perm}' has been revoked by user`
                        }
                      >
                        <code>{perm}</code>
                        {isRequired ? (
                          <small className="perm-tag">required</small>
                        ) : (
                          <button
                            type="button"
                            className="perm-toggle-btn"
                            aria-label={
                              granted ? `Revoke ${perm}` : `Grant ${perm}`
                            }
                            disabled={!!running}
                            onClick={() => {
                              attempt(() => {
                                if (granted) {
                                  editor.plugins.revokePermission(
                                    plugin.id,
                                    perm,
                                  );
                                } else {
                                  editor.plugins.grantPermission(
                                    plugin.id,
                                    perm,
                                  );
                                }
                              });
                            }}
                          >
                            {granted ? "Revoke" : "Grant"}
                          </button>
                        )}
                      </span>
                    );
                  })}
                </div>
              </div>
              {plugin.commands.map((command) => (
                <div className="plugin-command" key={command.id}>
                  <div>
                    <strong>{command.title}</strong>
                    <p>{command.description}</p>
                  </div>
                  <Button
                    variant="subtle"
                    size="sm"
                    className="compact"
                    aria-label={`Run ${command.title}`}
                    disabled={!!running}
                    onClick={() => void run(plugin.id, command.id)}
                  >
                    <Play size={13} />
                    Run
                  </Button>
                </div>
              ))}
            </section>
          ))
        )}
      </div>
      {running && (
        <Button variant="subtle" onClick={() => editor.scripts.cancel()}>
          <Square size={13} />
          Stop plugin
        </Button>
      )}
      <div
        className="script-output"
        aria-label="Plugin output"
        aria-live="polite"
      >
        {error ? (
          <p role="alert">{error}</p>
        ) : logs.length ? (
          logs.map((line, index) => <div key={index}>{line}</div>)
        ) : (
          <span>{running ? "Running…" : "Command output appears here."}</span>
        )}
      </div>
      <p className="plugin-footnote">
        Installed in this browser profile. Packages contain JavaScript; inspect
        the source and use plugins from authors you trust. Each run is isolated
        and limited to five seconds.
      </p>
    </Dialog>
  );
}
