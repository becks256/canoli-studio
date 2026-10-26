import {TextPathPanel} from './TextPathPanel';
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { systemFonts, subscribeSystemFonts, getSystemFonts } from "./system-fonts";
import {subscribeNativeFontChanges} from '../fonts/native-events';
import { fontAvailability, type FontAvailability } from "./font-availability";
import { AlignLeft, AlignCenter, AlignRight } from "lucide-react";
import type { TextLayer } from "../dom";
import type { EditorCommand } from "../core/commands";
import {FONT_STRETCHES,type FontVariantCaps,type FontStretch} from '../core/font-features';
import {
  Button,
  ColorField,
  NumberField,
  SegmentedControl,
  Select,
  Slider,
  TextArea,
  TextInput,
} from "./controls";
import {VariableFontAxes} from './VariableFontAxes';
import {CharacterFormattingPanel} from './CharacterFormattingPanel';
import { InspectorSection } from "./InspectorSection";

export const FONT_FAMILIES = [
  "sans-serif",
  "serif",
  "monospace",
  "system-ui",
  "Arial",
  "Helvetica",
  "Times New Roman",
  "Georgia",
  "Courier New",
  "Verdana",
  "Trebuchet MS",
  "Impact",
];

export interface TypographyPanelProps {
  onManageFonts?():void;
  layer: TextLayer;
  disabled: boolean;
  onAction(action: () => void): void;
  onPreview(command: EditorCommand): void;
}

export function TypographyPanel({
  onManageFonts,
  layer,
  disabled,
  onAction,
  onPreview,
}: TypographyPanelProps) {
  const family = layer.fontFamily;
  const [characterSelection,setCharacterSelection]=useState({id:layer.id,text:layer.text,start:0,end:0});
  const selection=characterSelection.id===layer.id&&characterSelection.text===layer.text?characterSelection:{start:0,end:0};
  const embeddedFonts=layer.document?.fonts.files.items??[],embeddedFont=embeddedFonts.find(file=>file.family===family);
  const capitalsSupported=typeof CanvasRenderingContext2D!=='undefined'&&'fontVariantCaps'in CanvasRenderingContext2D.prototype;
  const stretchSupported=typeof CanvasRenderingContext2D!=='undefined'&&'fontStretch'in CanvasRenderingContext2D.prototype;
  const weight=layer.fontWeight??'normal',numericWeight=weight==='normal'?400:weight==='bold'?700:Number(weight);
  const hasNumericWeight=Number.isFinite(numericWeight)&&numericWeight>=1&&numericWeight<=1000;
  const wordSpacingSupported = typeof CanvasRenderingContext2D !== 'undefined' && 'wordSpacing' in CanvasRenderingContext2D.prototype;
  const kerningSupported = typeof CanvasRenderingContext2D !== 'undefined' && 'fontKerning' in CanvasRenderingContext2D.prototype;
  const paragraphSupported = typeof Intl.Segmenter === 'function';
  const localFonts = useSyncExternalStore(subscribeSystemFonts, getSystemFonts);
  const [fontMessage, setFontMessage] = useState("");
  const [loadingFonts, setLoadingFonts] = useState(false);
  const families = useMemo(
    () => [...new Set([...FONT_FAMILIES, ...localFonts, family])],
    [localFonts, family],
  );
  const canListFonts = typeof window !== "undefined" && "queryLocalFonts" in window;
  const loadFonts = async () => {
    setLoadingFonts(true);
    setFontMessage("");
    try {
      const fonts = await systemFonts();
      setFontMessage(fonts.length ? `${fonts.length} installed font families available.` :
        "No fonts were shared. Allow local font access in browser site settings, then retry, or enter a family name below.");
    } catch {
      setFontMessage("System fonts could not be accessed. Allow local font access in browser site settings, then retry, or enter a family name below.");
    } finally {
      setLoadingFonts(false);
    }
  };
  const [availability, setAvailability] = useState<FontAvailability>("unknown");
  useEffect(() => {
    let disposed = false,
      request = 0;
    const refresh = () => {
      const current = ++request;
      setAvailability("unknown");
      void fontAvailability(family).then((value) => {
        if (!disposed && current === request) setAvailability(value);
      });
    };
    refresh();
    document.fonts?.addEventListener("loadingdone", refresh);
    document.fonts?.addEventListener("loadingerror", refresh);
    const stopOwned=subscribeNativeFontChanges(document.fonts,refresh);
    return () => {
      stopOwned();
      disposed = true;
      document.fonts?.removeEventListener("loadingdone", refresh);
      document.fonts?.removeEventListener("loadingerror", refresh);
    };
  }, [family]);

  return (
    <InspectorSection title="Text" className="typography-panel">
      {onManageFonts&&<Button variant="subtle" onClick={onManageFonts}>Manage document fonts…</Button>}
      <TextArea
        label="Content"
        ariaLabel="Text content"
        value={layer.text}
        disabled={disabled}
        rows={3}
        key={layer.id}
        onEdit={(previous,start,end,replacement)=>onAction(()=>{if(layer.text!==previous)throw new Error('Text changed while editing. Select the current text and retry.');layer.replaceText(start,end,replacement);})}
        onSelection={(start,end)=>setCharacterSelection({id:layer.id,text:layer.text,start,end})}
      />
      <CharacterFormattingPanel layer={layer} start={selection.start} end={selection.end} disabled={disabled}/>
      <TextPathPanel layer={layer} disabled={disabled} onAction={onAction} onPreview={onPreview}/>
      <Select label="Text layout" value={layer.textPath?'path':layer.wrapWidth === undefined ? 'point' : 'paragraph'} disabled={disabled || !!layer.textPath || (!paragraphSupported && layer.wrapWidth === undefined)}
        options={[{value:'point',label:'Point text'},{value:'paragraph',label:'Paragraph text'},...(layer.textPath?[{value:'path',label:'Path text'}]:[])]}
        onChange={value=>onAction(()=>{layer.wrapWidth=value==='paragraph'?layer.width:undefined;})} />
      {layer.wrapWidth !== undefined && <>
        <NumberField label="Paragraph width" layout="stacked" value={layer.wrapWidth} min={1} max={Number.MAX_SAFE_INTEGER} step={1} suffix="px" disabled={disabled || !paragraphSupported}
          onPreview={value=>onPreview({type:'layer.update',id:layer.id,patch:{wrapWidth:value}})}
          onCommit={value=>onAction(()=>{layer.wrapWidth=value;})} />
        <p>Text wraps to the paragraph width. Long unbreakable text can extend beyond it. Corner handles adjust width and keep font size; height grows with the lines.</p>
      </>}
      {!paragraphSupported && <p role="status">This browser cannot wrap paragraph text. Use Point text or Reset paragraph, or open the project in a supporting browser.</p>}
      <Select label="Justification" layout="stacked" value={layer.paragraphJustify??'none'} disabled={disabled || !wordSpacingSupported || layer.wrapWidth===undefined}
        options={[{value:'none',label:'None'},{value:'inter-word',label:'Inter-word'}]}
        onChange={value=>onAction(()=>{layer.paragraphJustify=value as 'none'|'inter-word';})} />
      {layer.paragraphJustify==='inter-word' && <p>Wrapped lines expand native word spacing to the available width. Final lines, forced breaks and unbreakable text keep their spacing. Paragraph text mode is required. If native spacing cannot fit a line, choose Kerning Normal or Reset paragraph.</p>}
      {!wordSpacingSupported && <p>Paragraph justification requires native word spacing. Reset paragraph clears unsupported justification.</p>}
      <Slider label="Paragraph spacing" value={layer.paragraphSpacing??0} min={0} max={10000} step={1} suffix="px" disabled={disabled||!!layer.textPath}
        onPreview={value=>onPreview({type:'layer.update',id:layer.id,patch:{paragraphSpacing:value}})}
        onCommit={value=>onAction(()=>{layer.paragraphSpacing=value;})} />
      <Slider label="First-line indent" value={layer.firstLineIndent??0} min={-10000} max={10000} step={1} suffix="px" disabled={disabled||!!layer.textPath}
        onPreview={value=>onPreview({type:'layer.update',id:layer.id,patch:{firstLineIndent:value}})}
        onCommit={value=>onAction(()=>{layer.firstLineIndent=value;})} />
      <Button disabled={disabled||!!layer.textPath} onClick={()=>onAction(()=>layer.resetParagraph())}>Reset paragraph</Button>
      <Select
        label="Font"
        layout="stacked"
        value={layer.fontFamily}
        disabled={disabled}
        options={[...embeddedFonts.map(file=>({value:file.family,label:`${file.name} (embedded)`})),...families.filter(value=>!embeddedFonts.some(file=>file.family===value)).map(value=>({value,label:value}))]}
        onChange={(val) => {
          onAction(() => {
            layer.fontFamily = val;
          });
        }}
      />
      {canListFonts ? (
        <Button disabled={loadingFonts} onClick={() => void loadFonts()}>
          {loadingFonts ? "Reading system fonts…" : localFonts.length ? "Refresh system fonts" : "Access system fonts"}
        </Button>
      ) : (
        <p>This browser cannot list installed fonts. Enter a font family name below.</p>
      )}
      {fontMessage && <p role="status">{fontMessage}</p>}
      {embeddedFont?<p>Embedded font: {embeddedFont.name}</p>:<TextInput
        label="Font family"
        layout="stacked"
        value={layer.fontFamily}
        disabled={disabled}
        placeholder="Enter a local font family"
        onCommit={(value) =>
          onAction(() => {
            layer.fontFamily = value;
          })
        }
      />}
      {availability === "unavailable" && (
        <div className="font-fallback-warning" role="alert">
          Font &ldquo;{layer.fontFamily}&rdquo; could not be loaded locally. A
          fallback may be in use.
        </div>
      )}
      <Button
        disabled={disabled}
        onClick={() => onAction(() => layer.reflow())}
      >
        Reflow text
      </Button>
      <NumberField
        label="Font size"
        layout="stacked"
        value={layer.fontSize}
        min={1}
        max={Number.MAX_SAFE_INTEGER}
        step={1}
        suffix="px"
        disabled={disabled}
        onPreview={(value) =>
          onPreview({
            type: "layer.update",
            id: layer.id,
            patch: { fontSize: value },
          })
        }
        onCommit={(value) =>
          onAction(() => {
            layer.fontSize = value;
          })
        }
      />
      <ColorField
        label="Color"
        ariaLabel="Text color"
        value={layer.color}
        disabled={disabled}
        onChange={(val) => {
          onAction(() => {
            layer.color = val;
          });
        }}
      />
      <SegmentedControl
        label="Alignment"
        value={layer.align}
        disabled={disabled}
        options={[
          {
            value: "left",
            label: "Align left",
            icon: <AlignLeft size={16} />,
          },
          {
            value: "center",
            label: "Align center",
            icon: <AlignCenter size={16} />,
          },
          {
            value: "right",
            label: "Align right",
            icon: <AlignRight size={16} />,
          },
        ]}
        onChange={(val) => {
          onAction(() => {
            layer.align = val;
          });
        }}
      />
      <Select
        label="Weight"
        layout="stacked"
        value={layer.fontWeight ?? "normal"}
        disabled={disabled}
        options={[
          { value: "normal", label: "Normal (400)" },
          { value: "bold", label: "Bold (700)" },
          { value: "100", label: "Thin (100)" },
          { value: "200", label: "Extra Light (200)" },
          { value: "300", label: "Light (300)" },
          { value: "500", label: "Medium (500)" },
          { value: "600", label: "Semi Bold (600)" },
          { value: "800", label: "Extra Bold (800)" },
          { value: "900", label: "Black (900)" },
          ...(['normal','bold','100','200','300','500','600','800','900'].includes(weight)?[]:[{value:weight,label:`Custom (${weight})`}]),
        ]}
        onChange={(val) => {
          onAction(() => {
            layer.fontWeight = val;
          });
        }}
      />
      {hasNumericWeight?<NumberField label="Weight value" layout="stacked" value={numericWeight} min={1} max={1000} step={1} disabled={disabled}
        onPreview={value=>onPreview({type:'layer.update',id:layer.id,patch:{fontWeight:String(value)}})}
        onCommit={value=>onAction(()=>{layer.fontWeight=String(value);})}/>:<Button disabled={disabled} onClick={()=>onAction(()=>{layer.fontWeight='400';})}>Use numeric weight</Button>}
      <VariableFontAxes layer={layer} disabled={disabled} onAction={onAction} onPreview={onPreview}/>
      <Select label="Capitals" layout="stacked" value={layer.fontVariantCaps??'normal'} disabled={disabled||!capitalsSupported}
        options={[{value:'normal',label:'Normal'},{value:'small-caps',label:'Small capitals'},{value:'all-small-caps',label:'All small capitals'},{value:'petite-caps',label:'Petite capitals'},{value:'all-petite-caps',label:'All petite capitals'},{value:'unicase',label:'Unicase'},{value:'titling-caps',label:'Titling capitals'}]}
        onChange={value=>onAction(()=>{layer.fontVariantCaps=value as FontVariantCaps;})}/>
      <Select label="Font stretch" layout="stacked" value={layer.fontStretch??'normal'} disabled={disabled||!stretchSupported}
        options={FONT_STRETCHES.map(value=>({value,label:value.charAt(0).toUpperCase()+value.slice(1).replaceAll('-',' ')}))}
        onChange={value=>onAction(()=>{layer.fontStretch=value as FontStretch;})}/>
      <p>These settings select glyphs and font faces without changing the text. Available capitals, widths and intermediate weights depend on the font and browser; a closest face or synthesized capitals may be used. Font stretch does not scale artwork.</p>
      {(!capitalsSupported||!stretchSupported)&&<p role="status">This browser cannot control every native font feature. Reset font features restores normal capitals and stretch.</p>}
      <Button disabled={disabled} onClick={()=>onAction(()=>layer.resetFontFeatures())}>Reset font features</Button>
      <SegmentedControl
        label="Style"
        value={layer.fontStyle ?? "normal"}
        disabled={disabled}
        options={[
          { value: "normal", label: "Normal" },
          { value: "italic", label: "Italic" },
        ]}
        onChange={(val) => {
          onAction(() => {
            layer.fontStyle = val as "normal" | "italic";
          });
        }}
      />
      <Slider
        label="Line height"
        value={layer.lineHeight}
        min={0.5}
        max={3}
        step={0.05}
        suffix="x"
        disabled={disabled||!!layer.textPath}
        onPreview={(value) =>
          onPreview({
            type: "layer.update",
            id: layer.id,
            patch: { lineHeight: value },
          })
        }
        onCommit={(value) =>
          onAction(() => {
            layer.lineHeight = value;
          })
        }
      />
      <Slider
        label="Tracking"
        value={layer.letterSpacing ?? 0}
        min={-10}
        max={50}
        step={0.5}
        suffix="px"
        disabled={disabled}
        onPreview={(value) =>
          onPreview({
            type: "layer.update",
            id: layer.id,
            patch: { letterSpacing: value },
          })
        }
        onCommit={(value) =>
          onAction(() => {
            layer.letterSpacing = value;
          })
        }
      />
      <Select
        label="Kerning"
        value={layer.fontKerning ?? 'auto'}
        disabled={disabled || !kerningSupported}
        options={[{value:'auto',label:'Auto'},{value:'normal',label:'Normal'},{value:'none',label:'None'}]}
        onChange={value=>onAction(()=>{layer.fontKerning=value as 'auto'|'normal'|'none';})}
      />
      <Slider
        label="Word spacing"
        value={layer.wordSpacing ?? 0}
        min={-50} max={500} step={0.5} suffix="px"
        disabled={disabled || !wordSpacingSupported}
        onPreview={value=>onPreview({type:'layer.update',id:layer.id,patch:{wordSpacing:value}})}
        onCommit={value=>onAction(()=>{layer.wordSpacing=value;})}
      />
      {(!wordSpacingSupported || !kerningSupported) && <p role="status">This browser lacks {![wordSpacingSupported,kerningSupported].some(Boolean)?'native word spacing and kerning':!wordSpacingSupported?'native word spacing':'native kerning control'}. Nondefault unsupported text requires a supporting browser or Reset spacing.</p>}
      <Button disabled={disabled} onClick={()=>onAction(()=>layer.resetSpacing())}>Reset spacing</Button>
      <SegmentedControl
        label="Direction"
        value={layer.direction ?? "ltr"}
        disabled={disabled}
        options={[
          { value: "ltr", label: "LTR" },
          { value: "rtl", label: "RTL" },
        ]}
        onChange={(val) => {
          onAction(() => {
            layer.direction = val as "ltr" | "rtl";
          });
        }}
      />
    </InspectorSection>
  );
}

// Re-export alias for backwards compatibility
export const TextProperties = TypographyPanel;
