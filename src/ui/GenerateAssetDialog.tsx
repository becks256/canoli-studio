import { CanvasRenderer } from "../engine/renderer";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { Dialog } from "./Dialog";
import { Button, IconButton, NumberField, Select, TextArea } from "./controls";
import {
  AlertCircle,
  Coins,
  Eye,
  Layers,
  Loader2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import type { EditorApplication } from "../editor";
import type { GenerationCandidate } from "../ai/jobs/types";
import { RevisionConflictError } from "../ai/jobs/types";
import type {
  GenerationModality,
  GenerationRequest,
  ProviderCapabilities,
} from "../ai/providers/types";
import { GenerationRecoveryPanel } from "./GenerationRecoveryPanel";
import { ResultDiffInspector } from "./ResultDiffInspector";
import { rasterizeSelection } from "../ai/diff/engine";

export interface GenerateAssetDialogProps {
  editor: EditorApplication;
  onClose(): void;
  onPreviewCandidate?(candidate: GenerationCandidate | null): void;
  initialModality?: "text-to-image" | "cutout" | "texture" | "masked-edit";
}

export async function captureReferenceSnapshot(
  editor: EditorApplication,
  targetWidth: number,
  targetHeight: number,
): Promise<{ data: Uint8Array; thumbnail: string }> {
  const renderer = new CanvasRenderer();
  let rendered: HTMLCanvasElement | undefined;
  try {
    const snapshot = editor.document.toJSON();
    rendered = await renderer.render(snapshot, editor.assetStore, {
      region: { x: 0, y: 0, width: snapshot.width, height: snapshot.height },
      maxPixels: snapshot.width * snapshot.height,
      maxDimension: Math.max(snapshot.width, snapshot.height),
      cache: false,
      readback: true,
    });
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    try {
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Cannot capture document pixels.");
      ctx.drawImage(rendered, 0, 0, targetWidth, targetHeight);
      return {
        data: new Uint8Array(
          ctx.getImageData(0, 0, targetWidth, targetHeight).data,
        ),
        thumbnail: canvas.toDataURL("image/png"),
      };
    } finally {
      canvas.width = canvas.height = 0;
    }
  } finally {
    if (rendered) rendered.width = rendered.height = 0;
    renderer.dispose();
  }
}

interface DimensionPreset {
  label: string;
  width: number;
  height: number;
  aspectRatio: string;
}

const DIMENSION_PRESETS: DimensionPreset[] = [
  { label: "Square (1:1)", width: 1024, height: 1024, aspectRatio: "1:1" },
  { label: "Landscape (16:9)", width: 1344, height: 768, aspectRatio: "16:9" },
  { label: "Portrait (9:16)", width: 768, height: 1344, aspectRatio: "9:16" },
  { label: "Standard (4:3)", width: 1152, height: 864, aspectRatio: "4:3" },
  { label: "Wide (21:9)", width: 1536, height: 640, aspectRatio: "21:9" },
];

export function GenerateAssetDialog({
  editor,
  onClose,
  onPreviewCandidate,
  initialModality,
}: GenerateAssetDialogProps) {
  const dialogId = useId();

  // Active selection detection
  const hasActiveSelection = useMemo(() => {
    return (
      !!editor.document.selection &&
      editor.document.selection.regions.length > 0
    );
  }, [editor]);

  // Form State
  const initialIsMaskedEdit =
    (initialModality ??
      (hasActiveSelection ? "masked-edit" : "text-to-image")) === "masked-edit";
  const [prompt, setPrompt] = useState("");
  const [modality, setModality] = useState<
    "text-to-image" | "cutout" | "texture" | "masked-edit"
  >(initialModality ?? (hasActiveSelection ? "masked-edit" : "text-to-image"));
  const [requireAlpha, setRequireAlpha] = useState(false);
  const [overrideApproval, setOverrideApproval] = useState<{
    candidateId: string;
    report: GenerationCandidate["diffReport"];
  } | null>(null);
  const [width, setWidth] = useState(
    initialIsMaskedEdit ? editor.document.width : 1024,
  );
  const [height, setHeight] = useState(
    initialIsMaskedEdit ? editor.document.height : 1024,
  );
  const [qualityTier, setQualityTier] = useState<"standard" | "hd">("standard");
  const [providerId, setProviderId] = useState("flux-1-pro");
  const [consentApproved, setConsentApproved] = useState(true);
  const approverId = "artist";

  // Job & Execution State
  const [isGenerating, setIsGenerating] = useState(false);
  const [jobState, setJobState] = useState<string | null>(null);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [billingPending, setBillingPending] = useState(false);
  useEffect(() => {
    const job = activeJobId ? editor.ai.getJob(activeJobId) : undefined;
    const refresh = () => setBillingPending(job?.billingState === "pending");
    refresh();
    return job?.subscribe(refresh);
  }, [editor, activeJobId]);
  const [jobProgress, setJobProgress] = useState(0);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [accountingReady, setAccountingReady] = useState(false);
  const [accountingRevision, setAccountingRevision] = useState(0);
  const refreshAccounting = useCallback(
    () => setAccountingRevision((value) => value + 1),
    [],
  );
  useEffect(() => {
    let active = true;
    void editor.ai.recoveredAccounting().then(
      () => {
        if (active) setAccountingReady(true);
      },
      (error) => {
        if (active)
          setErrorMessage(
            `Cannot recover generation accounting: ${String(error)}`,
          );
      },
    );
    return () => {
      active = false;
    };
  }, [editor]);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const elapsedTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Candidate Shelf State
  const [candidates, setCandidates] = useState<GenerationCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(
    null,
  );
  const [showCheckerboard, setShowCheckerboard] = useState(true);
  const [previewingOnCanvas, setPreviewingOnCanvas] = useState(false);
  const [revisionConflict, setRevisionConflict] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void editor.ai.restoreCandidates().then(
      (saved) => {
        if (!active) return;
        setCandidates((previous) => [
          ...new Map(
            [...saved, ...previous].map((candidate) => [
              candidate.id,
              candidate,
            ]),
          ).values(),
        ]);
        setSelectedCandidateId((previous) => previous ?? saved[0]?.id ?? null);
      },
      (error) => {
        if (active)
          setErrorMessage(`Cannot recover saved candidates: ${String(error)}`);
      },
    );
    return () => {
      active = false;
    };
  }, [editor]);

  // Available Providers
  const providers = useMemo<ProviderCapabilities[]>(() => {
    return editor.ai.providerRegistry.listProviders();
  }, [editor]);

  // Selected Provider Profile
  const selectedProvider = useMemo(() => {
    try {
      return editor.ai.providerRegistry.getProvider(providerId);
    } catch {
      return providers[0];
    }
  }, [editor, providerId, providers]);

  // Modality change helper
  const handleModalityChange = (
    newModality: "text-to-image" | "cutout" | "texture" | "masked-edit",
  ) => {
    setModality(newModality);
    if (newModality === "cutout") {
      setRequireAlpha(true);
    } else if (newModality === "texture" || newModality === "masked-edit") {
      setRequireAlpha(false);
    }
    if (newModality === "masked-edit") {
      setWidth(editor.document.width);
      setHeight(editor.document.height);
    }
  };

  // Estimated Cost Calculation
  const estimatedCostCents = useMemo(() => {
    try {
      const req: GenerationRequest = {
        prompt: prompt.trim() || "preview",
        modality: modality === "masked-edit" ? "masked-edit" : "text-to-image",
        targetWidth: width,
        targetHeight: height,
        requireAlpha,
        qualityTier,
      };
      return editor.ai.providerRegistry.estimateGenerationCost(providerId, req);
    } catch {
      return 0;
    }
  }, [
    editor,
    prompt,
    width,
    height,
    requireAlpha,
    qualityTier,
    providerId,
    modality,
  ]);

  // Available Budget
  const availableBudgetCents = useMemo(() => {
    return editor.ai.budgetLedger.getAvailableCeiling("default-budget");
  }, [
    editor,
    isGenerating,
    candidates,
    accountingReady,
    billingPending,
    accountingRevision,
  ]);

  // Provider configuration check
  const isProviderConfigured = useMemo(() => {
    return editor.ai.providerRegistry.hasAdapter(providerId);
  }, [editor, providerId]);

  // Timer effect for elapsed seconds
  useEffect(() => {
    if (isGenerating) {
      setElapsedSeconds(0);
      const timer = setInterval(() => {
        setElapsedSeconds((s) => s + 0.1);
      }, 100);
      elapsedTimer.current = timer;
      return () => clearInterval(timer);
    } else {
      if (elapsedTimer.current) clearInterval(elapsedTimer.current);
    }
  }, [isGenerating]);

  // Ensure canvas preview is cleared when dialog unmounts
  useEffect(() => {
    return () => {
      onPreviewCandidate?.(null);
    };
  }, [onPreviewCandidate]);

  // Currently inspected candidate
  const currentCandidate = useMemo(() => {
    if (!selectedCandidateId) return candidates[0] || null;
    return (
      candidates.find((c) => c.id === selectedCandidateId) ||
      candidates[0] ||
      null
    );
  }, [candidates, selectedCandidateId]);

  const referencePreview = useMemo(() => {
    if (!currentCandidate) return {};
    try {
      return {
        thumbnail: editor.ai.staging.getReferenceThumbnail(currentCandidate.id),
      };
    } catch (error) {
      return { error: String(error) };
    }
  }, [editor, currentCandidate]);

  const overrideViolation = Boolean(
    currentCandidate &&
    overrideApproval?.candidateId === currentCandidate.id &&
    overrideApproval.report === currentCandidate.diffReport,
  );
  useEffect(() => {
    setOverrideApproval(null);
  }, [currentCandidate?.id]);

  // Handle preset selection
  const handlePresetSelect = (preset: DimensionPreset) => {
    setWidth(preset.width);
    setHeight(preset.height);
  };

  // Submit Generation Job
  const handleGenerate = async () => {
    if (!prompt.trim()) {
      setErrorMessage("Please enter a prompt to generate an asset.");
      return;
    }

    if (!consentApproved) {
      setErrorMessage(
        "Explicit consent is required to authorize the budget reservation.",
      );
      return;
    }

    if (!isProviderConfigured) {
      setErrorMessage(
        `Provider "${selectedProvider?.name ?? providerId}" is unconfigured. Live external model inference is disabled in this environment.`,
      );
      return;
    }

    setErrorMessage(null);
    setRevisionConflict(null);
    setIsGenerating(true);
    setJobState("estimating");

    try {
      // Ensure budget ledger has consent
      await editor.ai.setBudgetConsent("default-budget", true, approverId);

      let reqModality: GenerationModality = "text-to-image";
      let referenceImage: GenerationRequest["referenceImage"] = undefined;
      let mask: GenerationRequest["mask"] = undefined;
      let protectedMask: GenerationRequest["protectedMask"] = undefined;

      const owner = editor.document;
      const baseRevision = owner.getSnapshot().revision;
      if (modality === "masked-edit") {
        if (width !== owner.width || height !== owner.height)
          throw new Error("Masked edits must use the document dimensions.");
        reqModality = "masked-edit";
        const snap = await captureReferenceSnapshot(editor, width, height);
        if (
          editor.document !== owner ||
          owner.getSnapshot().revision !== baseRevision
        )
          throw new Error(
            "Document changed while capturing the edit reference. Please retry.",
          );
        referenceImage = {
          width,
          height,
          data: snap.data,
          mimeType: "image/png",
        };

        const selection = editor.document.selection?.toJSON();
        if (selection && selection.regions.length > 0) {
          const editCoverage = rasterizeSelection(selection, width, height);
          mask = { width, height, coverage: editCoverage };
          const pCoverage = new Uint8Array(width * height);
          for (let i = 0; i < width * height; i++) {
            if (editCoverage[i] === 0) pCoverage[i] = 255;
          }
          protectedMask = { width, height, coverage: pCoverage };
        }
      }

      const request: GenerationRequest = {
        prompt: prompt.trim(),
        modality: reqModality,
        targetWidth: width,
        targetHeight: height,
        requireAlpha,
        qualityTier,
        referenceImage,
        mask,
        protectedMask,
      };

      const job = await editor.ai.submit(request, {
        budgetId: "default-budget",
        baseRevision,
        sourceDocumentId: owner.id,
        providerId,
      });

      setActiveJobId(job.id);
      setJobState(job.state);

      const unsub = job.subscribe((updated) => {
        setJobState(updated.state);
        setJobProgress(updated.progress.percent);
      });

      try {
        const candidate = await job.result();
        setCandidates((prev) => [candidate, ...prev]);
        setSelectedCandidateId(candidate.id);
        setIsGenerating(false);
        setJobState("succeeded");
      } finally {
        unsub();
      }
    } catch (err: unknown) {
      setIsGenerating(false);
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
      setJobState("failed");
      // Preserve review access to charged output if its recovery write failed.
      const available = editor.ai.staging
        .listCandidates()
        .filter((candidate) => candidate.validation.valid);
      setCandidates(available);
      setSelectedCandidateId(
        (previous) => previous ?? available[0]?.id ?? null,
      );
    }
  };

  // Cancel running job
  const handleCancelJob = () => {
    if (activeJobId) {
      editor.ai.cancel(activeJobId);
      setJobState("cancelling");
    }
  };

  const [checkingPlacement, setCheckingPlacement] = useState(false);
  const handleCheckPlacement = async (candidate: GenerationCandidate) => {
    setCheckingPlacement(true);
    setErrorMessage(null);
    setOverrideApproval(null);
    const document = editor.document;
    try {
      await editor.ai.previewCandidate(candidate.id, {
        document,
        assetStore: editor.assetStore,
        expectedRevision: document.getSnapshot().revision,
        allowStaleRevision: true,
        maskSelection:
          modality === "masked-edit" ? document.selection?.toJSON() : undefined,
        width: candidate.width,
        height: candidate.height,
        ...(modality === "masked-edit" ? { x: 0, y: 0 } : {}),
      });
      setCandidates((previous) => [...previous]);
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setCheckingPlacement(false);
    }
  };

  // Apply candidate to document as RasterLayer
  const handleApplyCandidate = async (
    candidate: GenerationCandidate,
    forceLatestRevision = false,
  ) => {
    try {
      setErrorMessage(null);
      setRevisionConflict(null);

      // Invariant check: if violations exist and user hasn't checked override
      if (
        candidate.diffReport &&
        !candidate.diffReport.passed &&
        !overrideViolation
      ) {
        setErrorMessage(
          "Protected region invariant violated. Please review and check 'Acknowledge violation and authorize override' before applying.",
        );
        return;
      }

      const record = editor.ai.getRecord(candidate.jobId);
      const expectedRevision = forceLatestRevision
        ? editor.document.getSnapshot().revision
        : (record?.baseRevision ?? editor.document.getSnapshot().revision);

      const defaultName = record
        ? `${record.prompt.slice(0, 24)} (AI)`
        : `Generated ${candidate.id.slice(0, 6)}`;

      await editor.applyGeneratedCandidate(candidate.id, {
        expectedRevision,
        allowStaleRevision: forceLatestRevision,
        allowViolationOverride:
          overrideViolation && overrideApproval?.candidateId === candidate.id,
        maskSelection:
          modality === "masked-edit" && editor.document.selection
            ? editor.document.selection.toJSON()
            : undefined,
        layerName: defaultName,
        width: candidate.width,
        height: candidate.height,
        ...(modality === "masked-edit" ? { x: 0, y: 0 } : {}),
      });

      // Clear preview and close dialog
      onPreviewCandidate?.(null);
      onClose();
    } catch (err: unknown) {
      if (err instanceof RevisionConflictError) {
        setRevisionConflict(
          `Placement needs review (${err.message}). Click "Apply to Current Canvas" to place anyway.`,
        );
      } else {
        setErrorMessage(err instanceof Error ? err.message : String(err));
      }
    }
  };

  // Toggle canvas preview for candidate
  const handleToggleCanvasPreview = (candidate: GenerationCandidate | null) => {
    if (previewingOnCanvas) {
      setPreviewingOnCanvas(false);
      onPreviewCandidate?.(null);
    } else {
      setPreviewingOnCanvas(true);
      onPreviewCandidate?.(candidate);
    }
  };

  // Discard a candidate from shelf
  const handleDiscardCandidate = async (candidateId: string) => {
    try {
      await editor.ai.discardCandidate(candidateId);
    } catch (error) {
      setErrorMessage(`Cannot discard saved candidate: ${String(error)}`);
      return;
    }
    setCandidates((prev) => prev.filter((c) => c.id !== candidateId));
    if (selectedCandidateId === candidateId) {
      setSelectedCandidateId(null);
    }
    if (previewingOnCanvas) {
      setPreviewingOnCanvas(false);
      onPreviewCandidate?.(null);
    }
  };

  return (
    <Dialog
      titleId={`${dialogId}-title`}
      className="generate-asset-dialog"
      onClose={onClose}
    >
      <div className="dialog-heading">
        <div>
          <span className="section-caption">GENERATIVE STUDIO</span>
          <h2 id={`${dialogId}-title`}>Generate asset as layer</h2>
        </div>
        <IconButton label="Close (Escape)" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      <div className="generate-dialog-body">
        {/* Left Column: Configuration Form */}
        <div className="generate-config-col">
          {/* Prompt Section */}
          <div className="generate-section">
            <label className="generate-label" htmlFor={`${dialogId}-prompt`}>
              Prompt
            </label>
            <TextArea
              className="prompt-textarea"
              label="Prompt"
              hideLabel
              placeholder="e.g. A lush tropical fern leaf with delicate veins, botanic illustration, studio lighting..."
              value={prompt}
              onChange={setPrompt}
              disabled={isGenerating}
              rows={3}
            />
            <div className="generate-meta-row">
              <span className="char-count">{prompt.length} / 1000</span>
            </div>
          </div>

          {/* Modality & Alpha Selector */}
          <div className="generate-section">
            <span className="generate-label">Modality & Transparency</span>
            <div
              className="modality-pills"
              role="radiogroup"
              aria-label="Asset modality"
            >
              <button
                type="button"
                className={`modality-pill ${modality === "text-to-image" ? "active" : ""}`}
                onClick={() => handleModalityChange("text-to-image")}
                disabled={isGenerating}
              >
                Artwork / Scene
              </button>
              <button
                type="button"
                className={`modality-pill ${modality === "cutout" ? "active" : ""}`}
                onClick={() => handleModalityChange("cutout")}
                disabled={isGenerating}
              >
                Cutout Object
              </button>
              <button
                type="button"
                className={`modality-pill ${modality === "texture" ? "active" : ""}`}
                onClick={() => handleModalityChange("texture")}
                disabled={isGenerating}
              >
                Texture
              </button>
              <button
                type="button"
                className={`modality-pill ${modality === "masked-edit" ? "active" : ""}`}
                onClick={() => handleModalityChange("masked-edit")}
                disabled={isGenerating}
              >
                Generative Fill
              </button>
            </div>

            {modality === "masked-edit" && (
              <span
                className="generate-subnote"
                style={{ color: "var(--color-accent)" }}
              >
                Protected masked edit: Generates content inside selection mask
                while strictly preserving unmasked content (Δ = 0).
              </span>
            )}

            <label className="generate-checkbox-label">
              <input
                type="checkbox"
                checked={requireAlpha}
                onChange={(e) => setRequireAlpha(e.target.checked)}
                disabled={isGenerating}
              />
              <span>Require alpha transparency (isolated cutout)</span>
            </label>
            {requireAlpha &&
              selectedProvider?.alpha === "post-process-matting-required" && (
                <span className="generate-subnote">
                  Includes two-pass matting (+0.5¢) for antialiased transparent
                  edges.
                </span>
              )}
          </div>

          {/* Dimensions Section */}
          <div className="generate-section">
            <span className="generate-label">Dimensions</span>
            <div className="preset-buttons">
              {DIMENSION_PRESETS.map((p) => (
                <button
                  key={p.label}
                  type="button"
                  className={`preset-btn ${width === p.width && height === p.height ? "active" : ""}`}
                  onClick={() => handlePresetSelect(p)}
                  disabled={isGenerating}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <div className="dimension-inputs-row">
              <NumberField
                label="Width"
                value={width}
                min={256}
                max={2048}
                step={16}
                suffix="px"
                disabled={isGenerating}
                onCommit={(w) => setWidth(Math.round(w / 16) * 16)}
              />
              <span className="dim-times">×</span>
              <NumberField
                label="Height"
                value={height}
                min={256}
                max={2048}
                step={16}
                suffix="px"
                disabled={isGenerating}
                onCommit={(h) => setHeight(Math.round(h / 16) * 16)}
              />
            </div>
          </div>

          {/* Provider & Spend Ledger */}
          <div className="generate-section">
            <div className="provider-select-row">
              <Select
                label="Provider"
                value={providerId}
                disabled={isGenerating}
                onChange={setProviderId}
                options={providers.map((p) => {
                  const configured = editor.ai.providerRegistry.hasAdapter(
                    p.id,
                  );
                  return {
                    value: p.id,
                    label: configured
                      ? `${p.name} (${p.pricing.costPerStandardImageCents}¢)`
                      : `${p.name} (Unconfigured)`,
                  };
                })}
              />
              <Select
                label="Quality"
                value={qualityTier}
                disabled={isGenerating}
                onChange={(val) => setQualityTier(val as "standard" | "hd")}
                options={[
                  { value: "standard", label: "Standard" },
                  { value: "hd", label: "High Definition (HD)" },
                ]}
              />
            </div>

            {!isProviderConfigured && (
              <div
                className="provider-unconfigured-notice"
                role="status"
                style={{
                  marginTop: 8,
                  padding: "8px 12px",
                  background: "rgba(234, 179, 8, 0.12)",
                  border: "1px solid rgba(234, 179, 8, 0.3)",
                  borderRadius: 6,
                  color: "var(--color-text)",
                  fontSize: "12px",
                  display: "flex",
                  gap: "8px",
                  alignItems: "center",
                }}
              >
                <AlertCircle
                  size={16}
                  style={{ color: "#eab308", flexShrink: 0 }}
                />
                <span>
                  Provider "{selectedProvider?.name ?? providerId}" is
                  unconfigured. Live external model inference is disabled in
                  this environment.
                </span>
              </div>
            )}

            {/* Budget & Authorization Ledger */}
            <div className="budget-ledger-card">
              <div className="ledger-row">
                <span className="ledger-label">
                  <Coins size={14} /> Estimated Spend:
                </span>
                <strong className="ledger-value">
                  {estimatedCostCents.toFixed(1)}¢
                </strong>
              </div>
              <div className="ledger-row">
                <span className="ledger-label">
                  Available Approved Ceiling:
                </span>
                <span className="ledger-value">
                  {availableBudgetCents.toFixed(1)}¢
                </span>
              </div>
              <div className="ledger-consent">
                <label className="generate-checkbox-label">
                  <input
                    type="checkbox"
                    checked={consentApproved}
                    onChange={(e) => setConsentApproved(e.target.checked)}
                    disabled={isGenerating}
                  />
                  <span>
                    Authorize ({approverId}) up to{" "}
                    <strong>{estimatedCostCents.toFixed(1)}¢</strong> for this
                    generation
                  </span>
                </label>
              </div>
            </div>
          </div>

          <GenerationRecoveryPanel
            service={editor.ai}
            refreshKey={`${activeJobId ?? ""}:${jobState ?? ""}:${billingPending}`}
            onAccountingChange={refreshAccounting}
          />

          {/* Error & Conflict Banner */}
          {billingPending && !isGenerating && (
            <p role="status">
              Provider billing is pending. The estimated charge remains reserved
              until the final charge is confirmed.
            </p>
          )}
          {errorMessage && (
            <div className="generate-error-banner" role="alert">
              <AlertCircle size={16} />
              <span>{errorMessage}</span>
            </div>
          )}

          {revisionConflict && (
            <div className="generate-conflict-banner" role="alert">
              <AlertCircle size={16} />
              <div className="conflict-text">
                <p>{revisionConflict}</p>
                {currentCandidate && (
                  <Button
                    size="sm"
                    variant="primary"
                    onClick={() => handleApplyCandidate(currentCandidate, true)}
                  >
                    Apply to Current Canvas
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* Action Row */}
          <div className="generate-action-row">
            {isGenerating ? (
              <div className="generating-status-wrap">
                <div className="status-indicator">
                  <Loader2 size={16} className="spin" />
                  <span>
                    {jobState === "queued"
                      ? "Queued in service..."
                      : "Generating image..."}{" "}
                    ({elapsedSeconds.toFixed(1)}s
                    {jobProgress > 0 ? ` · ${jobProgress}%` : ""})
                  </span>
                </div>
                <Button variant="danger" size="sm" onClick={handleCancelJob}>
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                variant="primary"
                className="submit-generate-btn"
                onClick={handleGenerate}
                disabled={
                  !accountingReady ||
                  !prompt.trim() ||
                  !consentApproved ||
                  !isProviderConfigured
                }
                title={
                  !isProviderConfigured
                    ? "Selected AI provider is unconfigured"
                    : undefined
                }
              >
                <Sparkles size={16} />
                <span>Generate ({estimatedCostCents.toFixed(1)}¢)</span>
              </Button>
            )}
          </div>
        </div>

        {/* Right Column: Candidate Review Shelf */}
        <div className="generate-shelf-col">
          <div className="shelf-header">
            <span className="shelf-title">
              Candidate Review Shelf ({candidates.length})
            </span>
            {currentCandidate && (
              <div className="shelf-controls">
                <label
                  className="checker-toggle"
                  title="Toggle transparency checkerboard"
                >
                  <input
                    type="checkbox"
                    checked={showCheckerboard}
                    onChange={(e) => setShowCheckerboard(e.target.checked)}
                  />
                  <span>Grid</span>
                </label>
              </div>
            )}
          </div>

          {candidates.length === 0 ? (
            <div className="empty-shelf-card">
              <Sparkles size={32} className="empty-icon" />
              <h3>No candidates generated yet</h3>
              <p>
                Configure prompt, dimensions, and transparency on the left, then
                click <strong>Generate</strong>.
              </p>
              <p className="empty-hint">
                Generated candidates stay in temporary staging. Only accepted
                candidates become permanent document layers.
              </p>
            </div>
          ) : (
            <div className="candidate-shelf-layout">
              {/* Main Candidate Card */}
              {currentCandidate && (
                <div className="candidate-active-card">
                  {currentCandidate.compositePreview && (
                    <p className="section-caption">
                      Placement checked against document revision{" "}
                      {currentCandidate.compositePreview.revision}. Applying
                      checks the current document again.
                    </p>
                  )}
                  {referencePreview.error && (
                    <p role="alert">{referencePreview.error}</p>
                  )}
                  {currentCandidate.diffReport ? (
                    <ResultDiffInspector
                      referenceThumbnail={referencePreview.thumbnail}
                      candidateThumbnail={
                        currentCandidate.compositePreview?.thumbnail ??
                        currentCandidate.asset.thumbnail
                      }
                      afterLabel={
                        currentCandidate.compositePreview
                          ? "Verified composite"
                          : "Candidate"
                      }
                      diffReport={currentCandidate.diffReport}
                      width={currentCandidate.width}
                      height={currentCandidate.height}
                      overrideChecked={overrideViolation}
                      onOverrideChange={(checked) =>
                        setOverrideApproval(
                          checked
                            ? {
                                candidateId: currentCandidate.id,
                                report: currentCandidate.diffReport,
                              }
                            : null,
                        )
                      }
                    />
                  ) : (
                    <div
                      className={`candidate-preview-box ${
                        showCheckerboard && currentCandidate.hasAlpha
                          ? "checkerboard"
                          : ""
                      }`}
                    >
                      <img
                        src={currentCandidate.asset.thumbnail}
                        alt={`Preview of ${currentCandidate.id}`}
                        className="candidate-preview-img"
                      />
                      {currentCandidate.hasAlpha && (
                        <span className="alpha-badge">Transparent Cutout</span>
                      )}
                    </div>
                  )}

                  {/* Metadata Chips */}
                  <div className="candidate-meta-grid">
                    <div className="meta-chip">
                      <span className="chip-label">Dimensions</span>
                      <strong className="chip-value">
                        {currentCandidate.width} × {currentCandidate.height}
                      </strong>
                    </div>
                    {(() => {
                      const record = editor.ai.getRecord(
                        currentCandidate.jobId,
                      );
                      const providerName =
                        record?.providerName ||
                        record?.providerId ||
                        "AI Provider";
                      const cost =
                        record?.actualCostCents ??
                        record?.estimatedCostCents ??
                        0;
                      return (
                        <>
                          <div className="meta-chip">
                            <span className="chip-label">Provider</span>
                            <strong className="chip-value">
                              {providerName}
                            </strong>
                          </div>
                          <div className="meta-chip">
                            <span className="chip-label">Spend</span>
                            <strong className="chip-value">
                              {cost.toFixed(1)}¢
                            </strong>
                          </div>
                        </>
                      );
                    })()}
                    <div className="meta-chip">
                      <span className="chip-label">Format</span>
                      <strong className="chip-value">
                        {currentCandidate.validation.mimeType}
                      </strong>
                    </div>
                  </div>

                  {/* Candidate Actions */}
                  <div className="candidate-actions">
                    {currentCandidate.diffReport && (
                      <Button
                        disabled={checkingPlacement}
                        onClick={() => handleCheckPlacement(currentCandidate)}
                      >
                        {checkingPlacement
                          ? "Checking placement…"
                          : "Check placement"}
                      </Button>
                    )}
                    <Button
                      variant="primary"
                      className="apply-candidate-btn"
                      disabled={
                        checkingPlacement ||
                        Boolean(
                          currentCandidate.diffReport &&
                          !currentCandidate.diffReport.passed &&
                          !overrideViolation,
                        )
                      }
                      onClick={() => handleApplyCandidate(currentCandidate)}
                    >
                      <Layers size={15} />
                      <span>
                        {currentCandidate.diffReport &&
                        !currentCandidate.diffReport.passed &&
                        !overrideViolation
                          ? "Apply (Override Required)"
                          : "Accept & Apply as Layer"}
                      </span>
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() =>
                        handleToggleCanvasPreview(currentCandidate)
                      }
                    >
                      <Eye size={15} />
                      <span>
                        {previewingOnCanvas
                          ? "Hide Canvas Preview"
                          : "Preview on Canvas"}
                      </span>
                    </Button>
                    <Button
                      variant="subtle"
                      onClick={() =>
                        handleDiscardCandidate(currentCandidate.id)
                      }
                    >
                      <Trash2 size={15} />
                      <span>Discard</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* History Shelf Thumbnails */}
              {candidates.length > 1 && (
                <div className="candidate-thumbnails-strip">
                  {candidates.map((cand, idx) => (
                    <button
                      key={cand.id}
                      type="button"
                      className={`cand-thumb-btn ${cand.id === currentCandidate?.id ? "active" : ""}`}
                      onClick={() => setSelectedCandidateId(cand.id)}
                    >
                      <img
                        src={cand.asset.thumbnail}
                        alt={`Candidate ${idx + 1}`}
                      />
                      <span className="thumb-idx">
                        #{candidates.length - idx}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
