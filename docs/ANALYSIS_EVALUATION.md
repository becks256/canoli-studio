# Analysis evaluation status

Date: 2026-09-27. **T09 is incomplete.** The previous report incorrectly presented simulator outputs and constants as measured model results. Its quality, licensing, footprint and human-efficiency claims are withdrawn.

Production currently offers local statistical image-property suggestions and rough contrast-bound masks. It analyzes a decoded preview of at most 512 pixels per side; this is a working allocation budget, not an import cap. Original assets are unchanged. These heuristics do not recognize objects, read text, or produce semantic subject contours. The mask alternatives are a contrast bounding rectangle and an ellipse around that rectangle. Uniform images produce no proposed mask. Scores are internal heuristics, not calibrated probabilities.

OCR and cloud simulators live under `tests/fixtures/analysis`, are not registered by production, and are not exposed as functioning analysis controls. No cloud provider, credential, network request, or model download is configured. Registry injection supports explicit test adapters and later evaluated integrations.

The legacy-named `runHeldOutBenchmark` now reports `status: incomplete` and `corpus: synthetic-regression`. It only reports results of actual contrast-mask runs on generated pixel fixtures. Box IoU is not mask IoU or semantic segmentation quality. Remote accuracy/latency, OCR quality, semantic tagging, real-image held-out quality, peak memory, model license/retention review and human correction time are explicitly unmeasured. Correction-burden formulas in the metrics module are estimates, not observations of user time.

To complete T09, evaluate actual versioned adapters on independently annotated held-out images, retain reproducible per-image outputs and measurements, audit the exact model/runtime licenses and provider terms, and measure correction time with users. Until then, do not use the old report or synthetic tests as a release-quality gate.

Candidate acceptance maps preview coordinates to current raster placement, preserving nested position and scale. Candidates stay outside project history until accepted; reject and accept publish new snapshots, and rejected/already accepted candidates cannot be replayed. Source identity and document ownership are checked at acceptance. Existing masks are replaced only through the explicit Apply action and remain undoable.
