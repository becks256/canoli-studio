import {readRecipePackage} from '../ai/recipes/package';
import {iccTarget} from '../core/color/profile-source';
import {download,fileName} from './utils';
import {RawDevelopmentDialog,isCameraRawFile,rawFileAccept} from './RawDevelopmentDialog';
import { RecipeParameterFields } from "./RecipeParameterFields";
import { batchItemNames } from "../ai/batch/source-names";
import type { Recipe } from "../ai/recipes/types";
import { exportPng } from "../engine/png";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Dialog } from "./Dialog";
import { Button, IconButton } from "./controls";
import {
  AlertCircle,
  Archive,
  Boxes,
  Check,
  CheckCircle2,
  Download,
  FileCheck,
  Flag,
  Pause,
  Play,
  Plus,
  RotateCcw,
  ShieldCheck,
  Square,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import type { EditorApplication } from "../editor";
import type {
  BatchConfig,
  BatchItem,
  BatchItemReviewState,
  BatchRun,
  BatchSourceImage,
  BatchSourceInput,
  DeliveryVariantSpec,
} from "../ai/batch/types";
import { DEFAULT_DELIVERY_VARIANTS } from "../ai/batch/types";
import { verifyDeliveryManifest,sanitizeFileName } from "../ai/batch/manifest";

export interface BatchRunnerDialogProps {
  editor: EditorApplication;
  onClose(): void;
}

export function BatchRunnerDialog({ editor, onClose }: BatchRunnerDialogProps) {
  const titleId = useId();
  const [tab, setTab] = useState<"setup" | "runner" | "review">("setup");

  // Storage runs
  const [runs, setRuns] = useState<BatchRun[]>([]);
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  const [activeRun, setActiveRun] = useState<BatchRun | null>(null);

  // Setup tab state
  const [batchName, setBatchName] = useState("Batch Job 1");
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>("");
  const [recipeParams, setRecipeParams] = useState<Record<string, unknown>>({});
  const [selectedPackageId, setSelectedPackageId] = useState("");
  const [packages, setPackages] = useState<Recipe[]>([]);
  const [packageError, setPackageError] = useState<string | null>(null);
  const [concurrency, setConcurrency] = useState(2);
  const [budgetCeilingDollars, setBudgetCeilingDollars] = useState("5.00");
  const [stopOnFirstFailure, setStopOnFirstFailure] = useState(false);
  const [outputNamingTemplate, setOutputNamingTemplate] =
    useState("{name}_{variant}");
  const [selectedVariants, setSelectedVariants] = useState<
    DeliveryVariantSpec[]
  >(DEFAULT_DELIVERY_VARIANTS);
  const [queueItems, setQueueItems] = useState<BatchSourceInput[]>([]);
  const [rawReviews,setRawReviews]=useState<File[]>([]);
  const [nativeProgress,setNativeProgress]=useState<Record<string,string>>({});
  const uploadController=useRef<AbortController|null>(null);
  useEffect(()=>()=>uploadController.current?.abort(),[]);
  const close=()=>{uploadController.current?.abort();exportController.current?.abort();deliveryController.current?.abort();onClose();};

  const selectedRecipe = selectedPackageId
    ? packages.find((recipe) => recipe.id === selectedPackageId)
    : selectedRecipeId
      ? editor.recipes.getRecipe(selectedRecipeId)
      : undefined;

  // Custom variant form
  const [showAddVariant, setShowAddVariant] = useState(false);
  const [customVarName, setCustomVarName] = useState("");
  const [customVarWidth, setCustomVarWidth] = useState(1200);
  const [customVarHeight, setCustomVarHeight] = useState(630);
  const [customVarFormat, setCustomVarFormat] = useState<
    DeliveryVariantSpec["format"]
  >("png");
  const [customVarColor,setCustomVarColor]=useState(false),[deliveryBusy,setDeliveryBusy]=useState(false);
  const deliveryController=useRef<AbortController|null>(null);
  useEffect(()=>()=>deliveryController.current?.abort(),[]);
  async function deliveryTask(action:(signal:AbortSignal)=>Promise<void>){
    if(deliveryController.current)return;const controller=new AbortController();deliveryController.current=controller;setDeliveryBusy(true);setErrorMessage(null);
    try{await action(controller.signal);}catch(error){if(!controller.signal.aborted)setErrorMessage(error instanceof Error?error.message:'Delivery settings could not be prepared.');}
    finally{if(deliveryController.current===controller){deliveryController.current=null;if(!controller.signal.aborted)setDeliveryBusy(false);}}
  }
  const [customVarQuality,setCustomVarQuality]=useState(80),[customVarLossless,setCustomVarLossless]=useState(false),[customVarSpeed,setCustomVarSpeed]=useState(8);

  // Preflight estimate
  const [estimate, setEstimate] = useState<{
    cost: number;
    approved: boolean;
    error?: string;
  } | null>(null);

  // Review tab filter
  const [reviewFilter, setReviewFilter] = useState<
    "all" | BatchItemReviewState
  >("all");
  const [manifestVerification, setManifestVerification] = useState<{
    tested: boolean;
    manifest: NonNullable<BatchRun["deliveryManifest"]>;
    valid: boolean;
    hash?: string;
  } | null>(null);

  const [cleanupMessage, setCleanupMessage] = useState("");
  const [loading, setLoading] = useState(false);
  const [exportProgress, setExportProgress] = useState<string | null>(null);
  const exportController = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      exportController.current?.abort();
    },
    [],
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active = true;
    editor.recipes.packages
      .list()
      .then((value) => {
        if (active) {
          setPackages(value);
          setPackageError(null);
        }
      })
      .catch((error) => {
        if (active) setPackageError(String(error));
      });
    return () => {
      active = false;
    };
  }, [editor]);

  // Refresh runs list
  const refreshRuns = async () => {
    try {
      const allRuns = await editor.batch.listRuns();
      setRuns(allRuns);
      if (activeRunId) {
        const found = allRuns.find((r) => r.id === activeRunId);
        setActiveRun(found ?? null);
      } else if (allRuns.length > 0 && !activeRun) {
        setActiveRunId(allRuns[0].id);
        setActiveRun(allRuns[0]);
      }
    } catch (e) {
      setErrorMessage(e instanceof Error ? e.message : String(e));
    }
  };

  useEffect(() => {
    void refreshRuns();
  }, [editor]);

  // Subscribe to runner events
  useEffect(() => {
    return editor.batch.subscribe((event) => {
      if(event.type==='item_progress'){
        if(event.runId===activeRunId&&event.itemId&&event.progress){const progress=event.progress;setNativeProgress(value=>({...value,[event.itemId!]:`${progress.phase}${progress.fraction===null?'':` ${Math.round(progress.fraction*100)}%`}`}));}
        return;
      }
      if(event.itemId)setNativeProgress(value=>{const next={...value};delete next[event.itemId!];return next;});
      if (event.type === "run_failed")
        setErrorMessage(`Batch stopped: ${event.error}`);
      void refreshRuns();
      if (event.runId === activeRunId && event.run) {
        setActiveRun(event.run);
      }
    });
  }, [editor, activeRunId]);

  // Recalculate preflight estimate whenever queue, recipe, or budget ceiling changes
  useEffect(() => {
    if (queueItems.length === 0) {
      setEstimate(null);
      return;
    }

    let cancelled = false;
    const computeEstimate = async () => {
      try {
        const ceilingCents = Math.round(
          (parseFloat(budgetCeilingDollars) || 0) * 100,
        );
        const tempConfig: BatchConfig = {
          id: "temp",
          recipeSnapshot: structuredClone(
            selectedPackageId
              ? packages.find((recipe) => recipe.id === selectedPackageId)
              : selectedRecipeId
                ? editor.recipes.getRecipe(selectedRecipeId)
                : undefined,
          ),
          name: batchName,
          recipeId: selectedPackageId || selectedRecipeId || undefined,
          recipePackageId: selectedPackageId || undefined,
          recipeParams,
          variants: selectedVariants,
          concurrency,
          budgetCeilingCents: ceilingCents,
          budgetId: "default-budget",
          stopOnFirstFailure,
          outputNamingTemplate,
        };

        const itemNames = batchItemNames(queueItems);
        const tempItems: BatchItem[] = queueItems.map((s, idx) => ({
          id: `item-${idx}`,
          name: itemNames[idx],
          source: s,
          parameters: s.parameters,
          status: "pending",
          reviewState: "unreviewed",
          estimatedCostCents: 0,
          actualCostCents: 0,
          deliverables: [],
          retryCount: 0,
        }));

        const result = await editor.batch.runner.estimateBatch(
          tempConfig,
          tempItems,
        );
        if (!cancelled) {
          setEstimate({
            cost: result.totalEstimatedCostCents,
            approved: result.approved,
            error: result.error,
          });
        }
      } catch (err: unknown) {
        if (!cancelled) {
          const msg = err instanceof Error ? err.message : String(err);
          setEstimate({ cost: 0, approved: false, error: msg });
        }
      }
    };

    void computeEstimate();
    return () => {
      cancelled = true;
    };
  }, [
    queueItems,
    selectedRecipeId,
    selectedPackageId,
    recipeParams,
    packages,
    selectedVariants,
    concurrency,
    budgetCeilingDollars,
    stopOnFirstFailure,
    outputNamingTemplate,
    editor,
  ]);

  // Add source image from current active canvas
  const handleAddCurrentDocument = async () => {
    try {
      const doc = editor.document.toJSON();
      const blob = await exportPng(doc, editor.assetStore, editor.renderer);
      setQueueItems((prev) => [
        ...prev,
        {
          id: `canvas-${crypto.randomUUID()}`,
          name: doc.name || "Active Document",
          width: doc.width,
          height: doc.height,
          mimeType: "image/png",
          byteLength: blob.size,
          blob,
        },
      ]);
    } catch (error) {
      setErrorMessage(String(error));
    }
  };

  // Add sample placeholder images for demo / testing
  const handleAddSampleAssets = async () => {
    const samples: BatchSourceImage[] = [
      {
        id: `sample-hero-${Date.now()}-1`,
        name: "product_hero_blue.png",
        width: 1920,
        height: 1080,
        mimeType: "image/png",
        byteLength: 245000,
      },
      {
        id: `sample-lifestyle-${Date.now()}-2`,
        name: "lifestyle_portrait_sun.png",
        width: 1080,
        height: 1350,
        mimeType: "image/png",
        byteLength: 312000,
      },
      {
        id: `sample-macro-${Date.now()}-3`,
        name: "macro_texture_detail.png",
        width: 1200,
        height: 1200,
        mimeType: "image/png",
        byteLength: 198000,
      },
    ];
    try {
      for (const sample of samples) {
        const canvas = document.createElement("canvas");
        canvas.width = sample.width;
        canvas.height = sample.height;
        try {
          const ctx = canvas.getContext("2d");
          if (!ctx) throw new Error("Cannot create demo image.");
          ctx.fillStyle = "#3498db";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.fillStyle = "#2c3e50";
          ctx.fillRect(0, 0, canvas.width / 2, canvas.height);
          sample.blob = await new Promise<Blob>((resolve, reject) =>
            canvas.toBlob(
              (blob) =>
                blob
                  ? resolve(blob)
                  : reject(new Error("Demo encoding failed.")),
              "image/png",
            ),
          );
          sample.byteLength = sample.blob.size;
        } finally {
          canvas.width = canvas.height = 0;
        }
      }
      setQueueItems((prev) => [...prev, ...samples]);
    } catch (error) {
      setErrorMessage(String(error));
    }
  };

  // Upload local images into batch queue
  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (!files.length) return;
    const controller=new AbortController();uploadController.current?.abort();uploadController.current=controller;
    setLoading(true);
    setErrorMessage(null);
    try {
      const raw:File[]=[];
      const newItems: BatchSourceImage[] = [];
      // Decode sequentially and immediately release bitmaps; preserve original file bytes.
      for (const file of files) {
        controller.signal.throwIfAborted();
        if(isCameraRawFile(file)){raw.push(file);continue;}
        let bitmap: ImageBitmap;
        try {
          bitmap = await createImageBitmap(file);
        } catch {
          throw new Error(
            `Cannot decode '${file.name}'. No files from this selection were queued.`,
          );
        }
        try {
          controller.signal.throwIfAborted();
          newItems.push({
            id: `file-${crypto.randomUUID()}`,
            name: file.name,
            width: bitmap.width,
            height: bitmap.height,
            mimeType: file.type || "application/octet-stream",
            byteLength: file.size,
            blob: file,
          });
        } finally {
          bitmap.close();
        }
      }
      controller.signal.throwIfAborted();
      setQueueItems((items) => [...items, ...newItems]);setRawReviews(raw);
      setEstimate(null);
    } catch (error) {
      setErrorMessage(String(error));
    } finally {
      setLoading(false);
    }
  };

  // Remove source item from queue
  const handleRemoveQueueItem = (id: string) => {
    setQueueItems((prev) => prev.filter((item) => item.id !== id));
  };

  // Toggle delivery variant
  const handleToggleVariant = (variant: DeliveryVariantSpec) => {
    setSelectedVariants((prev) => {
      const exists = prev.some((v) => v.id === variant.id);
      if (exists) {
        if (prev.length <= 1) return prev; // Keep at least one variant
        return prev.filter((v) => v.id !== variant.id);
      }
      return [...prev, variant];
    });
  };

  // Add custom delivery variant
  const handleAddCustomVariant = () => {
    void deliveryTask(async signal=>{
    const capturedOutput=editor.colorSettings.output;
    if (!customVarName.trim()) return;
    const newVar: DeliveryVariantSpec = {
      id: `custom-${Date.now()}`,
      name: customVarName.trim(),
      targetWidth: Math.max(16, customVarWidth),
      targetHeight: Math.max(16, customVarHeight),
      format: customVarFormat,
      ...(customVarColor&&['png','tiff','pdf'].includes(customVarFormat)?{color:await editor.batch.captureColorOutput(capturedOutput,{signal})}:{}),
      ...(customVarFormat==='avif'?{quality:customVarQuality/100,avifLossless:customVarLossless,avifSpeed:customVarSpeed}:{}),
      fit: "cover",
      nameTemplate: `{name}_${customVarName.toLowerCase().replace(/[^a-z0-9]/g, "_")}`,
    };
    signal.throwIfAborted();
    setSelectedVariants((prev) => [...prev, newVar]);
    setCustomVarName("");
    setShowAddVariant(false);
    });
  };

  // Create and launch batch
  const handleStartBatch = async () => {
    if (queueItems.length === 0) {
      setErrorMessage("Please add at least one source image to the queue.");
      return;
    }
    if (selectedVariants.length === 0) {
      setErrorMessage("Please select at least one delivery variant.");
      return;
    }

    setLoading(true);
    setErrorMessage(null);
    try {
      const ceilingCents = Math.round(
        (parseFloat(budgetCeilingDollars) || 0) * 100,
      );
      const run = await editor.batch.createBatch(
        {
          name: batchName,
          recipeId: selectedRecipeId || undefined,
          recipePackageId: selectedPackageId || undefined,
          recipeParams,
          variants: selectedVariants,
          concurrency,
          budgetCeilingCents: ceilingCents,
          budgetId: "default-budget",
          stopOnFirstFailure,
          outputNamingTemplate,
        },
        queueItems,
      );

      setActiveRunId(run.id);
      setActiveRun(run);
      setTab("runner");

      // Start run asynchronously
      await editor.batch.start(run.id);
      await refreshRuns();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  // Controls for active run
  const handlePause = async () => {
    if (!activeRunId) return;
    await editor.batch.pause(activeRunId);
    await refreshRuns();
  };

  const handleResume = async () => {
    if (!activeRunId) return;
    await editor.batch.resume(activeRunId);
    await refreshRuns();
  };

  const handleCancel = async () => {
    if (!activeRunId) return;
    await editor.batch.cancel(activeRunId);
    await refreshRuns();
  };

  const handleRetryFailed = async () => {
    if (!activeRunId) return;
    setLoading(true);
    try {
      await editor.batch.retryFailed(activeRunId);
      await refreshRuns();
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setLoading(false);
    }
  };

  // Review status updater
  const handleSetReviewState = async (
    itemId: string,
    state: BatchItemReviewState,
    notes?: string,
  ) => {
    if (!activeRunId) return;
    try {
      await editor.batch.setReviewState(activeRunId, itemId, state, notes);
      await refreshRuns();
    } catch (err: unknown) {
      console.warn("Failed to set review state:", err);
    }
  };

  const handleDownloadPrepared=async(itemId:string,name:string)=>{
    if(!activeRunId)return;
    try{
      const blob=await editor.batch.getPreparedProject(activeRunId,itemId),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`${sanitizeFileName(name)}.luma`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }catch(error){setErrorMessage(String(error));}
  };

  // Download deliverable file
  const handleDownloadDeliverable = async (
    delivId: string,
    fileName: string,
  ) => {
    try {
      const blob = await editor.batch.getDeliverableBlob(delivId);
      if (!blob) throw new Error("Deliverable blob not found in storage.");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(`Failed to download deliverable: ${msg}`);
    }
  };

  // Download delivery manifest JSON
  const handleDownloadManifest = () => {
    if (!activeRun?.deliveryManifest) return;
    const jsonStr = JSON.stringify(activeRun.deliveryManifest, null, 2);
    const blob = new Blob([jsonStr], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `delivery-manifest-${activeRun.id}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Download complete delivery package ZIP
  const handleDownloadZipPackage = async () => {
    if (!activeRunId || exportController.current) return;
    const controller = new AbortController();
    exportController.current = controller;
    setExportProgress("Verifying outputs…");
    setLoading(true);
    try {
      const zipBlob = await editor.batch.exportDeliveryPackageZip(activeRunId, {
        signal: controller.signal,
        onProgress: (completed, total) =>
          setExportProgress(`Packing ${completed} of ${total}`),
      });
      controller.signal.throwIfAborted();
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `delivery-package-${activeRunId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!controller.signal.aborted)
        setErrorMessage(`Failed to export delivery package: ${msg}`);
    } finally {
      exportController.current = null;
      setExportProgress(null);
      setLoading(false);
    }
  };

  // Verify delivery manifest integrity
  const handleVerifyIntegrity = async () => {
    if (!activeRun?.deliveryManifest) return;
    const manifest = activeRun.deliveryManifest;
    try {
      const result = await verifyDeliveryManifest(manifest);
      setManifestVerification({
        tested: true,
        manifest,
        valid: result.valid,
        hash: result.calculatedHash,
      });
    } catch {
      setManifestVerification({ tested: true, manifest, valid: false });
    }
  };

  // Filtered review items
  const reviewItems = useMemo(() => {
    if (!activeRun) return [];
    if (reviewFilter === "all") return activeRun.items;
    return activeRun.items.filter((item) => item.reviewState === reviewFilter);
  }, [activeRun, reviewFilter]);

  // Compute progress percentage
  const progressPct = useMemo(() => {
    if (!activeRun || activeRun.items.length === 0) return 0;
    const finished = activeRun.items.filter(
      (i) =>
        i.status === "succeeded" ||
        i.status === "failed" ||
        i.status === "skipped",
    ).length;
    return Math.round((finished / activeRun.items.length) * 100);
  }, [activeRun]);

  return (<>
    <Dialog titleId={titleId} onClose={close} className="batch-dialog">
      <div className="batch-container">
        {/* Header */}
        <div className="batch-header">
          <div className="batch-title-row">
            <Boxes className="batch-title-icon" size={20} />
            <h2 id={titleId} className="batch-title">
              Resumable Batch Runner & Delivery Manifest
            </h2>
            <IconButton
              label="Close"
              onClick={close}
              className="batch-close-btn"
            >
              <X size={18} />
            </IconButton>
          </div>

          {/* Navigation Tabs */}
          <div className="batch-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={tab === "setup"}
              className={`batch-tab ${tab === "setup" ? "active" : ""}`}
              onClick={() => setTab("setup")}
            >
              Queue & Setup
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "runner"}
              className={`batch-tab ${tab === "runner" ? "active" : ""}`}
              onClick={() => setTab("runner")}
            >
              Runner & Controls
              {activeRun && activeRun.status === "running" && (
                <span className="batch-tab-badge running">Running</span>
              )}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === "review"}
              className={`batch-tab ${tab === "review" ? "active" : ""}`}
              onClick={() => setTab("review")}
            >
              Review Grid & Manifest
              {activeRun && (
                <span className="batch-tab-badge">
                  {activeRun.items.reduce(
                    (acc, i) => acc + i.deliverables.length,
                    0,
                  )}
                </span>
              )}
            </button>
          </div>
        </div>

        {/* Global Error Banner */}
        {errorMessage && (
          <div className="batch-alert error">
            <AlertCircle size={16} />
            <span>{errorMessage}</span>
            <button
              type="button"
              className="batch-alert-dismiss"
              onClick={() => setErrorMessage(null)}
            >
              <X size={14} />
            </button>
          </div>
        )}

        {/* TAB 1: QUEUE & SETUP */}
        {tab === "setup" && (
          <div className="batch-content setup-tab" role="tabpanel">
            <div className="batch-setup-grid">
              {/* Left Column: Configuration */}
              <div className="batch-setup-section config-section">
                <h3 className="section-title">Batch Configuration</h3>
                <Button
                  size="sm"
                  variant="subtle"
                  disabled={loading}
                  onClick={async () => {
                    setLoading(true);
                    setCleanupMessage("");
                    setErrorMessage(null);
                    try {
                      const result =
                        await editor.batch.storage.reclaimUnusedBlobs();
                      setCleanupMessage(
                        `Removed ${result.removedCount} unused files (${result.removedBytes.toLocaleString()} bytes).`,
                      );
                    } catch (error) {
                      setErrorMessage(
                        `Storage cleanup failed: ${String(error)}`,
                      );
                    } finally {
                      setLoading(false);
                    }
                  }}
                >
                  Clean unused batch files
                </Button>
                {cleanupMessage && <p role="status">{cleanupMessage}</p>}

                <div className="form-group">
                  <label htmlFor="batch-name">Batch Name</label>
                  <input
                    id="batch-name"
                    type="text"
                    className="batch-input"
                    value={batchName}
                    disabled={deliveryBusy}
                    onChange={(e) => setBatchName(e.target.value)}
                    placeholder="e.g. Summer Campaign Variant Pack"
                  />
                </div>

                <div className="form-group">
                  <label htmlFor="recipe-select">
                    Processing Recipe (Optional)
                  </label>
                  <select
                    id="recipe-select"
                    disabled={deliveryBusy}
                    className="batch-select"
                    value={selectedRecipeId}
                    onChange={(e) => {
                      setSelectedRecipeId(e.target.value);
                      setSelectedPackageId("");
                      setRecipeParams({});
                      setQueueItems((items) =>
                        items.map(
                          ({ parameters: _parameters, ...item }) => item,
                        ),
                      );
                      setEstimate(null);
                    }}
                  >
                    <option value="">
                      None (Geometry & format variants only)
                    </option>
                    {editor.recipes.getAllRecipes().map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                        {p.tags?.length ? ` (${p.tags.join(", ")})` : ""}
                      </option>
                    ))}
                  </select>
                  <span className="form-hint">
                    Applies atomic recipe adjustments deterministically to each
                    item prior to variant rendering.
                  </span>
                </div>

                <div className="form-group">
                  <label htmlFor="package-select">
                    Portable Recipe (Optional)
                  </label>
                  <select
                    id="package-select"
                    className="batch-select"
                    value={selectedPackageId}
                    disabled={deliveryBusy}
                    onChange={(event) => {
                      const packageId=event.target.value;setSelectedPackageId(packageId);
                      if(packageId)void deliveryTask(async signal=>{const file=await editor.recipes.packages.get(packageId);if(!file)throw new Error('Recipe package is unavailable.');const contents=await readRecipePackage(file);if(contents.deliveryPreset){const preset=await editor.batch.importDeliveryPreset(contents.deliveryPreset,{signal});signal.throwIfAborted();setSelectedVariants(preset.variants);}});
                      setSelectedRecipeId("");
                      setRecipeParams({});
                      setQueueItems((items) =>
                        items.map(
                          ({ parameters: _parameters, ...item }) => item,
                        ),
                      );
                      setEstimate(null);
                    }}
                  >
                    <option value="">None</option>
                    {packages.map((recipe) => (
                      <option key={recipe.id} value={recipe.id}>
                        {recipe.name}
                      </option>
                    ))}
                  </select>
                  <span className="form-hint">
                    Includes saved artwork. The batch keeps its own copy for
                    retries and resuming.
                  </span>
                  {packageError && (
                    <p role="alert">
                      Unable to load portable recipes: {packageError}
                    </p>
                  )}
                </div>

                {selectedRecipe && (
                  <div role="group" aria-label="Batch recipe parameters">
                    <RecipeParameterFields
                      parameters={selectedRecipe.parameters}
                      values={recipeParams}
                      disabled={loading}
                      onChange={(values) => {
                        setRecipeParams(values);
                        setEstimate(null);
                      }}
                    />
                  </div>
                )}

                <div className="form-row">
                  <div className="form-group half">
                    <label htmlFor="concurrency-select">
                      Concurrency Limit
                    </label>
                    <select
                      id="concurrency-select"
                      className="batch-select"
                      value={concurrency}
                      onChange={(e) =>
                        setConcurrency(parseInt(e.target.value, 10))
                      }
                    >
                      <option value={1}>1 Worker (Sequential)</option>
                      <option value={2}>2 Workers (Recommended)</option>
                      <option value={4}>4 Workers (High Speed)</option>
                      <option value={8}>8 Workers (Max)</option>
                    </select>
                  </div>

                  <div className="form-group half">
                    <label htmlFor="budget-ceiling">Budget Ceiling ($)</label>
                    <input
                      id="budget-ceiling"
                      type="number"
                      step="0.50"
                      min="0"
                      className="batch-input"
                      value={budgetCeilingDollars}
                      onChange={(e) => setBudgetCeilingDollars(e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="checkbox-label">
                    <input
                      type="checkbox"
                      checked={stopOnFirstFailure}
                      onChange={(e) => setStopOnFirstFailure(e.target.checked)}
                    />
                    <span>
                      Stop batch execution immediately on first item failure
                    </span>
                  </label>
                </div>

                <div className="form-group">
                  <label htmlFor="naming-template">
                    Output Naming Template
                  </label>
                  <input
                    id="naming-template"
                    type="text"
                    className="batch-input"
                    value={outputNamingTemplate}
                    onChange={(e) => setOutputNamingTemplate(e.target.value)}
                  />
                  <span className="form-hint">
                    Variables: <code>{"{name}"}</code>,{" "}
                    <code>{"{variant}"}</code>, <code>{"{width}"}</code>,{" "}
                    <code>{"{height}"}</code>, <code>{"{aspect}"}</code>
                  </span>
                </div>

                {/* Delivery Variants Selector */}
                <div className="variants-section">
                  <div className="form-row">
                    <Button variant="secondary" disabled={deliveryBusy} onClick={()=>void deliveryTask(async signal=>{const file=await editor.batch.exportDeliveryPreset({name:batchName||'Delivery preset',variants:selectedVariants},{signal});signal.throwIfAborted();download(file,`${fileName(batchName)}.canoli-delivery`);})}>Export delivery preset</Button>
                    <label>Import delivery preset<input type="file" accept=".canoli-delivery,application/x-canoli-delivery" disabled={deliveryBusy} onChange={event=>{const file=event.target.files?.[0];event.target.value='';if(file)void deliveryTask(async signal=>{const preset=await editor.batch.importDeliveryPreset(file,{signal});signal.throwIfAborted();setSelectedVariants(preset.variants);setBatchName(preset.name);});}}/></label>
                    {selectedRecipe&&<Button variant="secondary" disabled={deliveryBusy} onClick={()=>void deliveryTask(async signal=>{const preset=await editor.batch.exportDeliveryPreset({name:batchName||'Delivery preset',variants:selectedVariants},{signal});const source=selectedPackageId?await editor.recipes.packages.get(selectedPackageId):selectedRecipe;if(!source)throw new Error('Recipe package is unavailable.');const file=await editor.recipes.attachDeliveryPreset(source,preset,{signal});signal.throwIfAborted();download(file,`${fileName(selectedRecipe.name)}.luma-recipe`);})}>Export recipe with delivery preset</Button>}
                  </div>
                  {deliveryBusy&&<p role="status">Preparing delivery profiles…</p>}

                  <div className="variants-header">
                    <label>
                      Target Delivery Variants ({selectedVariants.length}{" "}
                      selected)
                    </label>
                    <button
                      type="button"
                      className="text-btn"
                      onClick={() => setShowAddVariant(!showAddVariant)}
                    >
                      <Plus size={14} /> Add Custom
                    </button>
                  </div>

                  <div className="variants-list">
                    {[...DEFAULT_DELIVERY_VARIANTS.map(preset=>selectedVariants.find(variant=>variant.id===preset.id)??preset),...selectedVariants.filter(variant=>!DEFAULT_DELIVERY_VARIANTS.some(preset=>preset.id===variant.id))].map((v) => {
                      const isSelected = selectedVariants.some(
                        (sel) => sel.id === v.id,
                      );
                      return (
                        <label
                          key={v.id}
                          className={`variant-chip ${isSelected ? "selected" : ""}`}
                        >
                          <input
                            type="checkbox"
                            disabled={deliveryBusy}
                            checked={isSelected}
                            onChange={() => handleToggleVariant(v)}
                          />
                          <span className="variant-chip-name">{v.name}</span>
                          <span className="variant-chip-dims">
                            {v.targetWidth}×{v.targetHeight} · {v.format.toUpperCase()}{v.color?` · ${v.color.profile.name}`:''}{v.format==='avif'?(v.avifLossless||v.quality===1?' · Lossless':` · ${Math.round((v.quality??.8)*100)}%`):''}
                          </span>
                        </label>
                      );
                    })}
                  </div>

                  {showAddVariant && (
                    <div className="add-variant-box">
                      <div className="form-row">
                        <input
                          type="text"
                          placeholder="Variant Name (e.g. Banner)"
                          className="batch-input"
                          disabled={deliveryBusy}
                          value={customVarName}
                          onChange={(e) => setCustomVarName(e.target.value)}
                        />
                        <select
                          className="batch-select"
                          aria-label="Variant format"
                          disabled={deliveryBusy}
                          value={customVarFormat}
                          onChange={(e) =>
                            setCustomVarFormat(
                              e.target.value as DeliveryVariantSpec["format"],
                            )
                          }
                        >
                          <option value="png">PNG</option>
                          <option value="jpeg">JPEG</option>
                          <option value="webp">WebP</option>
                          <option value="avif">AVIF</option>
                          <option value="tiff">TIFF</option>
                          <option value="pdf">PDF</option>
                        </select>
                      </div>
                      {['png','tiff','pdf'].includes(customVarFormat)&&<label className="checkbox-field"><input type="checkbox" disabled={deliveryBusy} checked={customVarColor} onChange={event=>setCustomVarColor(event.target.checked)}/>Use current output profile: {iccTarget(editor.colorSettings.output.profile).name}</label>}
                      {!['png','tiff','pdf'].includes(customVarFormat)&&<p>This format uses sRGB delivery.</p>}
                      {customVarFormat==='avif'&&<>
                        <label className="checkbox-field"><input type="checkbox" checked={customVarLossless} onChange={event=>setCustomVarLossless(event.target.checked)}/>Lossless AVIF variant</label>
                        {!customVarLossless&&<label>AVIF quality<input aria-label="AVIF quality" type="number" className="batch-input" min={1} max={100} value={customVarQuality} onChange={event=>setCustomVarQuality(Number(event.target.value))}/></label>}
                        <label>AVIF compression<select aria-label="AVIF compression" className="batch-select" value={String(customVarSpeed)} onChange={event=>setCustomVarSpeed(Number(event.target.value))}><option value="8">Fast</option><option value="6">Balanced</option><option value="4">Smaller file</option></select></label>
                      </>}
                      <div className="form-row">
                        <input
                          type="number"
                          placeholder="Width"
                          className="batch-input"
                          disabled={deliveryBusy}
                          value={customVarWidth}
                          onChange={(e) =>
                            setCustomVarWidth(
                              parseInt(e.target.value, 10) || 100,
                            )
                          }
                        />
                        <input
                          type="number"
                          placeholder="Height"
                          className="batch-input"
                          disabled={deliveryBusy}
                          value={customVarHeight}
                          onChange={(e) =>
                            setCustomVarHeight(
                              parseInt(e.target.value, 10) || 100,
                            )
                          }
                        />
                        <Button
                          size="sm"
                          variant="secondary"
                          disabled={deliveryBusy}
                          onClick={handleAddCustomVariant}
                        >
                          Add
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Right Column: Source Image Queue */}
              <div className="batch-setup-section queue-section">
                <div className="queue-header">
                  <h3 className="section-title">
                    Source Items Queue ({queueItems.length})
                  </h3>
                  <div className="queue-actions">
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={handleAddCurrentDocument}
                    >
                      + Canvas
                    </Button>
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={handleAddSampleAssets}
                    >
                      + Demo Samples
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={loading}
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <Upload size={14} /> Upload
                    </Button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      accept={`image/*,${rawFileAccept}`}
                      style={{ display: "none" }}
                      disabled={loading}
                      aria-label="Upload batch images"
                      onChange={handleFileUpload}
                    />
                  </div>
                </div>

                <div className="queue-items-container">
                  {queueItems.length === 0 ? (
                    <div className="queue-empty">
                      <Boxes size={32} />
                      <p>Queue is empty</p>
                      <span>
                        Upload files or add the current canvas document to begin
                        batch processing.
                      </span>
                    </div>
                  ) : (
                    <div className="queue-list">
                      {queueItems.map((item, index) => (
                        <div key={item.id} className="queue-item">
                          <span className="queue-item-index">{index + 1}</span>
                          <div className="queue-item-info">
                            <span className="queue-item-name">{item.name}</span>
                            <span className="queue-item-meta">
                              {item.width}×{item.height} •{" "}
                              {Math.round(item.byteLength / 1024)} KB
                            </span>
                            {item.raw&&<span className="queue-item-meta">RAW · {item.raw.options.development.whiteBalance} WB · {item.raw.options.development.exposure} EV · original retained</span>}
                            {selectedRecipe &&
                              selectedRecipe.parameters.length > 0 && (
                                <details className="queue-parameter-overrides">
                                  <summary>
                                    Recipe overrides (
                                    {Object.keys(item.parameters ?? {}).length})
                                  </summary>
                                  {selectedRecipe.parameters.map(
                                    (parameter) => {
                                      const overridden = Object.hasOwn(
                                        item.parameters ?? {},
                                        parameter.name,
                                      );
                                      const inherited =
                                        recipeParams[parameter.name] ??
                                        parameter.default ??
                                        "";
                                      const update = (
                                        parameters: Record<string, unknown>,
                                      ) => {
                                        setQueueItems((items) =>
                                          items.map((source) =>
                                            source.id === item.id
                                              ? { ...source, parameters }
                                              : source,
                                          ),
                                        );
                                        setEstimate(null);
                                      };
                                      return (
                                        <div key={parameter.name}>
                                          <label className="checkbox-label">
                                            <input
                                              type="checkbox"
                                              checked={overridden}
                                              disabled={loading}
                                              onChange={(event) => {
                                                const values = {
                                                  ...item.parameters,
                                                };
                                                if (event.target.checked)
                                                  values[parameter.name] =
                                                    inherited;
                                                else
                                                  delete values[parameter.name];
                                                update(values);
                                              }}
                                            />
                                            Override {parameter.label}
                                          </label>
                                          <RecipeParameterFields
                                            parameters={[parameter]}
                                            disabled={loading || !overridden}
                                            values={{
                                              ...recipeParams,
                                              ...item.parameters,
                                            }}
                                            onChange={(values) =>
                                              update({
                                                ...item.parameters,
                                                [parameter.name]:
                                                  values[parameter.name],
                                              })
                                            }
                                          />
                                        </div>
                                      );
                                    },
                                  )}
                                </details>
                              )}
                          </div>
                          <IconButton
                            label="Remove item"
                            onClick={() => handleRemoveQueueItem(item.id)}
                            className="queue-item-remove"
                          >
                            <Trash2 size={14} />
                          </IconButton>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Preflight Estimate & Start Button */}
                <div className="preflight-footer">
                  {estimate && (
                    <div
                      className={`estimate-banner ${estimate.approved ? "ok" : "warning"}`}
                    >
                      {estimate.approved ? (
                        <>
                          <CheckCircle2 size={16} />
                          <span>
                            Estimated Spend: ${(estimate.cost / 100).toFixed(2)}{" "}
                            • {estimate.cost===0?"Ready to run locally":"Budget Approved"}
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle size={16} />
                          <span>
                            {estimate.error ||
                              "Exceeds approved budget ceiling"}
                          </span>
                        </>
                      )}
                    </div>
                  )}

                  <div className="start-actions">
                    <Button
                      variant="primary"
                      disabled={
                        queueItems.length === 0 ||
                        selectedVariants.length === 0 ||
                        loading ||deliveryBusy||
                        !estimate ||
                        !estimate.approved
                      }
                      onClick={handleStartBatch}
                      className="start-batch-btn"
                    >
                      <Play size={16} />
                      <span>
                        {loading ? "Starting..." : "Start Resumable Batch"}
                      </span>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: RUNNER & CONTROLS */}
        {tab === "runner" && (
          <div className="batch-content runner-tab" role="tabpanel">
            {/* Run Selector and Live Controls */}
            <div className="runner-controls-bar">
              <div className="run-selector">
                <label htmlFor="active-run-select">Active Batch Run:</label>
                <select
                  id="active-run-select"
                  className="batch-select"
                  value={activeRunId ?? ""}
                  onChange={(e) => {
                    const found = runs.find((r) => r.id === e.target.value);
                    setActiveRunId(e.target.value);
                    setActiveRun(found ?? null);
                  }}
                >
                  {runs.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.config.name} ({r.status}) •{" "}
                      {new Date(r.createdAt).toLocaleTimeString()}
                    </option>
                  ))}
                </select>
              </div>

              {activeRun && (
                <div className="runner-action-buttons">
                  {activeRun.status === "running" && (
                    <Button variant="secondary" onClick={handlePause}>
                      <Pause size={15} /> Pause
                    </Button>
                  )}
                  {activeRun.status === "paused" && (
                    <Button variant="primary" onClick={handleResume}>
                      <Play size={15} /> Resume
                    </Button>
                  )}
                  {(activeRun.status === "running" ||
                    activeRun.status === "paused") && (
                    <Button variant="danger" onClick={handleCancel}>
                      <Square size={15} /> Cancel
                    </Button>
                  )}
                  {activeRun.summary && activeRun.summary.failed > 0 && (
                    <Button
                      variant="secondary"
                      onClick={handleRetryFailed}
                      disabled={loading}
                    >
                      <RotateCcw size={15} /> Retry Failed (
                      {activeRun.summary.failed})
                    </Button>
                  )}
                  <Button variant="subtle" onClick={() => setTab("review")}>
                    Review Deliverables &rarr;
                  </Button>
                </div>
              )}
            </div>

            {/* Run Overview & Metrics */}
            {activeRun ? (
              <div className="runner-dashboard">
                <div className="runner-status-card">
                  <div className="status-badge-row">
                    <span className={`status-pill ${activeRun.status}`}>
                      {activeRun.status}
                    </span>
                    <span className="run-timestamp">
                      Created: {new Date(activeRun.createdAt).toLocaleString()}
                    </span>
                  </div>

                  {/* Progress Bar */}
                  <div className="progress-container">
                    <div className="progress-bar-bg">
                      <div
                        className="progress-bar-fill"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    <span className="progress-label">
                      {progressPct}% complete
                    </span>
                  </div>

                  {/* Metrics Grid */}
                  <div className="metrics-grid">
                    <div className="metric-box">
                      <span className="metric-label">Total Items</span>
                      <span className="metric-value">
                        {activeRun.items.length}
                      </span>
                    </div>
                    <div className="metric-box succeeded">
                      <span className="metric-label">Succeeded</span>
                      <span className="metric-value">
                        {activeRun.summary.succeeded}
                      </span>
                    </div>
                    <div className="metric-box failed">
                      <span className="metric-label">Failed</span>
                      <span className="metric-value">
                        {activeRun.summary.failed}
                      </span>
                    </div>
                    <div className="metric-box">
                      <span className="metric-label">Pending / Running</span>
                      <span className="metric-value">
                        {activeRun.summary.pending + activeRun.summary.running}
                      </span>
                    </div>
                    <div className="metric-box spend">
                      <span className="metric-label">
                        Actual Spend / Ceiling
                      </span>
                      <span className="metric-value">
                        $
                        {(activeRun.summary.totalActualCostCents / 100).toFixed(
                          2,
                        )}{" "}
                        / $
                        {(activeRun.config.budgetCeilingCents / 100).toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Items Execution Table */}
                <div className="runner-items-table-container">
                  <table className="runner-table">
                    <thead>
                      <tr>
                        <th>Status</th>
                        <th>Item Name</th>
                        <th>Variants</th>
                        <th>Cost</th>
                        <th>Duration</th>
                        <th>Review State</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {activeRun.items.map((item) => (
                        <tr key={item.id} className={`item-row ${item.status}`}>
                          <td>
                            <span className={`item-status-tag ${item.status}`}>
                              {item.status}
                              {nativeProgress[item.id]&&<span role="status"> · {nativeProgress[item.id]}</span>}
                              {item.retryCount > 0 &&
                                ` (retry #${item.retryCount})`}
                            </span>
                          </td>
                          <td className="item-name-cell">
                            <strong>{item.name}</strong>
                            {item.error && (
                              <span className="item-error-text">
                                {item.error}
                              </span>
                            )}
                          </td>
                          <td>{item.deliverables.length} files</td>
                          <td>${(item.actualCostCents / 100).toFixed(2)}</td>
                          <td>
                            {item.durationMs !== undefined
                              ? `${(item.durationMs / 1000).toFixed(1)}s`
                              : "-"}
                          </td>
                          <td>
                            <span className={`review-tag ${item.reviewState}`}>
                              {item.reviewState}
                            </span>
                          </td>
                          <td>
                            <button
                              type="button"
                              className="text-btn"
                              onClick={() => {
                                setTab("review");
                              }}
                            >
                              Inspect
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : (
              <div className="runner-empty">
                <p>
                  No active batch run selected. Configure and launch a batch
                  from the Setup tab.
                </p>
              </div>
            )}
          </div>
        )}

        {/* TAB 3: REVIEW GRID & MANIFEST */}
        {tab === "review" && (
          <div className="batch-content review-tab" role="tabpanel">
            {activeRun ? (
              <div className="review-dashboard">
                {/* Review Header Controls */}
                <div className="review-controls-bar">
                  <div className="review-filters">
                    <span className="filter-label">Filter:</span>
                    <button
                      type="button"
                      className={`filter-btn ${reviewFilter === "all" ? "active" : ""}`}
                      onClick={() => setReviewFilter("all")}
                    >
                      All ({activeRun.items.length})
                    </button>
                    <button
                      type="button"
                      className={`filter-btn ${reviewFilter === "unreviewed" ? "active" : ""}`}
                      onClick={() => setReviewFilter("unreviewed")}
                    >
                      Unreviewed (
                      {
                        activeRun.items.filter(
                          (i) => i.reviewState === "unreviewed",
                        ).length
                      }
                      )
                    </button>
                    <button
                      type="button"
                      className={`filter-btn approved ${reviewFilter === "approved" ? "active" : ""}`}
                      onClick={() => setReviewFilter("approved")}
                    >
                      Approved ({activeRun.summary.approvedCount})
                    </button>
                    <button
                      type="button"
                      className={`filter-btn rejected ${reviewFilter === "rejected" ? "active" : ""}`}
                      onClick={() => setReviewFilter("rejected")}
                    >
                      Rejected ({activeRun.summary.rejectedCount})
                    </button>
                    <button
                      type="button"
                      className={`filter-btn flagged ${reviewFilter === "flagged" ? "active" : ""}`}
                      onClick={() => setReviewFilter("flagged")}
                    >
                      Flagged ({activeRun.summary.flaggedCount})
                    </button>
                  </div>

                  <div className="manifest-actions">
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={handleVerifyIntegrity}
                      disabled={!activeRun.deliveryManifest}
                    >
                      <ShieldCheck size={14} /> Verify Integrity
                    </Button>
                    <Button
                      size="sm"
                      variant="subtle"
                      onClick={handleDownloadManifest}
                      disabled={!activeRun.deliveryManifest}
                    >
                      <FileCheck size={14} /> Manifest (JSON)
                    </Button>
                    <Button
                      size="sm"
                      variant="primary"
                      onClick={handleDownloadZipPackage}
                      disabled={
                        loading ||
                        activeRun.items.every(
                          (i) => i.deliverables.length === 0,
                        )
                      }
                    >
                      <Archive size={14} /> Delivery Package (.ZIP)
                    </Button>
                    {exportProgress && (
                      <>
                        <span role="status">{exportProgress}</span>
                        <Button
                          size="sm"
                          variant="subtle"
                          onClick={() => exportController.current?.abort()}
                        >
                          Cancel export
                        </Button>
                      </>
                    )}
                  </div>
                </div>

                {activeRun.deliveryManifestError && (
                  <div className="batch-alert error" role="alert">
                    {activeRun.deliveryManifestError}
                  </div>
                )}
                {/* Manifest Verification Alert */}
                {manifestVerification?.tested &&
                  manifestVerification.manifest ===
                    activeRun.deliveryManifest && (
                    <div
                      className={`batch-alert ${manifestVerification.valid ? "success" : "error"}`}
                    >
                      {manifestVerification.valid ? (
                        <>
                          <ShieldCheck size={16} />
                          <span>
                            Delivery Manifest Cryptographically Verified: All
                            deliverable SHA-256 digests match canonical manifest
                            hash ({manifestVerification.hash?.slice(0, 16)}...).
                          </span>
                        </>
                      ) : (
                        <>
                          <AlertCircle size={16} />
                          <span>
                            Delivery Manifest integrity check FAILED: digests do
                            not match.
                          </span>
                        </>
                      )}
                    </div>
                  )}

                {activeRun.items.some(item=>item.source.raw)&&<p>RAW packages include editable projects with complete sensor originals and accepted pixels, plus a checksummed preparation index.</p>}
                {/* Review Items Grid */}
                <div className="review-grid">
                  {reviewItems.map((item) => (
                    <div
                      key={item.id}
                      className={`review-card ${item.reviewState}`}
                    >
                      {item.preparation&&<Button size="sm" onClick={()=>void handleDownloadPrepared(item.id,item.name)}>{item.source.raw?'Download editable RAW project':'Download editable font project'}</Button>}
                      {item.source.raw&&<p>RAW original: {item.source.raw.originalName} · {item.source.raw.options.development.whiteBalance} WB · {item.source.raw.options.development.exposure} EV</p>}
                      <div className="review-card-header">
                        <div className="review-card-title">
                          <h4>{item.name}</h4>
                          <span className={`review-badge ${item.reviewState}`}>
                            {item.reviewState}
                          </span>
                        </div>
                        <div className="review-actions-group">
                          <button
                            type="button"
                            title="Approve"
                            className={`review-action-btn approve ${item.reviewState === "approved" ? "active" : ""}`}
                            onClick={() =>
                              handleSetReviewState(item.id, "approved")
                            }
                          >
                            <Check size={14} />
                          </button>
                          <button
                            type="button"
                            title="Reject"
                            className={`review-action-btn reject ${item.reviewState === "rejected" ? "active" : ""}`}
                            onClick={() =>
                              handleSetReviewState(item.id, "rejected")
                            }
                          >
                            <X size={14} />
                          </button>
                          <button
                            type="button"
                            title="Flag for review"
                            className={`review-action-btn flag ${item.reviewState === "flagged" ? "active" : ""}`}
                            onClick={() =>
                              handleSetReviewState(item.id, "flagged")
                            }
                          >
                            <Flag size={14} />
                          </button>
                        </div>
                      </div>

                      {/* Deliverables List for this item */}
                      <div className="deliverables-box">
                        <span className="deliverables-box-title">
                          Deliverable Variants ({item.deliverables.length})
                        </span>
                        {item.deliverables.length === 0 ? (
                          <span className="no-deliverables">
                            No deliverables rendered yet.
                          </span>
                        ) : (
                          <div className="deliverables-list">
                            {item.deliverables.map((deliv) => (
                              <div key={deliv.id} className="deliverable-row">
                                <div className="deliv-info">
                                  <span className="deliv-name">
                                    {deliv.variantName}
                                  </span>
                                  {deliv.color&&<span className="deliv-meta" title={deliv.color.warnings.join(' ')}>RGB: {deliv.color.profileName} · {deliv.color.intent}{deliv.color.blackPointCompensation?' · Black point compensation':''}{deliv.color.usesIntentFallback?' · Intent fallback':''}</span>}
                                  <span className="deliv-meta">
                                    {deliv.width}×{deliv.height} (
                                    {deliv.aspectRatio}) •{" "}
                                    {Math.round(deliv.byteLength / 1024)} KB •
                                    SHA:{" "}
                                    <code title={deliv.sha256}>
                                      {deliv.sha256.slice(0, 10)}...
                                    </code>
                                  </span>
                                </div>
                                <button
                                  type="button"
                                  className="deliv-download-btn"
                                  title="Download this variant"
                                  onClick={() =>
                                    handleDownloadDeliverable(
                                      deliv.id,
                                      deliv.fileName,
                                    )
                                  }
                                >
                                  <Download size={14} />
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Review Notes */}
                      <div className="review-notes-row">
                        <input
                          type="text"
                          placeholder="Review notes / feedback..."
                          className="review-notes-input"
                          defaultValue={item.reviewNotes || ""}
                          onBlur={(e) => {
                            if (e.target.value !== item.reviewNotes) {
                              void handleSetReviewState(
                                item.id,
                                item.reviewState,
                                e.target.value,
                              );
                            }
                          }}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="review-empty">
                <p>
                  No batch run selected. Launch a batch run to inspect and
                  review deliverables.
                </p>
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
    {rawReviews[0]&&<RawDevelopmentDialog key={rawReviews[0].name+rawReviews.length} editor={editor} file={rawReviews[0]} onClose={()=>setRawReviews([])} onApplied={()=>{}} onBusyChange={()=>{}} onQueued={source=>{setQueueItems(items=>[...items,source]);setRawReviews(files=>files.slice(1));setEstimate(null);}}/>}
  </>);
}
