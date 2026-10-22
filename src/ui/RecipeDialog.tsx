import { RecipePackagesPanel } from "./RecipePackagesPanel";
import { useEffect, useId, useMemo, useState } from "react";
import { Dialog } from "./Dialog";
import { Button, IconButton, NumberField, Slider } from "./controls";
import {
  AlertCircle,
  CheckCircle2,
  CircleDot,
  Download,
  FolderOpen,
  History,
  Pause,
  Play,
  Square,
  Trash2,
  Upload,
  Workflow,
  X,
} from "lucide-react";
import type { EditorApplication } from "../editor";
import type { EditPlan, Recipe } from "../ai/recipes/types";

export interface RecipeDialogProps {
  editor: EditorApplication;
  recordingOptions:{name:string;autoParameterizeTone:boolean};
  onRecordingOptionsChange(options:RecipeDialogProps['recordingOptions']):void;
  onClose(): void;
  onRunSuccess?(recipeName: string): void;
}

export function RecipeDialog({
  editor,
  recordingOptions,
  onRecordingOptionsChange,
  onClose,
  onRunSuccess,
}: RecipeDialogProps) {
  const titleId = useId();
  const [storageError, setStorageError] = useState<string | null>(
    () => editor.recipes.storage.loadError ?? null,
  );
  const [pendingRecording, setPendingRecording] = useState(
    () => editor.recipes.pendingRecording,
  );
  const [tab, setTab] = useState<"library" | "recorder" | "packages">(
    "library",
  );

  // Recipes list
  const presets = useMemo(() => editor.recipes.getPresets(), [editor]);
  const [customRecipes, setCustomRecipes] = useState<Recipe[]>(() =>
    editor.recipes.getCustomRecipes(),
  );
  const [selectedRecipeId, setSelectedRecipeId] = useState<string>(
    presets[0]?.id ?? "",
  );

  const selectedRecipe = useMemo(() => {
    return (
      presets.find((r) => r.id === selectedRecipeId) ??
      customRecipes.find((r) => r.id === selectedRecipeId) ??
      presets[0]
    );
  }, [presets, customRecipes, selectedRecipeId]);

  // Parameters state
  const [paramValues, setParamValues] = useState<Record<string, unknown>>({});

  // Reset paramValues when recipe changes
  useEffect(() => {
    if (!selectedRecipe) return;
    const initial: Record<string, unknown> = {};
    for (const p of selectedRecipe.parameters) {
      if (p.default !== undefined) {
        initial[p.name] = p.default;
      } else if (p.type === "number") {
        initial[p.name] = p.min ?? 0;
      } else if (p.type === "boolean") {
        initial[p.name] = false;
      } else if (p.type === "choice" && p.options?.[0]) {
        initial[p.name] = p.options[0];
      } else {
        initial[p.name] = "";
      }
    }
    setParamValues(initial);
  }, [selectedRecipe]);

  // Document state subscription for live dry-run recompilation
  const [docRevision, setDocRevision] = useState(0);
  useEffect(() => {
    return editor.document.subscribe(() => {
      setDocRevision((r) => r + 1);
    });
  }, [editor]);

  // Live dry-run EditPlan
  const plan: EditPlan | null = useMemo(() => {
    if (!selectedRecipe) return null;
    try {
      return editor.recipes.compilePlan(selectedRecipe, paramValues);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        recipeId: selectedRecipe.id,
        recipeName: selectedRecipe.name,
        valid: false,
        errors: [`Dry-run compile failure: ${msg}`],
        warnings: [],
        preconditions: [
          {
            id: "compile-fail",
            description: "Compile recipe plan",
            satisfied: false,
            error: msg,
          },
        ],
        steps: [],
        resolvedCommands: [],
        summary: {
          layersAdded: 0,
          layersModified: 0,
          layersRemoved: 0,
          canvasResized: false,
          estimatedSpendCents: 0,
          requiresAI: false,
          affectedLayerNames: [],
        },
        parameterValues: paramValues,
      };
    }
  }, [selectedRecipe, paramValues, docRevision, editor]);

  // Execution state
  const [executing, setExecuting] = useState(false);
  const [executeStatus, setExecuteStatus] = useState<{
    success?: boolean;
    message?: string;
  } | null>(null);

  const handleRun = () => {
    if (!selectedRecipe || !plan || !plan.valid) return;
    setExecuting(true);
    setExecuteStatus(null);

    try {
      const result = editor.recipes.execute(selectedRecipe, paramValues);
      if (result.success) {
        setExecuteStatus({
          success: true,
          message: `Executed "${selectedRecipe.name}" successfully in 1 atomic step. Undo available with Mod+Z.`,
        });
        onRunSuccess?.(selectedRecipe.name);
      } else {
        setExecuteStatus({
          success: false,
          message: result.error ?? "Execution failed.",
        });
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setExecuteStatus({
        success: false,
        message: `Execution error: ${msg}`,
      });
    } finally {
      setExecuting(false);
    }
  };

  // Recorder state
  const [recordingState, setRecordingState] = useState(() => ({
    isRecording: editor.recipes.recorder.isRecording(),
    isPaused: editor.recipes.recorder.isPaused(),
    steps: editor.recipes.recorder.getRecordedSteps(),
    unsupported: editor.recipes.recorder.getUnsupportedCommands(),
  }));

  useEffect(() => {
    return editor.recipes.recorder.subscribe(() => {
      setRecordingState({
        isRecording: editor.recipes.recorder.isRecording(),
        isPaused: editor.recipes.recorder.isPaused(),
        steps: editor.recipes.recorder.getRecordedSteps(),
        unsupported: editor.recipes.recorder.getUnsupportedCommands(),
      });
    });
  }, [editor]);

  const {name:recordName,autoParameterizeTone:autoParamTone}=recordingOptions;

  const handleStartRecord = () => {
    try {
      editor.recipes.startRecording();
    } catch (error) {
      setStorageError(String(error));
    }
  };

  const handlePauseResumeRecord = () => {
    if (recordingState.isPaused) {
      editor.recipes.resumeRecording();
    } else {
      editor.recipes.pauseRecording();
    }
  };

  const handleStopRecord = async () => {
    try {
      const recipe = await editor.recipes.stopRecording({
        name: recordName.trim() || "Recorded Action",
        autoParameterizeTone: autoParamTone,
      });
      setCustomRecipes(editor.recipes.getCustomRecipes());
      setSelectedRecipeId(recipe.id);
      setTab(
        editor.recipes.lastSavedRecordingFormat === "package"
          ? "packages"
          : "library",
      );
      setStorageError(null);
      setPendingRecording(undefined);
    } catch (error) {
      setStorageError(String(error));
      setPendingRecording(editor.recipes.pendingRecording);
    }
  };

  // Recipe export/import
  const handleExportRecipe = (recipe: Recipe) => {
    const json = editor.recipes.exportRecipeJson(recipe);
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${recipe.name.toLowerCase().replace(/[^a-z0-9]/g, "_")}.recipe.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportRecipe = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const text = String(reader.result);
        const imported = await editor.recipes.importRecipeJson(text);
        setCustomRecipes(editor.recipes.getCustomRecipes());
        setSelectedRecipeId(imported.id);
      } catch (err: unknown) {
        alert(err instanceof Error ? err.message : String(err));
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleDeleteCustom = async (id: string) => {
    if (confirm("Delete this custom recipe?")) {
      try {
        await editor.recipes.deleteRecipe(id);
      } catch (error) {
        setStorageError(String(error));
        return;
      }
      const remaining = editor.recipes.getCustomRecipes();
      setCustomRecipes(remaining);
      if (selectedRecipeId === id) {
        setSelectedRecipeId(presets[0]?.id ?? "");
      }
    }
  };

  return (
    <Dialog titleId={titleId} onClose={onClose} className="recipe-dialog">
      <div className="recipe-dialog-header">
        <div className="recipe-dialog-title-wrap">
          <Workflow size={20} className="recipe-dialog-title-icon" />
          <div>
            <h2 id={titleId} className="recipe-dialog-title">
              Recipes & Automation
            </h2>
            <p className="recipe-dialog-subtitle">
              Deterministic macros, action recording, and dry-run change
              inspection
            </p>
          </div>
        </div>
        <IconButton label="Close" onClick={onClose}>
          <X size={16} />
        </IconButton>
      </div>

      {(storageError || pendingRecording) && (
        <div className="dryrun-alert-box error" role="alert">
          <span>
            {storageError ??
              "This recording is not saved. Retry saving or export it before closing the application."}
          </span>
          {editor.recipes.storage.loadError && (
            <>
              <Button
                onClick={() => {
                  editor.recipes.storage.reload();
                  setStorageError(editor.recipes.storage.loadError ?? null);
                  setCustomRecipes(editor.recipes.getCustomRecipes());
                }}
              >
                Retry reading recipes
              </Button>
              {editor.recipes.storage.recoverySource !== undefined && (
                <Button
                  onClick={() => {
                    const blob = new Blob(
                      [editor.recipes.storage.recoverySource!],
                      { type: "application/json" },
                    );
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement("a");
                    link.href = url;
                    link.download = "recipe-library-recovery.json";
                    link.click();
                    URL.revokeObjectURL(url);
                  }}
                >
                  Export unreadable library
                </Button>
              )}
            </>
          )}
          {pendingRecording && (
            <>
              <Button
                onClick={async () => {
                  try {
                    const recipe = await editor.recipes.savePendingRecording();
                    setCustomRecipes(editor.recipes.getCustomRecipes());
                    setSelectedRecipeId(recipe.id);
                    setPendingRecording(undefined);
                    setStorageError(null);
                    setTab(
                      editor.recipes.lastSavedRecordingFormat === "package"
                        ? "packages"
                        : "library",
                    );
                  } catch (error) {
                    setStorageError(String(error));
                  }
                }}
              >
                Retry saving recipe
              </Button>
              {editor.recipes.pendingRecordingHasAssets ? (
                <Button
                  onClick={async () => {
                    try {
                      const file =
                        await editor.recipes.exportPendingRecordingPackage();
                      const url = URL.createObjectURL(file);
                      const link = document.createElement("a");
                      link.href = url;
                      link.download = "unsaved-recording.luma-recipe";
                      link.click();
                      setTimeout(() => URL.revokeObjectURL(url), 1000);
                    } catch (error) {
                      setStorageError(String(error));
                    }
                  }}
                >
                  Export unsaved package
                </Button>
              ) : (
                <Button onClick={() => handleExportRecipe(pendingRecording)}>
                  Export unsaved recipe
                </Button>
              )}
            </>
          )}
        </div>
      )}
      {/* Mode navigation */}
      <div className="recipe-nav-tabs" role="tablist" aria-label="Recipe Modes">
        <button
          type="button"
          role="tab"
          id="recipe-tab-library"
          aria-selected={tab === "library"}
          aria-controls="recipe-panel-library"
          className={`recipe-nav-tab ${tab === "library" ? "active" : ""}`}
          onClick={() => setTab("library")}
        >
          <FolderOpen size={14} />
          <span>Recipe Library</span>
        </button>
        <button
          type="button"
          role="tab"
          id="recipe-tab-recorder"
          aria-selected={tab === "recorder"}
          aria-controls="recipe-panel-recorder"
          className={`recipe-nav-tab ${tab === "recorder" ? "active" : ""}`}
          onClick={() => setTab("recorder")}
        >
          <CircleDot
            size={14}
            className={recordingState.isRecording ? "recording-pulse-icon" : ""}
          />
          <span>
            Action Recorder
            {recordingState.isRecording && (
              <span className="recording-badge">
                REC ({recordingState.steps.length})
              </span>
            )}
          </span>
        </button>
        <button
          type="button"
          role="tab"
          id="recipe-tab-packages"
          aria-controls="recipe-panel-packages"
          aria-selected={tab === "packages"}
          className={`recipe-nav-tab ${tab === "packages" ? "active" : ""}`}
          onClick={() => setTab("packages")}
        >
          Portable packages
        </button>
      </div>

      {tab === "packages" ? (
        <RecipePackagesPanel editor={editor} currentRecipe={selectedRecipe} />
      ) : tab === "library" ? (
        <div
          className="recipe-dialog-body"
          role="tabpanel"
          id="recipe-panel-library"
          aria-labelledby="recipe-tab-library"
        >
          {/* Left Column: Preset & Custom Recipe List */}
          <div className="recipe-list-col">
            <div className="recipe-list-section-header">
              <span>Built-in Presets</span>
              <span className="recipe-count-badge">{presets.length}</span>
            </div>
            <div className="recipe-card-list">
              {presets.map((recipe) => (
                <button
                  key={recipe.id}
                  type="button"
                  className={`recipe-card ${recipe.id === selectedRecipeId ? "selected" : ""}`}
                  onClick={() => {
                    setSelectedRecipeId(recipe.id);
                    setExecuteStatus(null);
                  }}
                >
                  <div className="recipe-card-title-row">
                    <span className="recipe-card-name">{recipe.name}</span>
                    <span className="recipe-type-tag preset">Preset</span>
                  </div>
                  <div className="recipe-card-desc">{recipe.description}</div>
                  <div className="recipe-card-meta">
                    <span>
                      {recipe.steps.length} step
                      {recipe.steps.length === 1 ? "" : "s"}
                    </span>
                    <span>•</span>
                    <span>
                      {recipe.parameters.length} param
                      {recipe.parameters.length === 1 ? "" : "s"}
                    </span>
                  </div>
                </button>
              ))}
            </div>

            <div className="recipe-list-section-header custom-section">
              <span>Custom Recipes</span>
              <div className="recipe-custom-actions">
                <label
                  className="recipe-import-label"
                  title="Import Recipe JSON"
                >
                  <Upload size={13} />
                  <span>Import</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportRecipe}
                    style={{ display: "none" }}
                  />
                </label>
                <span className="recipe-count-badge">
                  {customRecipes.length}
                </span>
              </div>
            </div>

            {customRecipes.length === 0 ? (
              <div className="recipe-empty-custom">
                No custom recipes recorded yet. Switch to{" "}
                <strong>Action Recorder</strong> to create one.
              </div>
            ) : (
              <div className="recipe-card-list">
                {customRecipes.map((recipe) => (
                  <div
                    key={recipe.id}
                    className={`recipe-card ${recipe.id === selectedRecipeId ? "selected" : ""}`}
                    onClick={() => {
                      setSelectedRecipeId(recipe.id);
                      setExecuteStatus(null);
                    }}
                  >
                    <div className="recipe-card-title-row">
                      <span className="recipe-card-name">{recipe.name}</span>
                      <div className="recipe-card-btn-group">
                        <IconButton
                          label="Export Recipe"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleExportRecipe(recipe);
                          }}
                        >
                          <Download size={13} />
                        </IconButton>
                        <IconButton
                          label="Delete Recipe"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteCustom(recipe.id);
                          }}
                        >
                          <Trash2 size={13} />
                        </IconButton>
                      </div>
                    </div>
                    <div className="recipe-card-desc">{recipe.description}</div>
                    <div className="recipe-card-meta">
                      <span>
                        {recipe.steps.length} step
                        {recipe.steps.length === 1 ? "" : "s"}
                      </span>
                      <span>•</span>
                      <span>
                        {recipe.parameters.length} param
                        {recipe.parameters.length === 1 ? "" : "s"}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Right Column: Recipe Details, Parameters & Dry-Run Scorecard */}
          <div className="recipe-detail-col">
            {selectedRecipe ? (
              <>
                <div className="recipe-detail-header">
                  <div>
                    <h3 className="recipe-detail-name">
                      {selectedRecipe.name}
                    </h3>
                    <p className="recipe-detail-desc">
                      {selectedRecipe.description}
                    </p>
                  </div>
                  {selectedRecipe.tags && selectedRecipe.tags.length > 0 && (
                    <div className="recipe-tags-row">
                      {selectedRecipe.tags.map((tag) => (
                        <span key={tag} className="recipe-tag-pill">
                          #{tag}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Parameters Form */}
                {selectedRecipe.parameters.length > 0 && (
                  <div className="recipe-params-section">
                    <h4 className="recipe-section-title">Parameters</h4>
                    <div className="recipe-params-grid">
                      {selectedRecipe.parameters.map((param) => {
                        const val = paramValues[param.name];
                        return (
                          <div key={param.name} className="recipe-param-field">
                            {param.type === "number" &&
                            param.min !== undefined &&
                            param.max !== undefined ? (
                              <Slider
                                label={param.label}
                                value={
                                  typeof val === "number"
                                    ? val
                                    : Number(val) || 0
                                }
                                min={param.min}
                                max={param.max}
                                step={param.step ?? 0.1}
                                onPreview={(next) =>
                                  setParamValues((p) => ({
                                    ...p,
                                    [param.name]: next,
                                  }))
                                }
                                onCommit={(next) =>
                                  setParamValues((p) => ({
                                    ...p,
                                    [param.name]: next,
                                  }))
                                }
                              />
                            ) : param.type === "number" ? (
                              <NumberField
                                label={param.label}
                                value={
                                  typeof val === "number"
                                    ? val
                                    : Number(val) || 0
                                }
                                min={param.min ?? -10000}
                                max={param.max ?? 10000}
                                step={param.step ?? 1}
                                onChange={(next) =>
                                  setParamValues((p) => ({
                                    ...p,
                                    [param.name]: next,
                                  }))
                                }
                              />
                            ) : param.type === "choice" && param.options ? (
                              <label className="field-label">
                                <span>{param.label}</span>
                                <select
                                  className="select"
                                  value={String(val ?? "")}
                                  onChange={(e) =>
                                    setParamValues((p) => ({
                                      ...p,
                                      [param.name]: e.target.value,
                                    }))
                                  }
                                >
                                  {param.options.map((opt) => (
                                    <option key={opt} value={opt}>
                                      {opt}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            ) : param.type === "boolean" ? (
                              <label className="checkbox-field">
                                <input
                                  type="checkbox"
                                  checked={Boolean(val)}
                                  onChange={(e) =>
                                    setParamValues((p) => ({
                                      ...p,
                                      [param.name]: e.target.checked,
                                    }))
                                  }
                                />
                                <span>{param.label}</span>
                              </label>
                            ) : (
                              <label className="field-label">
                                <span>{param.label}</span>
                                <input
                                  type="text"
                                  className="input"
                                  value={String(val ?? "")}
                                  placeholder={param.description ?? ""}
                                  onChange={(e) =>
                                    setParamValues((p) => ({
                                      ...p,
                                      [param.name]: e.target.value,
                                    }))
                                  }
                                />
                              </label>
                            )}
                            {param.description && param.type !== "string" && (
                              <span className="param-help-text">
                                {param.description}
                              </span>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* Dry-Run Inspection Card / Scorecard */}
                <div className="recipe-dryrun-section">
                  <div className="recipe-dryrun-header">
                    <h4 className="recipe-section-title">
                      Dry-Run Inspection & Preconditions
                    </h4>
                    {plan && (
                      <span
                        className={`dryrun-status-badge ${plan.valid ? "valid" : "invalid"}`}
                      >
                        {plan.valid ? (
                          <>
                            <CheckCircle2 size={13} />
                            <span>Valid - Ready to Run</span>
                          </>
                        ) : (
                          <>
                            <AlertCircle size={13} />
                            <span>Precondition Failed</span>
                          </>
                        )}
                      </span>
                    )}
                  </div>

                  {plan && (
                    <>
                      {/* Summary scorecard metrics */}
                      <div className="dryrun-scorecard-grid">
                        <div className="dryrun-score-card">
                          <span className="dryrun-score-label">
                            Layers Added
                          </span>
                          <span className="dryrun-score-val positive">
                            +{plan.summary.layersAdded}
                          </span>
                        </div>
                        <div className="dryrun-score-card">
                          <span className="dryrun-score-label">
                            Layers Modified
                          </span>
                          <span className="dryrun-score-val accent">
                            {plan.summary.layersModified}
                          </span>
                        </div>
                        <div className="dryrun-score-card">
                          <span className="dryrun-score-label">
                            Layers Removed
                          </span>
                          <span className="dryrun-score-val warning">
                            {plan.summary.layersRemoved}
                          </span>
                        </div>
                        <div className="dryrun-score-card">
                          <span className="dryrun-score-label">
                            Estimated Spend
                          </span>
                          <span className="dryrun-score-val neutral">
                            $
                            {(plan.summary.estimatedSpendCents / 100).toFixed(
                              2,
                            )}
                          </span>
                        </div>
                      </div>

                      {/* Precondition error alerts */}
                      {plan.errors.length > 0 && (
                        <div className="dryrun-alert-box error">
                          <AlertCircle size={15} />
                          <div>
                            <strong>Validation Issues:</strong>
                            <ul className="dryrun-alert-list">
                              {plan.errors.map((err, i) => (
                                <li key={i}>{err}</li>
                              ))}
                            </ul>
                          </div>
                        </div>
                      )}

                      {/* Step-by-step visual change breakdown */}
                      <div className="dryrun-steps-list">
                        <span className="dryrun-steps-title">
                          Planned Execution Sequence ({plan.steps.length}{" "}
                          operation{plan.steps.length === 1 ? "" : "s"}):
                        </span>
                        {plan.steps.map((st, i) => (
                          <div
                            key={st.stepId}
                            className={`dryrun-step-row ${st.skipped ? "skipped" : ""}`}
                          >
                            <span className="dryrun-step-idx">{i + 1}</span>
                            <div className="dryrun-step-content">
                              <div className="dryrun-step-name-row">
                                <span className="dryrun-step-name">
                                  {st.stepName}
                                </span>
                                {st.resolvedTargetName && (
                                  <span className="dryrun-target-badge">
                                    Target: {st.resolvedTargetName}
                                  </span>
                                )}
                              </div>
                              <span className="dryrun-step-change">
                                {st.expectedVisualChange}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>

                {/* Status message */}
                {executeStatus && (
                  <div
                    className={`dryrun-alert-box ${executeStatus.success ? "success" : "error"}`}
                  >
                    {executeStatus.success ? (
                      <CheckCircle2 size={16} />
                    ) : (
                      <AlertCircle size={16} />
                    )}
                    <span>{executeStatus.message}</span>
                  </div>
                )}

                {/* Footer Action Bar */}
                <div className="recipe-action-footer">
                  <div className="recipe-footer-meta">
                    <History size={14} />
                    <span>
                      Single-transaction commit (1-step undo with Mod+Z)
                    </span>
                  </div>
                  <Button
                    variant="primary"
                    disabled={!plan || !plan.valid || executing}
                    onClick={handleRun}
                  >
                    <Play size={14} />
                    <span>{executing ? "Executing..." : "Run Recipe"}</span>
                  </Button>
                </div>
              </>
            ) : (
              <div className="recipe-select-prompt">
                Select a recipe from the library on the left to inspect and
                execute it.
              </div>
            )}
          </div>
        </div>
      ) : (
        /* Action Recorder View */
        <div
          className="recorder-view-body"
          role="tabpanel"
          id="recipe-panel-recorder"
          aria-labelledby="recipe-tab-recorder"
        >
          <div className="recorder-control-banner">
            <div className="recorder-status-block">
              <div className="recorder-live-indicator">
                <span
                  className={`recording-dot ${recordingState.isRecording ? "active" : ""}`}
                />
                <span className="recorder-status-text">
                  {recordingState.isRecording
                    ? "Recording Actions Live..."
                    : recordingState.isPaused
                      ? "Recording Paused"
                      : "Ready to Record"}
                </span>
              </div>
              <p className="recorder-help-text">
                All document operations (tone adjustments, duplicates, layer
                transforms, canvas resizing) are intercepted and translated into
                portable semantic recipes.
              </p>
            </div>

            <div className="recorder-btn-toolbar">
              {!recordingState.isRecording ? (
                <Button variant="primary" onClick={handleStartRecord}>
                  <CircleDot size={15} />
                  <span>Start Recording</span>
                </Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={handlePauseResumeRecord}>
                    {recordingState.isPaused ? (
                      <>
                        <Play size={14} />
                        <span>Resume</span>
                      </>
                    ) : (
                      <>
                        <Pause size={14} />
                        <span>Pause</span>
                      </>
                    )}
                  </Button>
                  <Button variant="primary" onClick={handleStopRecord}>
                    <Square size={14} />
                    <span>Stop & Save Recipe</span>
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Recorder configuration */}
          <div className="recorder-settings-panel">
            <div className="recorder-field-row">
              <label className="field-label">
                <span>Recipe Name</span>
                <input
                  type="text"
                  className="input"
                  value={recordName}
                  onChange={(e) => onRecordingOptionsChange({...recordingOptions,name:e.target.value})}
                  placeholder="e.g. Vintage Poster Color Grade"
                />
              </label>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={autoParamTone}
                  onChange={(e) => onRecordingOptionsChange({...recordingOptions,autoParameterizeTone:e.target.checked})}
                />
                <span>
                  Auto-parameterize tone adjustments (exposure, contrast,
                  saturation)
                </span>
              </label>
            </div>
          </div>

          {recordingState.unsupported.length > 0 && (
            <p role="alert">
              This recording cannot be saved because it includes unsupported
              commands: {recordingState.unsupported.join(", ")}.
            </p>
          )}
          {/* Recorded steps stream */}
          <div className="recorder-steps-stream">
            <div className="recorder-stream-header">
              <span>Captured Steps ({recordingState.steps.length})</span>
              {recordingState.steps.length > 0 && (
                <span className="recorder-stream-hint">
                  Target bindings are semantic and portable across documents
                </span>
              )}
            </div>

            {recordingState.steps.length === 0 ? (
              <div className="recorder-empty-placeholder">
                <Workflow size={32} className="recorder-placeholder-icon" />
                <p>No actions captured yet.</p>
                <span>
                  Click <strong>Start Recording</strong>, then perform edits on
                  your document. Your operations will appear here in real-time.
                </span>
              </div>
            ) : (
              <div className="recorder-stream-list">
                {recordingState.steps.map((step, idx) => (
                  <div key={step.id} className="recorder-step-card">
                    <span className="recorder-step-num">{idx + 1}</span>
                    <div className="recorder-step-info">
                      <div className="recorder-step-title-row">
                        <strong className="recorder-step-title">
                          {step.name}
                        </strong>
                        {step.target?.role && (
                          <span className="semantic-target-pill role">
                            Role: {step.target.role}
                          </span>
                        )}
                        {step.target?.by === "name" && (
                          <span className="semantic-target-pill name">
                            Match: "{step.target.pattern}"
                          </span>
                        )}
                        {step.outputVar && (
                          <span className="semantic-target-pill output">
                            Produces: {step.outputVar}
                          </span>
                        )}
                      </div>
                      <div className="recorder-step-details">
                        Action: <code>{step.action.type}</code>
                        {step.action.type === "layer.update" && (
                          <span>
                            {" "}
                            — Patch: {Object.keys(step.action.patch).join(", ")}
                          </span>
                        )}
                        {step.action.type === "effect.tone" && (
                          <span>
                            {" "}
                            — Tone: {JSON.stringify(step.action.values)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}
