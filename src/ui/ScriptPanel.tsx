import { useEffect, useState } from "react";
import { Play, Square, X } from "lucide-react";
import type { EditorApplication } from "../editor";
import { Dialog } from "./Dialog";
import { Button, IconButton } from "./controls";

const example = `// Select an unlocked image layer, then run.
const source = document.selectedLayer;
if (!(source instanceof RasterLayer)) {
  throw new Error('Select an image layer first.');
}
const group = new LayerGroup({ name: 'My variation' });
document.layers.add(group);
const copy = source.duplicate();
copy.moveTo(group);
copy.name = 'A warmer possibility';
copy.adjustments.add(new ToneAdjustment({
  exposure: 0.2, saturation: -15
}));
document.selectedLayer = copy;
print('Created', copy.name);`;

export function ScriptPanel({
  editor,
  onClose,
}: {
  editor: EditorApplication;
  onClose(): void;
}) {
  const [code, setCode] = useState(example);
  const [running, setRunning] = useState(false);
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState("");
  useEffect(() => () => editor.scripts.cancel(), [editor]);
  async function run() {
    if (running) return;
    setRunning(true);
    setError("");
    setLogs([]);
    try {
      const lines = await editor.runScript(code);
      setLogs([...lines, "Finished. Edits can be undone together."]);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Script failed.");
    } finally {
      setRunning(false);
    }
  }
  return (
    <Dialog titleId="script-title" className="script-dialog" onClose={onClose}>
      <div className="dialog-heading">
        <div>
          <span className="section-caption">YOUR WORKFLOW, YOUR WAY</span>
          <h2 id="script-title">Scripts</h2>
        </div>
        <IconButton label="Close scripts" onClick={onClose}>
          <X size={19} />
        </IconButton>
      </div>
      <p className="script-description">
        Use JavaScript and document constructors to edit this composition. Each
        successful run is one undo step.{" "}
        <a
          href={`${import.meta.env.BASE_URL}developer/scripting-api.html`}
          target="_blank"
          rel="noopener noreferrer"
        >
          Developer docs ↗
        </a>
      </p>
      <textarea
        aria-label="Script code"
        spellCheck={false}
        value={code}
        onChange={(event) => setCode(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            void run();
          }
        }}
      />
      <div className="script-actions">
        <span>JavaScript · Mod+Enter to run</span>
        {running ? (
          <Button variant="subtle" onClick={() => editor.scripts.cancel()}>
            <Square size={13} />
            Stop script
          </Button>
        ) : (
          <Button variant="primary" onClick={() => void run()}>
            <Play size={14} />
            Run script
          </Button>
        )}
      </div>
      <div
        className="script-output"
        aria-label="Script output"
        aria-live="polite"
      >
        {error ? (
          <p role="alert">{error}</p>
        ) : logs.length ? (
          logs.map((line, index) => <div key={index}>{line}</div>)
        ) : (
          <span>{running ? "Running…" : "Output will appear here."}</span>
        )}
      </div>
      <p>
        Available: document, Document, RasterLayer, LayerGroup, PaintLayer,
        BrushStroke, PencilStroke, CloneStroke, PaintFill, VectorLayer,
        VectorPath, MarqueeSelection, LayerStyle, BlendIf, ToneAdjustment,
        print. Scripts run in isolation with a 5-second limit and no network or
        file access. Import images through the editor first.
      </p>
    </Dialog>
  );
}
