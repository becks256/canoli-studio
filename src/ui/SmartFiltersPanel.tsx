import { useEffect, useRef, useState } from "react";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import {
  GaussianBlurFilter,
  MedianFilter,
  BilateralDenoiseFilter,
  FrequencyBandFilter,
  NativeCompositionFilter,
  DocumentToneFilter,
  UnsharpMaskFilter,
  SmartToneFilter,
  SmartObjectLayer,
  type Document,
  type SmartFilter,
} from "../dom";
import type { SmartFilterData } from "../core/smart/filters";
import type { EditorCommand } from "../core/commands";
import { Button, IconButton, Select, Slider } from "./controls";
import { InspectorSection } from "./InspectorSection";
import "./SmartFiltersPanel.css";

const names = {
  'bilateral-denoise':'Bilateral denoise',
  median: 'Median denoise',
  "gaussian-blur": "Gaussian blur",
  "frequency-band": "Frequency band",
  "native-composition": "Native composition",
  "document-tone": "Document tone",
  "unsharp-mask": "Unsharp mask",
  tone: "Tone",
};
function construct(data: SmartFilterData): SmartFilter {
  switch (data.kind) {
    case 'bilateral-denoise': {
      const {kind:_,...options}=data;return new BilateralDenoiseFilter(options);
    }
    case 'median': {
      const {kind:_,...options}=data;
      return new MedianFilter(options);
    }
    case "document-tone": {
      const { kind: _, ...options } = data;
      return new DocumentToneFilter(options);
    }
    case "native-composition": {
      const { kind: _, ...options } = data;
      return new NativeCompositionFilter(options);
    }
    case "frequency-band": {
      const { kind: _, ...options } = data;
      return new FrequencyBandFilter(options);
    }
    case "gaussian-blur":
      return new GaussianBlurFilter(data);
    case "unsharp-mask":
      return new UnsharpMaskFilter(data);
    case "tone":
      return new SmartToneFilter(data);
  }
}
type Field = {
  key:
    "radius" | "colorSigma" | "sigma" | "amount" | "threshold" | "exposure" | "contrast" | "saturation";
  label: string;
  min: number;
  max: number;
  step: number;
  suffix?: string;
  scale?: "quadratic";
};
function fields(filter: SmartFilterData): Field[] {
  if(filter.kind==='bilateral-denoise')return [
    {key:'radius',label:'Denoise radius',min:0,max:16,step:1,suffix:'px'},
    {key:'colorSigma',label:'Color tolerance',min:0,max:255,step:.1},
    {key:'amount',label:'Denoise strength',min:0,max:1,step:.05},
  ];
  if (filter.kind === 'median') return [{key:'radius',label:'Denoise radius',min:0,max:32,step:1,suffix:'px'}];
  if(filter.kind === "native-composition") return [];
  if (filter.kind === "tone" || filter.kind === "document-tone")
    return [
      {
        key: "exposure",
        label: "Exposure",
        min: -3,
        max: 3,
        step: 0.1,
        suffix: "EV",
      },
      { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1 },
      { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1 },
    ];
  const radius: Field = {
    key: "sigma",
    label: filter.kind === "frequency-band" ? "Separation radius" : filter.kind === "gaussian-blur" ? "Blur size" : "Sharpen size",
    min: 0,
    max: 4096 / 3,
    step: 0.1,
    suffix: "px",
    scale: "quadratic",
  };
  return filter.kind === "gaussian-blur" || filter.kind === "frequency-band"
    ? [radius]
    : [
        radius,
        { key: "amount", label: "Amount", min: 0, max: 5, step: 0.05 },
        { key: "threshold", label: "Threshold", min: 0, max: 255, step: 1 },
      ];
}

export function SmartFiltersPanel({
  document,
  layer,
  value,
  sharedRadius,
  disabled,
  onPreview,
  onAttempt,
}: {
  document: Document;
  layer: SmartObjectLayer;
  value: readonly SmartFilterData[];
  sharedRadius?: number;
  disabled: boolean;
  onPreview(command: EditorCommand | null): void;
  onAttempt(action: () => void): void;
}) {
  const [kind, setKind] = useState<SmartFilterData["kind"]>("gaussian-blur");
  const revision = document.getSnapshot().revision;
  const previewRevision = useRef<number | null>(null);
  const cancel = useRef(onPreview);
  cancel.current = onPreview;
  // Selection/session changes and external document edits discard transient filter drafts.
  useEffect(() => () => cancel.current(null), [document, layer.id, revision]);
  const available = () =>
    !disabled &&
    document.selectedLayer?.id === layer.id &&
    document.getSnapshot().revision === revision &&
    layer.isAttached;
  const preview = (filters: SmartFilterData[]) => {
    if (
      !available() ||
      (previewRevision.current !== null && previewRevision.current !== revision)
    ) {
      onPreview(null);
      return;
    }
    const unchanged =
      JSON.stringify(filters) === JSON.stringify(layer.smartFilters);
    previewRevision.current = unchanged
      ? null
      : (previewRevision.current ?? revision);
    onPreview(
      unchanged ? null : { type: "smartObject.filters", id: layer.id, filters },
    );
  };
  const commit = (filters: SmartFilterData[]) => {
    const expectedRevision = previewRevision.current ?? revision;
    previewRevision.current = null;
    onPreview(null);
    onAttempt(() => {
      if (!available() || expectedRevision !== revision)
        throw new Error(
          "The filter target changed. Review the selected layer and retry.",
        );
      if (JSON.stringify(filters) !== JSON.stringify(layer.smartFilters))
        layer.setFilters(filters.map(construct));
    });
  };
  const update = (index: number, patch: Record<string, number | boolean>) =>
    value.map((filter, i) =>
      i === index ? ({ ...filter, ...patch } as SmartFilterData) : filter,
    );
  const move = (index: number, direction: number) => {
    const next = [...value];
    [next[index], next[index + direction]] = [
      next[index + direction],
      next[index],
    ];
    commit(next);
  };
  const add = () => {
    const filter =
      kind === 'bilateral-denoise' ? new BilateralDenoiseFilter() : kind === 'median' ? new MedianFilter() : kind === "document-tone" ? new DocumentToneFilter() : kind === "native-composition" ? new NativeCompositionFilter() : kind === "frequency-band" ? new FrequencyBandFilter() : kind === "gaussian-blur"
        ? new GaussianBlurFilter()
        : kind === "unsharp-mask"
          ? new UnsharpMaskFilter()
          : new SmartToneFilter();
    const next=[...value],boundary=next.findIndex(f=>f.kind==='document-tone');
    next.splice(kind==='document-tone'||boundary<0?next.length:boundary,0,filter.toJSON());commit(next);
  };
  return (
    <InspectorSection title="Smart filters" badge={value.length || undefined}>
      <p className="section-description">
        Filters run from top to bottom. Sizes follow the artwork when scaled;
        the original stays intact. Document tone runs after placement and before layer masks.
      </p>
      <div className="smart-filter-add">
        <Select
          label="Filter type"
          value={kind}
          disabled={disabled || value.length >= 32}
          options={Object.entries(names).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(value) => setKind(value as SmartFilterData["kind"])}
        />
        <Button
          size="sm"
          disabled={disabled || value.length >= 32}
          onClick={add}
        >
          Add filter
        </Button>
      </div>
      {value.length === 0 ? (
        <p className="section-description">No filters on this instance.</p>
      ) : (
        <ol className="smart-filter-list">
          {value.map((filter, index) => (
            <li key={filter.id}>
              <fieldset
                className="smart-filter-card"
                aria-label={`${names[filter.kind]} filter ${index + 1}`}
                disabled={disabled}
              >
                <div className="smart-filter-heading">
                  <strong>
                    <span className="smart-filter-index">{index + 1}</span>
                    {names[filter.kind]}
                  </strong>
                  <div className="smart-filter-actions">
                    <IconButton
                      label={`Move ${names[filter.kind]} earlier`}
                      disabled={disabled || index === 0 || (filter.kind==='document-tone')!==(value[index-1]?.kind==='document-tone')}
                      onClick={() => move(index, -1)}
                    >
                      <ArrowUp size={13} />
                    </IconButton>
                    <IconButton
                      label={`Move ${names[filter.kind]} later`}
                      disabled={disabled || index === value.length - 1 || (filter.kind==='document-tone')!==(value[index+1]?.kind==='document-tone')}
                      onClick={() => move(index, 1)}
                    >
                      <ArrowDown size={13} />
                    </IconButton>
                    <IconButton
                      label={`Remove ${names[filter.kind]} filter`}
                      disabled={disabled}
                      onClick={() =>
                        commit(value.filter((_, i) => i !== index))
                      }
                    >
                      <Trash2 size={13} />
                    </IconButton>
                  </div>
                </div>
                {filter.kind === "frequency-band" && <Select label="Frequency band" value={filter.band} disabled={disabled}
                  options={[{value:"low",label:"Low: color and tone"},{value:"high",label:"High: detail"},{value:"correction",label:"Precision correction"}]}
                  onChange={band => commit(value.map((f,i)=>i===index?{...filter,band:band as "low"|"high"|"correction"}:f))} />}
                <label className="check-field">
                  <input
                    type="checkbox"
                    aria-label={`Enable ${names[filter.kind]} filter ${index + 1}`}
                    checked={filter.enabled}
                    onChange={(event) =>
                      commit(update(index, { enabled: event.target.checked }))
                    }
                  />
                  Enabled
                </label>
                {filter.kind==='frequency-band'&&sharedRadius!==undefined&&<p className="section-description">Radius follows the shared frequency group controls.</p>}
                {filter.kind==='median'&&<p className="section-description">Removes isolated speckles. Larger radii can soften fine detail; transparency stays intact.</p>}
                {filter.kind==='bilateral-denoise'&&<p className="section-description">Smooths fine noise while retaining strong color edges. Larger settings can soften detail; transparency stays intact.</p>}
                {fields(filter).filter(field=>!(filter.kind==='frequency-band'&&sharedRadius!==undefined&&field.key==='sigma')).map((field) => (
                  <Slider
                    key={field.key}
                    label={field.label}
                    value={
                      (filter as unknown as Record<string, number>)[field.key]
                    }
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    integer={filter.kind === 'median' || (filter.kind==='bilateral-denoise'&&field.key==='radius')}
                    scale={field.scale}
                    suffix={field.suffix}
                    disabled={disabled || !filter.enabled}
                    onPreview={(value) =>
                      preview(update(index, { [field.key]: value }))
                    }
                    onCommit={(value) =>
                      commit(update(index, { [field.key]: value }))
                    }
                  />
                ))}
              </fieldset>
            </li>
          ))}
        </ol>
      )}
    </InspectorSection>
  );
}
