/**
 * Color Profile Management and Soft-Proofing Dialog (F10).
 */

import { useState } from "react";
import { Dialog } from "./Dialog";
import { Button, IconButton, Select } from "./controls";
import { Eye, Info, ShieldAlert, X } from "lucide-react";
import { STANDARD_PROFILES, parseIccProfile } from "../core/color/icc";
import type {
  ColorProfileDescriptor,
  RenderingIntent,
  SoftProofOptions,
  StandardRgbSpaceId,
} from "../core/color/types";

export interface ColorProfileDialogProps {
  currentProfileId?: StandardRgbSpaceId;
  onApplyProfile(
    profileId: StandardRgbSpaceId,
    mode: "assign" | "convert",
    intent?: RenderingIntent,
  ): void;
  onUpdateSoftProof?(options: SoftProofOptions | null): void;
  onClose(): void;
  busy?: boolean;
}

export function ColorProfileDialog({
  currentProfileId = "srgb",
  onApplyProfile,
  onUpdateSoftProof,
  onClose,
  busy = false,
}: ColorProfileDialogProps) {
  const [selectedProfile, setSelectedProfile] =
    useState<StandardRgbSpaceId>(currentProfileId);
  const [mode, setMode] = useState<"convert" | "assign">("convert");
  const [intent, setIntent] = useState<RenderingIntent>(
    "relative-colorimetric",
  );

  // Soft proofing state
  const [enableSoftProof, setEnableSoftProof] = useState(false);
  const [proofSpace, setProofSpace] = useState<StandardRgbSpaceId>("srgb");
  const [proofIntent, setProofIntent] = useState<RenderingIntent>(
    "relative-colorimetric",
  );
  const [gamutWarning, setGamutWarning] = useState(false);

  const descriptor: ColorProfileDescriptor = STANDARD_PROFILES[selectedProfile];
  const iccInfo = descriptor.iccBytes
    ? parseIccProfile(descriptor.iccBytes)
    : null;

  const handleApply = () => {
    onApplyProfile(selectedProfile, mode, intent);
    if (onUpdateSoftProof) {
      if (enableSoftProof) {
        onUpdateSoftProof({
          proofSpace,
          intent: proofIntent,
          gamutWarning,
        });
      } else {
        onUpdateSoftProof(null);
      }
    }
    onClose();
  };

  const handleToggleSoftProof = (enabled: boolean) => {
    setEnableSoftProof(enabled);
    if (onUpdateSoftProof) {
      if (enabled) {
        onUpdateSoftProof({
          proofSpace,
          intent: proofIntent,
          gamutWarning,
        });
      } else {
        onUpdateSoftProof(null);
      }
    }
  };

  const handleToggleGamutWarning = (enabled: boolean) => {
    setGamutWarning(enabled);
    if (onUpdateSoftProof && enableSoftProof) {
      onUpdateSoftProof({
        proofSpace,
        intent: proofIntent,
        gamutWarning: enabled,
      });
    }
  };

  return (
    <Dialog
      titleId="color-profile-dialog-title"
      onClose={onClose}
      className="color-profile-dialog"
    >
      <div className="dialog-header">
        <h2 id="color-profile-dialog-title">Color Settings & ICC Profile</h2>
        <IconButton label="Close" onClick={onClose} disabled={busy}>
          <X size={18} />
        </IconButton>
      </div>

      <div className="dialog-body color-profile-dialog-body">
        {/* Working Space Selection */}
        <div className="color-section">
          <Select
            label="Working RGB Space"
            layout="stacked"
            value={selectedProfile}
            disabled={busy}
            options={[
              { value: "srgb", label: "sRGB IEC61966-2.1 (Standard Web / UI)" },
              {
                value: "display-p3",
                label: "Display P3 (Wide Gamut Apple / Cinema)",
              },
              {
                value: "adobe-rgb",
                label: "Adobe RGB (1998) (Wide Gamut Prepress / CMYK)",
              },
              {
                value: "linear-srgb",
                label: "Linear sRGB (Physical Lighting / 3D)",
              },
            ]}
            onChange={(val) => setSelectedProfile(val as StandardRgbSpaceId)}
          />

          <div className="color-profile-meta">
            <p>{descriptor.description}</p>
          </div>

          <div className="profile-action-radios">
            <label className="radio-label">
              <input
                type="radio"
                name="profileMode"
                value="convert"
                checked={mode === "convert"}
                onChange={() => setMode("convert")}
                disabled={busy}
              />
              <span>
                <strong>Convert to Profile</strong> — Transform pixel color
                coordinates to preserve visual appearance.
              </span>
            </label>
            <label className="radio-label">
              <input
                type="radio"
                name="profileMode"
                value="assign"
                checked={mode === "assign"}
                onChange={() => setMode("assign")}
                disabled={busy}
              />
              <span>
                <strong>Assign Profile</strong> — Re-interpret existing pixel
                numbers under new color space.
              </span>
            </label>
          </div>

          {mode === "convert" && (
            <Select
              label="Conversion Intent"
              layout="stacked"
              value={intent}
              disabled={busy}
              options={[
                {
                  value: "relative-colorimetric",
                  label: "Relative Colorimetric (Gamut-clipped, standard)",
                },
                {
                  value: "perceptual",
                  label: "Perceptual (Compresses gamut smoothly)",
                },
                {
                  value: "absolute-colorimetric",
                  label: "Absolute Colorimetric (Preserves white point)",
                },
                {
                  value: "saturation",
                  label: "Saturation (Maximizes vividness)",
                },
              ]}
              onChange={(val) => setIntent(val as RenderingIntent)}
            />
          )}
        </div>

        {/* Profile Inspector */}
        {iccInfo && (
          <div className="icc-inspector-box">
            <h4 className="icc-inspector-title">
              <Info size={14} /> Embedded ICC Profile Details
            </h4>
            <div className="icc-inspector-grid">
              <div className="icc-field">
                <span className="icc-key">Profile Class:</span>
                <span className="icc-value">{iccInfo.header.deviceClass}</span>
              </div>
              <div className="icc-field">
                <span className="icc-key">ICC Version:</span>
                <span className="icc-value">{iccInfo.header.version}</span>
              </div>
              <div className="icc-field">
                <span className="icc-key">Color Space:</span>
                <span className="icc-value">{iccInfo.header.colorSpace}</span>
              </div>
              <div className="icc-field">
                <span className="icc-key">Connection (PCS):</span>
                <span className="icc-value">
                  {iccInfo.header.connectionSpace}
                </span>
              </div>
              <div className="icc-field">
                <span className="icc-key">PCS Illuminant:</span>
                <span className="icc-value">
                  D50 ({iccInfo.header.illuminant[0].toFixed(3)},{" "}
                  {iccInfo.header.illuminant[1].toFixed(3)},{" "}
                  {iccInfo.header.illuminant[2].toFixed(3)})
                </span>
              </div>
              <div className="icc-field">
                <span className="icc-key">Tag Count:</span>
                <span className="icc-value">
                  {Object.keys(iccInfo.tags).length} tags
                </span>
              </div>
            </div>
          </div>
        )}

        {/* Soft Proofing Controls */}
        <div className="soft-proof-section">
          <h4 className="soft-proof-title">
            <Eye size={14} /> Soft-Proofing & Gamut Simulation
          </h4>

          <label className="checkbox-control">
            <input
              type="checkbox"
              checked={enableSoftProof}
              onChange={(e) => handleToggleSoftProof(e.target.checked)}
              disabled={busy}
            />
            <span>Simulate Output Gamut (Soft Proof)</span>
          </label>

          {enableSoftProof && (
            <div className="soft-proof-controls">
              <Select
                label="Simulated Target Space"
                layout="stacked"
                value={proofSpace}
                disabled={busy}
                options={[
                  { value: "srgb", label: "sRGB (Standard consumer displays)" },
                  {
                    value: "display-p3",
                    label: "Display P3 (Wide-gamut devices)",
                  },
                  {
                    value: "adobe-rgb",
                    label: "Adobe RGB (Standard print/CMYK gamut)",
                  },
                ]}
                onChange={(val) => {
                  setProofSpace(val as StandardRgbSpaceId);
                  if (onUpdateSoftProof) {
                    onUpdateSoftProof({
                      proofSpace: val as StandardRgbSpaceId,
                      intent: proofIntent,
                      gamutWarning,
                    });
                  }
                }}
              />

              <Select
                label="Proofing Rendering Intent"
                layout="stacked"
                value={proofIntent}
                disabled={busy}
                options={[
                  {
                    value: "relative-colorimetric",
                    label: "Relative Colorimetric",
                  },
                  { value: "perceptual", label: "Perceptual" },
                  { value: "saturation", label: "Saturation" },
                  {
                    value: "absolute-colorimetric",
                    label: "Absolute Colorimetric",
                  },
                ]}
                onChange={(val) => {
                  const nextIntent = val as RenderingIntent;
                  setProofIntent(nextIntent);
                  if (onUpdateSoftProof) {
                    onUpdateSoftProof({
                      proofSpace,
                      intent: nextIntent,
                      gamutWarning,
                    });
                  }
                }}
              />

              <label className="checkbox-control gamut-warning-checkbox">
                <input
                  type="checkbox"
                  checked={gamutWarning}
                  onChange={(e) => handleToggleGamutWarning(e.target.checked)}
                  disabled={busy}
                />
                <span
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <ShieldAlert size={14} className="gamut-warning-icon" />
                  <strong>Gamut Warning</strong> — Highlight out-of-gamut pixels
                  in neon cyan overlay
                </span>
              </label>
            </div>
          )}
        </div>
      </div>

      <div className="dialog-footer color-profile-dialog-footer">
        <Button variant="secondary" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleApply} disabled={busy}>
          Apply Settings
        </Button>
      </div>
    </Dialog>
  );
}
