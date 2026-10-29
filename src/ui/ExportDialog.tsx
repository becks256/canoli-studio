import {iccTarget} from '../core/color/profile-source';
import type { ExportControl, ExportProgress } from "../engine/export-control";
import { exportFontFamilies, fontAvailability } from "./font-availability";
import { useState, useMemo, useEffect, useRef } from "react";
import { Dialog } from "./Dialog";
import { Button, IconButton, Select, Slider, ColorField, NumberField } from "./controls";
import { AlertTriangle, CheckCircle, Info, X } from "lucide-react";
import type { DocumentData } from "../core/model";
import type { ExportFormat, ExportOptions } from "../engine/export";
import { getExportCapabilityReport, getTiffPagesCapabilityReport } from "../engine/export";

export interface ExportPage {key:string;document:DocumentData}
export interface ExportDialogProps {
  color?:import('../core/color/color-settings').ColorOutput;
  pages?:readonly ExportPage[];
  document: DocumentData;
  onExport(options: ExportOptions, control?: ExportControl, pages?:readonly string[]): Promise<void>;
  onClose(): void;
  busy?: boolean;
}

export function ExportDialog({
  document,
  color,
  pages: suppliedPages,
  onExport,
  onClose,
  busy = false,
}: ExportDialogProps) {
  const [format, setFormat] = useState<ExportFormat>("png");
  const [psdMode, setPsdMode] = useState<"layers" | "flatten">("layers");
  const [tiffVariant,setTiffVariant]=useState<"auto"|"classic"|"big">("auto");
  const[tiffPrecision,setTiffPrecision]=useState<'uint8'|'uint16'|'float32'>('uint8');
  const[tiffUseOutputProfile,setTiffUseOutputProfile]=useState(!!color);
  const pages=suppliedPages??[{key:document.id,document}];
  const [tiffScope,setTiffScope]=useState('current');
  const [pageKeys,setPageKeys]=useState(()=>pages.map(page=>page.key));
  const pageMap=new Map(pages.map(page=>[page.key,page]));
  const multiPage=format==='tiff'&&tiffScope==='pages';
  const selectedPages=pageKeys.map(key=>pageMap.get(key));
  const invalidPages=multiPage&&(!pageKeys.length||selectedPages.some(page=>!page));
  const movePage=(index:number,delta:number)=>setPageKeys(keys=>{const result=[...keys];[result[index],result[index+delta]]=[result[index+delta],result[index]];return result;});
  const [pdfDpi,setPdfDpi]=useState(72);
  const [quality, setQuality] = useState(90);
  const [avifQuality,setAvifQuality]=useState(80),[avifLossless,setAvifLossless]=useState(false),[avifSpeed,setAvifSpeed]=useState(8);
  const [backgroundColor, setBackgroundColor] = useState("#ffffff");
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState<ExportProgress | null>(null);
  const controller = useRef<AbortController | null>(null);
  useEffect(() => () => controller.current?.abort(), []);
  const dismiss = () => { controller.current?.abort(); onClose(); };
  const fontKey = JSON.stringify([...new Set((multiPage?selectedPages.filter((page):page is ExportPage=>!!page).map(page=>page.document):[document]).flatMap(page=>exportFontFamilies(page)))]);
  const [fontReport, setFontReport] = useState<{
    key: string;
    warnings: string[];
  } | null>(null);
  const [fontRevision, setFontRevision] = useState(0);
  useEffect(() => {
    const changed = () => setFontRevision((value) => value + 1);
    globalThis.document.fonts?.addEventListener("loadingdone", changed);
    globalThis.document.fonts?.addEventListener("loadingerror", changed);
    return () => {
      globalThis.document.fonts?.removeEventListener("loadingdone", changed);
      globalThis.document.fonts?.removeEventListener("loadingerror", changed);
    };
  }, []);
  const reportKey = `${fontRevision}:${fontKey}`;
  const checkingFonts = fontReport?.key !== reportKey;
  useEffect(() => {
    let cancelled = false;
    const families = JSON.parse(fontKey) as string[];
    void Promise.all(
      families.map(async (family) => ({
        family,
        status: await fontAvailability(family),
      })),
    ).then((results) => {
      if (cancelled) return;
      setFontReport({
        key: reportKey,
        warnings: results
          .filter((item) => item.status !== "available")
          .map((item) =>
            item.status === "unavailable"
              ? `Font “${item.family}” could not be loaded locally; exported text may use a fallback.`
              : `Font availability could not be verified for “${item.family}”.`,
          ),
      });
    });
    return () => {
      cancelled = true;
    };
  }, [fontKey, reportKey]);

  const deliveryColor=useMemo<ExportDialogProps['color']>(()=>{
    if(!['png','tiff','pdf'].includes(format))return undefined;
    if(format==='tiff'&&tiffPrecision!=='uint8')return tiffUseOutputProfile?(color??{profile:'srgb',intent:'relative-colorimetric',blackPointCompensation:false}):undefined;
    return color;
  },[format,tiffPrecision,tiffUseOutputProfile,color]);
  const nativeTiffProfile=format==='tiff'&&tiffPrecision!=='uint8'&&!deliveryColor;
  const report = useMemo(() => {
    if(multiPage&&selectedPages.length&&!selectedPages.some(page=>!page))return getTiffPagesCapabilityReport(selectedPages.map(page=>page!.document),tiffVariant,deliveryColor,tiffPrecision);
    return getExportCapabilityReport(document, {
      format,
      color:deliveryColor,
      quality: (format==='avif'?avifQuality:quality) / 100,
      avifLossless,avifSpeed,
      backgroundColor,
      psdMode,
      tiffVariant,
      tiffPrecision:format==='tiff'?tiffPrecision:undefined,
      pdfDpi,
    });
  }, [document, deliveryColor, format, quality, backgroundColor, psdMode,tiffVariant,tiffPrecision,pdfDpi,avifQuality,avifLossless,avifSpeed,multiPage,pages,pageKeys]);

  const handleExport = async () => {
    const run = new AbortController();
    controller.current = run;
    setProgress(null);
    setExporting(true);
    try {
      await onExport({
        format,
        color:deliveryColor,
        quality: (format==='avif'?avifQuality:quality) / 100,
        avifLossless,avifSpeed,
        backgroundColor,
        psdMode,
        tiffVariant,
        tiffPrecision:format==='tiff'?tiffPrecision:undefined,
        pdfDpi,
      }, {signal:run.signal,onProgress:setProgress},multiPage?[...pageKeys]:undefined);
      if (!run.signal.aborted) onClose();
    } finally {
      controller.current = null;
      setExporting(false);
    }
  };

  const extension = format === "jpeg" ? "jpg" : format==='tiff'?'tif':format;

  return (
    <Dialog
      titleId="export-dialog-title"
      onClose={dismiss}
      className="export-dialog"
    >
      <div className="dialog-header">
        <h2 id="export-dialog-title">Export Document</h2>
        <IconButton
          label="Close"
          onClick={dismiss}
          disabled={busy && !exporting}
        >
          <X size={18} />
        </IconButton>
      </div>

      <div className="dialog-body export-dialog-body">
        <Select
          label="Format"
          layout="stacked"
          value={format}
          disabled={busy || exporting}
          options={[
            { value: "png", label: "PNG — Lossless raster with transparency" },
            {
              value: "jpeg",
              label: "JPEG — High compression photo (flattened background)",
            },
            { value: "webp", label: "WebP — Modern efficient web image" },
            {value:'avif',label:'AVIF — Compressed sRGB image with transparency'},
            { value: "tiff", label: "TIFF — Lossless raster with transparency and ICC profile" },
            { value: "pdf", label: "PDF — Native-resolution raster page with transparency" },
            { value: "svg", label: "SVG — Scalable Bézier vector paths" },
            {
              value: "psd",
              label:
                "PSD — Adobe Photoshop layered interchange with ICC profile",
            },
            {value:'psb',label:'PSB — Photoshop large document, layers and folders'},
          ]}
          onChange={(val) => setFormat(val as ExportFormat)}
        />

        <p>{deliveryColor?`RGB output: ${iccTarget(deliveryColor.profile).name}. Pixel conversion and original ICC profile embedding; canvas proofing is excluded.`:nativeTiffProfile?'RGB output: Linear sRGB. Native working colors and the linear profile are retained; canvas proofing is excluded.':'Output uses sRGB. Custom ICC delivery currently supports PNG, TIFF and PDF.'}</p>

        {(format === "psd"||format==='psb') && <Select label={format==='psb'?'PSB layers':'PSD layers'} layout="stacked" value={psdMode} disabled={busy || exporting}
          options={[{ value: "layers", label: "Keep independent layers; merge dependent effects" }, { value: "flatten", label: "Flatten visible composition into one layer" }]}
          onChange={value => setPsdMode(value as "layers" | "flatten")} />}

        {format==='tiff'&&<Select label="TIFF compatibility" layout="stacked" value={tiffVariant} disabled={busy||exporting}
          options={[{value:'auto',label:'Automatic — TIFF or BigTIFF as needed'},{value:'classic',label:'Classic TIFF — widest compatibility'},{value:'big',label:'BigTIFF — requires a compatible viewer'}]}
          onChange={value=>setTiffVariant(value as 'auto'|'classic'|'big')} />}
        {format==='tiff'&&<Select label="TIFF precision" layout="stacked" value={tiffPrecision} disabled={busy||exporting} options={[{value:'uint8',label:'8-bit integer'},{value:'uint16',label:'16-bit integer — requires a float document'},{value:'float32',label:'32-bit float — requires a float document'}]} onChange={value=>setTiffPrecision(value as typeof tiffPrecision)}/>}
        {format==='tiff'&&tiffPrecision!=='uint8'&&<div>
          <label className="checkbox-control"><input type="checkbox" checked={tiffUseOutputProfile} disabled={busy||exporting} onChange={event=>setTiffUseOutputProfile(event.target.checked)}/>Use output RGB profile for high-precision TIFF</label>
          <p>{tiffUseOutputProfile?`Convert to ${iccTarget(color?.profile??'srgb').name} using the output settings. The selected profile may map extended colors.`:'Keep linear sRGB working colors. Enable conversion to use the output profile from Color Settings.'}</p>
        </div>}

        {format==='tiff'&&<>
          <Select label="TIFF pages" layout="stacked" value={tiffScope} disabled={busy||exporting}
            options={[{value:'current',label:'Current document'},{value:'pages',label:'Selected open documents'}]} onChange={setTiffScope}/>
          {multiPage&&<section className="tiff-page-selection" aria-label="TIFF page order">
            <p>Choose documents and arrange their page order. Each page keeps its own native dimensions. Pages are flattened; save projects or a workspace to keep editable artwork.</p>
            <ol>{[...pageKeys,...pages.filter(page=>!pageKeys.includes(page.key)).map(page=>page.key)].map(key=>{
              const page=pageMap.get(key),index=pageKeys.indexOf(key),included=index>=0,openIndex=pages.findIndex(page=>page.key===key);
              return <li key={key}>
                <label className="checkbox-field"><input type="checkbox" checked={included} disabled={busy||exporting||!page} aria-label={`Include ${page?.document.name??'closed document'} (open document ${openIndex+1}) as TIFF page`}
                  onChange={event=>{const checked=event.target.checked;setPageKeys(keys=>checked?[...keys,key]:keys.filter(value=>value!==key));}}/>
                  <span>{included?`Page ${index+1}: `:''}{page?.document.name??'Closed document — remove this page'}{page&&<small>{page.document.width} × {page.document.height} px</small>}</span></label>
                {included&&<div className="tiff-page-actions">
                  <Button variant="subtle" aria-label={`Move TIFF page ${index+1} up`} disabled={busy||exporting||index===0} onClick={()=>movePage(index,-1)}>Up</Button>
                  <Button variant="subtle" aria-label={`Move TIFF page ${index+1} down`} disabled={busy||exporting||index===pageKeys.length-1} onClick={()=>movePage(index,1)}>Down</Button>
                  <Button variant="subtle" aria-label={`Remove TIFF page ${index+1}`} disabled={busy||exporting} onClick={()=>setPageKeys(keys=>keys.filter(value=>value!==key))}>Remove</Button>
                </div>}
              </li>;
            })}</ol>
            {invalidPages&&<p role="alert">Choose at least one page and remove any closed documents before exporting.</p>}
          </section>}
        </>}

        {format==='pdf'&&<div>
          <NumberField label="PDF resolution" value={pdfDpi} min={1} max={1000000} suffix="DPI" disabled={busy||exporting} onChange={setPdfDpi}/>
          <p>Physical page size: {(document.width/pdfDpi).toFixed(3)} × {(document.height/pdfDpi).toFixed(3)} inches. Native pixels stay unchanged.</p>
        </div>}

        {format==='avif'&&<>
          <label className="checkbox-field"><input type="checkbox" checked={avifLossless} disabled={busy||exporting} onChange={event=>setAvifLossless(event.target.checked)}/>Lossless AVIF</label>
          {!avifLossless&&<Slider label="AVIF quality" value={avifQuality} min={1} max={100} suffix="%" disabled={busy||exporting} onPreview={setAvifQuality} onCommit={setAvifQuality}/>}
          <Select label="AVIF compression" layout="stacked" value={String(avifSpeed)} disabled={busy||exporting} options={[{value:'8',label:'Fast'},{value:'6',label:'Balanced'},{value:'4',label:'Smaller file — takes longer'}]} onChange={value=>setAvifSpeed(Number(value))}/>
          <p>Transparency is always lossless. Quality 100 also preserves colour losslessly.</p>
        </>}

        <div className="export-dimension-info">
          <span>
            {multiPage?`Pages: ${pageKeys.length} · independent native dimensions`:`Resolution: ${document.width} × ${document.height} px`}
          </span>
          <span>Target: .{extension}</span>
        </div>

        {format === "jpeg" && (
          <>
            <ColorField
              label="Background color (replaces alpha)"
              ariaLabel="JPEG background color"
              value={backgroundColor}
              disabled={busy || exporting}
              onChange={setBackgroundColor}
            />
            <Slider
              label="Quality"
              value={quality}
              min={1}
              max={100}
              suffix="%"
              disabled={busy || exporting}
              onPreview={setQuality}
              onCommit={setQuality}
            />
          </>
        )}

        {format === "webp" && (
          <Slider
            label="Quality"
            value={quality}
            min={1}
            max={100}
            suffix="%"
            disabled={busy || exporting}
            onPreview={setQuality}
            onCommit={setQuality}
          />
        )}

        {checkingFonts && <p role="status">Checking font availability…</p>}
        {!checkingFonts && fontReport.warnings.length > 0 && (
          <div className="export-warnings" role="alert">
            {fontReport.warnings.map((warning) => (
              <div className="export-warning-item" key={warning}>
                <AlertTriangle size={15} />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}
        {report.warnings.length > 0 && (
          <div className="export-warnings" role="alert">
            {report.warnings.map((warning, index) => (
              <div key={index} className="export-warning-item">
                <AlertTriangle size={15} className="export-warning-icon" />
                <span>{warning}</span>
              </div>
            ))}
          </div>
        )}

        <div className="export-capabilities-grid">
          <div>
            <strong className="export-capability-heading preserved">
              <CheckCircle size={13} /> Preserved Features
            </strong>
            <ul className="export-capability-list">
              {report.featuresPreserved.map((feature, i) => (
                <li key={i}>{feature}</li>
              ))}
            </ul>
          </div>
          <div>
            <strong className="export-capability-heading degraded">
              <Info size={13} /> Degraded / Omitted
            </strong>
            {report.featuresDegradedOrOmitted.length === 0 ? (
              <span className="export-capability-empty">None</span>
            ) : (
              <ul className="export-capability-list muted">
                {report.featuresDegradedOrOmitted.map((feature, i) => (
                  <li key={i}>{feature}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>

      {exporting && <div className="export-progress" role="status" aria-live="polite">
        <span>{progress?.phase === 'encoding' ? 'Encoding file…' : 'Rendering image…'}</span>
        <progress aria-label="Export progress" max={1} value={progress?.fraction ?? undefined} />
      </div>}
      <div className="dialog-footer export-dialog-footer">
        <Button
          variant="secondary"
          onClick={() => exporting ? controller.current?.abort() : onClose()}
          disabled={busy && !exporting}
        >
          Cancel
        </Button>
        <Button
          variant="primary"
          onClick={handleExport}
          disabled={busy || exporting || checkingFonts || invalidPages || !!report.unavailableReason}
        >
          {exporting ? "Exporting..." : `Export .${extension}`}
        </Button>
      </div>
    </Dialog>
  );
}
