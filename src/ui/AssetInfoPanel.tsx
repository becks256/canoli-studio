import { useState, useSyncExternalStore } from "react";
import type { ImageAsset } from "../core/assets";
import type { MetadataService } from "../intelligence/metadata/service";
import { metadataSidecar } from "../intelligence/metadata/model";
import type { Document, Layer } from "../dom";
import type { AnalysisService } from "../intelligence/candidates/service";
import type { AnalysisModality } from "../intelligence/adapters/types";
import { Button, TextInput, TextArea } from "./controls";
import { download, fileName } from "./utils";

import type { AnalysisCandidate } from "../intelligence/candidates/types";

const EMPTY_SUBSCRIBE = () => () => {};
const EMPTY_CANDIDATES: AnalysisCandidate[] = [];
const IDLE_ANALYSIS_STATE: { running: boolean; error?: string } = {
  running: false,
};

export function AssetInfoPanel({
  asset,
  service,
  analysis,
  layer,
  hasAuthoredMetadata,
  document,
  disabled,
  onAttempt,
}: {
  asset: ImageAsset;
  service: MetadataService;
  analysis?: AnalysisService;
  layer: Layer;
  hasAuthoredMetadata: boolean;
  document?: Document;
  disabled: boolean;
  onAttempt(action: () => void): void;
}) {
  const authored = layer.metadata.toJSON();
  const state = useSyncExternalStore(service.subscribe, () =>
    service.get(asset.id),
  );
  const [attribution, setAttribution] = useState(true);
  const [privateFields, setPrivateFields] = useState(false);

  const candidates = useSyncExternalStore(
    analysis?.subscribe ?? EMPTY_SUBSCRIBE,
    () => (analysis ? analysis.getCandidates(layer.id) : EMPTY_CANDIDATES),
  );
  const analysisState = useSyncExternalStore(
    analysis?.subscribe ?? EMPTY_SUBSCRIBE,
    () => (analysis ? analysis.getState(layer.id) : IDLE_ANALYSIS_STATE),
  );

  const handleRun = async (modality: AnalysisModality) => {
    if (!analysis) return;
    try {
      await analysis.runAnalysis(layer, asset, modality, "local");
    } catch {
      // Errors are published to analysisState
    }
  };

  return (
    <section className="asset-info" aria-label="Asset information">
      <details>
        <summary>Asset info</summary>
        <p>
          Extracted locally from the original file. Embedded declarations may be
          inaccurate; no AI analysis or upload is used.
        </p>
        <h3>Authored description</h3>
        <p>
          Saved on this layer. Original file declarations below remain
          unchanged.
        </p>
        {(["title", "creator", "copyright", "license"] as const).map((key) => (
          <TextInput
            key={key}
            label={`Metadata ${key}`}
            value={authored[key]}
            disabled={disabled}
            layout="stacked"
            onCommit={(value) =>
              onAttempt(() => layer.metadata.update({ [key]: value }))
            }
          />
        ))}
        <TextArea
          label="Metadata description"
          value={authored.description}
          disabled={disabled}
          onCommit={(value) =>
            onAttempt(() => (layer.metadata.description = value))
          }
        />
        <TextArea
          label="Metadata alt text"
          value={authored.altText}
          disabled={disabled}
          onCommit={(value) =>
            onAttempt(() => (layer.metadata.altText = value))
          }
        />
        <TextInput
          label="Metadata keywords (comma-separated)"
          value={authored.keywords.join(", ")}
          disabled={disabled}
          layout="stacked"
          onCommit={(value) =>
            onAttempt(
              () =>
                (layer.metadata.keywords = [
                  ...new Set(
                    value
                      .split(",")
                      .map((word) => word.trim())
                      .filter(Boolean),
                  ),
                ]),
            )
          }
        />
        <Button
          disabled={disabled || !hasAuthoredMetadata}
          variant="subtle"
          onClick={() => onAttempt(() => layer.metadata.reset())}
        >
          Clear authored metadata
        </Button>

        {analysis && document && (
          <section
            className="analysis-section"
            aria-label="Content analysis and candidate suggestions"
          >
            <h3>Content analysis & candidates</h3>
            <p>
              Suggests image properties and rough contrast masks. Candidates
              remain staged proposals until explicitly accepted.
            </p>
            <p>
              Local pixel heuristics only. OCR and cloud analysis are
              unavailable until evaluated adapters are integrated.
            </p>
            <div className="analysis-button-row">
              <Button
                variant="subtle"
                disabled={disabled || analysisState.running}
                onClick={() => handleRun("tagging")}
              >
                Suggest keywords
              </Button>
              <Button
                variant="subtle"
                disabled={disabled || analysisState.running}
                onClick={() => handleRun("segmentation")}
              >
                Propose contrast mask
              </Button>
            </div>
            {analysisState.running && (
              <p role="status">Analyzing local pixels…</p>
            )}
            {analysisState.error && <p role="alert">{analysisState.error}</p>}
            {candidates.length > 0 && (
              <div
                role="region"
                className="candidate-shelf"
                aria-label="Analysis candidate shelf"
              >
                <h4>
                  Proposed candidates (
                  {candidates.filter((c) => c.status === "proposed").length})
                </h4>
                {candidates.map((cand) => (
                  <div
                    key={cand.id}
                    className={`candidate-card candidate-${cand.status}`}
                  >
                    <div className="candidate-header">
                      <span className="candidate-kind-badge">
                        {cand.kind === "tag"
                          ? "Keyword"
                          : cand.kind === "ocr"
                            ? "OCR Text"
                            : "Subject Mask"}
                      </span>
                      <span className="candidate-origin-badge">
                        {cand.origin === "local" ? "Local" : "Remote"}
                      </span>
                      <span className="candidate-confidence-badge">
                        Heuristic suggestion
                      </span>
                    </div>
                    <div className="candidate-body">
                      {cand.kind === "tag" && (
                        <p className="candidate-preview">
                          Keyword: <strong>{cand.tag}</strong>
                        </p>
                      )}
                      {cand.kind === "ocr" && (
                        <div className="candidate-preview">
                          <p>"{cand.text}"</p>
                          <small>
                            Box: {cand.bounds.width}×{cand.bounds.height} at (
                            {cand.bounds.x}, {cand.bounds.y})
                          </small>
                        </div>
                      )}
                      {cand.kind === "segmentation" && (
                        <div className="candidate-preview">
                          <p>{cand.label}</p>
                          <small>
                            Bounds: {cand.bounds.width}×{cand.bounds.height}
                          </small>
                        </div>
                      )}
                    </div>
                    <div className="candidate-actions">
                      {cand.status === "proposed" ? (
                        <>
                          <Button
                            variant="primary"
                            disabled={disabled}
                            onClick={() =>
                              onAttempt(() =>
                                analysis.acceptCandidate(
                                  document,
                                  cand,
                                  cand.kind === "ocr"
                                    ? "text-layer"
                                    : undefined,
                                ),
                              )
                            }
                          >
                            {cand.kind === "tag"
                              ? "Accept keyword"
                              : cand.kind === "ocr"
                                ? "Add text layer"
                                : "Apply layer mask"}
                          </Button>
                          {cand.kind === "ocr" && (
                            <Button
                              variant="subtle"
                              disabled={disabled}
                              onClick={() =>
                                onAttempt(() =>
                                  analysis.acceptCandidate(
                                    document,
                                    cand,
                                    "selection",
                                  ),
                                )
                              }
                            >
                              Select region
                            </Button>
                          )}
                          <Button
                            variant="subtle"
                            disabled={disabled}
                            onClick={() => analysis.rejectCandidate(cand)}
                          >
                            Reject
                          </Button>
                        </>
                      ) : (
                        <span className="candidate-status-label">
                          {cand.status === "accepted"
                            ? "Accepted ✓"
                            : "Rejected ✗"}
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )}

        <h3>Original file declarations</h3>
        {(!state || state.status === "pending") && (
          <p role="status">Reading metadata…</p>
        )}
        {state?.status === "error" && <p role="alert">{state.message}</p>}
        {state?.status === "ready" && (
          <>
            {state.result.warnings.map((warning) => (
              <p role="status" key={warning}>
                {warning}
              </p>
            ))}
            <dl>
              {state.result.fields.map((field) => (
                <div key={field.id}>
                  <dt>
                    {field.label}
                    <small>
                      {field.origin === "computed"
                        ? "File fact"
                        : `File declaration · ${field.namespace}`}{" "}
                      {field.privacy === "private" ? "· Private" : ""}
                    </small>
                  </dt>
                  <dd>
                    {Array.isArray(field.value)
                      ? field.value.join(", ")
                      : String(field.value)}
                  </dd>
                </div>
              ))}
            </dl>
            <p>
              Sidecar policy: include technical fields. Original image bytes and
              embedded metadata are never rewritten.
            </p>
            <label>
              <input
                type="checkbox"
                checked={attribution}
                onChange={(event) => setAttribution(event.target.checked)}
              />{" "}
              Include attribution declarations
            </label>
            <label>
              <input
                type="checkbox"
                checked={privateFields}
                onChange={(event) => setPrivateFields(event.target.checked)}
              />{" "}
              Include private fields (authored descriptions, names, dates, GPS
              and other declarations)
            </label>
            <Button
              onClick={() =>
                download(
                  new Blob(
                    [
                      JSON.stringify(
                        metadataSidecar(
                          state.result,
                          { attribution, private: privateFields },
                          authored,
                        ),
                        null,
                        2,
                      ),
                    ],
                    { type: "application/json" },
                  ),
                  `${fileName(asset.name)}.metadata.json`,
                )
              }
            >
              Export metadata sidecar
            </Button>
          </>
        )}
      </details>
    </section>
  );
}
