import {
  LibraryBig,
  Search,
  PanelsTopLeft,
  Fingerprint,
  Blend,
  ClipboardCheck,
  Sun,
  Moon,
  BookOpen,
  History,
  Code2,
  Crop,
  Eraser,
  FilePlus2,
  Frame,
  Hand,
  HelpCircle,
  ImagePlus,
  MousePointer2,
  MousePointerSquareDashed,
  Paintbrush,
  PaintBucket,
  Pencil,
  PenTool,
  Puzzle,
  Scan,
  Lasso,
  Stamp,
  SquareDashed,
  Bandage,
  WandSparkles,
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
  onOpenPalette(): void;
  onOpenHelp(): void;
  onOpenRecovery(): void;
  onOpenPreflight(): void;
  onOpenWorkspace(): void;
  onOpenArtworkLibrary(): void;
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
  onOpenPalette,
  onOpenHelp,
  onOpenRecovery,
  onOpenPreflight,
  onOpenWorkspace,
  onOpenArtworkLibrary,
  docsUrl = `${import.meta.env.BASE_URL}developer/scripting-api.html`,
}: ToolRailProps) {
  return (
    <nav className="tool-rail" aria-label="Editor tools">
      <div className="rail-tools">
        <IconButton
          shortcutId="command-palette"
          label="Find a command (Mod+K)"
          className="tool-button"
          disabled={busy}
          onClick={onOpenPalette}
        >
          <Search size={19} />
        </IconButton>
        <IconButton
          shortcutId="move"
          label="Move tool (V)"
          aria-pressed={tool === "move" && !spacePan}
          className={`tool-button ${tool === "move" && !spacePan ? "active" : ""}`}
          onClick={() => onChooseTool("move")}
        >
          <MousePointer2 size={19} />
        </IconButton>
        <IconButton
          shortcutId="hand"
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
            ["lasso", "Lasso tool (L)", Lasso],
            ["wand", "Magic wand tool (W)", WandSparkles],
            ["quick-select", "Quick selection (Shift+W)", MousePointerSquareDashed],
            ["fill", "Paint bucket (G)", PaintBucket],
            ["brush", "Brush tool (B)", Paintbrush],
            ["smudge", "Smudge tool", Fingerprint],
            ["mixer", "Mixer brush", Blend],
            ["dodge", "Dodge tool (O)", Sun],
            ["burn", "Burn tool (Shift+O)", Moon],
            ["pencil", "Pencil tool (N)", Pencil],
            ["eraser", "Eraser tool (E)", Eraser],
            ["pen", "Vector pen (P)", PenTool],
            ["text", "Text tool (T)", Type],
            ["clone", "Clone brush (S)", Stamp],
            ["patch", "Patch tool (J)", SquareDashed],
            ["heal", "Spot Healing (Shift+J)", Bandage],
            ["artboard", "Artboard editor (A)", Frame],
            ["crop", "Crop canvas (C)", Crop],
          ] as const
        ).map(([key, label, Icon]) => (
          <IconButton
            key={key}
            shortcutId={key}
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
          shortcutId="import"
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
        <IconButton shortcutId="artwork-library" label="Artwork library" className="tool-button" disabled={busy} onClick={onOpenArtworkLibrary}><LibraryBig size={19}/></IconButton>
        <IconButton
          shortcutId="scripts"
          label="Scripts (Mod+Shift+K)"
          className="tool-button"
          disabled={busy}
          onClick={onOpenScripts}
        >
          <Code2 size={19} />
        </IconButton>
        <IconButton
          shortcutId="plugins"
          label="Plugins (Mod+Shift+L)"
          className="tool-button"
          disabled={busy}
          onClick={onOpenPlugins}
        >
          <Puzzle size={19} />
        </IconButton>
      </div>
      <div className="rail-bottom">
        <IconButton shortcutId="workspace-layout" label="Workspace layout" className="tool-button" onClick={onOpenWorkspace} disabled={busy}><PanelsTopLeft size={18}/></IconButton>
        <IconButton label="Design checks" className="tool-button" onClick={onOpenPreflight} disabled={busy}><ClipboardCheck size={18}/></IconButton>
        <IconButton
          label="Recover work"
          className="tool-button"
          onClick={onOpenRecovery}
        >
          <History size={18} />
        </IconButton>
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
          shortcutId="help"
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
