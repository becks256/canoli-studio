import {
  BookOpen,
  Code2,
  FilePlus2,
  Frame,
  Hand,
  HelpCircle,
  ImagePlus,
  MousePointer2,
  Paintbrush,
  PaintBucket,
  Pencil,
  PenTool,
  Puzzle,
  Scan,
  Stamp,
  Type,
} from "lucide-react";
import { AppearanceToggle } from "./AppearanceToggle";
import type { Tool } from "../tools";
import { IconButton } from "./controls";

export interface ToolRailProps {
  tool: Tool;
  spacePan: boolean;
  busy: boolean;
  onChooseTool(tool: Tool): void;
  onImport(): void;
  onNewDocument(): void;
  onOpenScripts(): void;
  onOpenPlugins(): void;
  onOpenHelp(): void;
  docsUrl?: string;
}

export function ToolRail({
  tool,
  spacePan,
  busy,
  onChooseTool,
  onImport,
  onNewDocument,
  onOpenScripts,
  onOpenPlugins,
  onOpenHelp,
  docsUrl = `${import.meta.env.BASE_URL}developer/scripting-api.html`,
}: ToolRailProps) {
  return (
    <nav className="tool-rail" aria-label="Editor tools">
      <IconButton
        label="Move tool (V)"
        aria-pressed={tool === "move" && !spacePan}
        className={`tool-button ${tool === "move" && !spacePan ? "active" : ""}`}
        onClick={() => onChooseTool("move")}
      >
        <MousePointer2 size={19} />
      </IconButton>
      <IconButton
        label="Hand tool (H)"
        aria-pressed={tool === "hand" || spacePan}
        className={`tool-button ${tool === "hand" || spacePan ? "active" : ""}`}
        onClick={() => onChooseTool("hand")}
      >
        <Hand size={19} />
      </IconButton>
      {(
        [
          ["marquee", "Marquee tool (M)", Scan],
          ["fill", "Paint bucket (G)", PaintBucket],
          ["brush", "Brush tool (B)", Paintbrush],
          ["pencil", "Pencil tool (N)", Pencil],
          ["pen", "Vector pen (P)", PenTool],
          ["text", "Text tool (T)", Type],
          ["clone", "Clone brush (S)", Stamp],
          ["artboard", "Artboard editor (A)", Frame],
        ] as const
      ).map(([key, label, Icon]) => (
        <IconButton
          key={key}
          label={label}
          aria-pressed={tool === key}
          className={`tool-button ${tool === key ? "active" : ""}`}
          disabled={busy}
          onClick={() => onChooseTool(key)}
        >
          <Icon size={19} />
        </IconButton>
      ))}
      <span className="rail-divider" />
      <IconButton
        label="Import image (Mod+O)"
        className="tool-button"
        disabled={busy}
        onClick={onImport}
      >
        <ImagePlus size={19} />
      </IconButton>
      <IconButton
        label="New document"
        className="tool-button"
        disabled={busy}
        onClick={onNewDocument}
      >
        <FilePlus2 size={19} />
      </IconButton>
      <IconButton
        label="Scripts (Mod+Shift+K)"
        className="tool-button"
        disabled={busy}
        onClick={onOpenScripts}
      >
        <Code2 size={19} />
      </IconButton>
      <IconButton
        label="Plugins (Mod+Shift+L)"
        className="tool-button"
        disabled={busy}
        onClick={onOpenPlugins}
      >
        <Puzzle size={19} />
      </IconButton>
      <div className="rail-bottom">
        <AppearanceToggle />
        <a
          className="tool-button docs-link"
          href={docsUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label="Developer docs"
          title="Developer docs"
        >
          <BookOpen size={18} />
        </a>
        <IconButton
          label="Keyboard shortcuts (?)"
          className="tool-button"
          onClick={onOpenHelp}
        >
          <HelpCircle size={18} />
        </IconButton>
      </div>
    </nav>
  );
}
