# Color Management and File Interchange: Feasibility Study & Prototype Architecture

**Ticket:** T17  
**Milestone:** Precedes F10 (Color Management & Precision) and F11 (Interchange & High-Fidelity Export) Claims  
**Author:** Canoli Studio Architecture Team
**Status:** Approved & Implemented in Prototype  
**Date:** 2026-09-28

Current export behavior was corrected on 2026-10-15: the browser renders all content through the editor compositor, retains independent pixel layers, merges backdrop-dependent prefixes and offers explicit flattening. Editable Photoshop text/masks/adjustments/group hierarchy and PSB output remain unsupported. Merged preview RGB is white-matted; see SCRIPTING_API.md for precision and the current supported subset. Historical prototype descriptions below do not establish professional color/interchange parity.

Current TIFF output (2026-10-17) is a flattened lossless Deflate RGBA8 sRGB image with unassociated alpha and embedded output ICC. Automatic/classic/BigTIFF choices use actual output addressing. TIFF input, higher precision/CMYK/HDR, editable/multipage output and real files exceeding 4 GiB remain unverified or unimplemented. See SCRIPTING_API.md for the exact trusted host contract.

---

## 1. Executive Summary

Ticket T17 establishes the foundational feasibility, mathematical rigor, and prototyping architecture for:

1. **F10: Professional Color Management & Precision** — Accurate mathematical conversions across standard RGB color spaces (`sRGB`, `Display P3`, `Adobe RGB 1998`, `Linear sRGB`), CIE spaces (`CIEXYZ`, `CIELAB`), and device print spaces (`DeviceCMYK`). Includes Bradford chromatic adaptation, ISO/CIE 11664-6:2014 $\Delta E_{00}$ color difference metrics, gamut boundary excursion detection, soft-proofing simulation with visual gamut warnings, and an ICC.1:2010 binary profile parser/generator.
2. **F11: File Interchange & Adobe Photoshop (PSD/PSB) Interoperability** — Specification-compliant binary parsing and serialization of Adobe Photoshop files (`8BPS` version 1 for PSD and version 2 for PSB). Includes big-endian binary stream processing, Apple PackBits RLE codecs, Image Resource Blocks (`0x040F` ICC profile, `0x03ED` resolution info), layer records, blend mode mappings, user layer masks, composite merged image fallback, bidirectional DOM bridging (`psdToDocument`, `documentToPsd`), and preflight capability reporting.

This study directly resolves Roadmap Decision **D10** ("Color/interchange work is essential later scope; exact codecs/profile libraries unresolved pending T17") and establishes the migration pathway for Phase 3 (Wide-Gamut Production Pipeline) and Phase 5 (Print Prepress & Enterprise Interchange).

---

## 2. Color Management Engine Architecture (F10)

### 2.1 Theoretical Foundations & CIE Standards

Color in Canoli Studio is treated as a physical and perceptual continuum, not merely raw $[0, 255]$ device bytes. All color conversions transition through device-independent CIE 1931 standard color spaces.

```
                      ┌──────────────────────┐
                      │    CIEXYZ (D50)      │
                      │  (Profile Connection │
                      │     Space / PCS)     │
                      └──────────┬───────────┘
                                 │
                   ▲             │ Bradford Adaptation
   Forward Matrix  │             ▼
   with D65->D50   │  ┌──────────────────────┐
   Bradford        │  │    CIEXYZ (D65)      │
                   │  └──────────┬───────────┘
                   │             │
                   │             │ EOTF / OETF
                   │             ▼
    ┌──────────────┴─────┐  ┌──────────────────────┐  ┌──────────────────────┐
    │  Working RGB Space │  │     CIELAB (D50)     │  │      DeviceCMYK      │
    │ (sRGB, P3, Adobe)  │  │(Perceptual / ΔE2000) │  │  (Subtractive Print) │
    └────────────────────┘  └──────────────────────┘  └──────────────────────┘
```

#### Illuminants & Chromatic Adaptation

- **Illuminant D65** ($x = 0.3127, y = 0.3290$): Standard daylight reference for modern displays (sRGB, Display P3, Adobe RGB 1998). $X_n = 0.95047, Y_n = 1.00000, Z_n = 1.08883$.
- **Illuminant D50** ($x = 0.3457, y = 0.3585$): Standard graphic arts/prepress reference and Profile Connection Space (PCS) for ICC profiles. $X_n = 0.96422, Y_n = 1.00000, Z_n = 0.82521$.
- **Bradford Chromatic Adaptation**: When transforming coordinates between D65 and D50 illuminants, a simple diagonal von Kries scaling in XYZ yields perceptual color shifts. The Bradford transformation shifts XYZ into a sharpened cone response domain:

$$M_{\text{BFD}} = \begin{bmatrix} 0.8951 & 0.2664 & -0.1614 \\ -0.7502 & 1.7135 & 0.0367 \\ 0.0389 & -0.0685 & 1.0296 \end{bmatrix}$$

$$\begin{bmatrix} X_{\text{D50}} \\ Y_{\text{D50}} \\ Z_{\text{D50}} \end{bmatrix} = \begin{bmatrix} 1.0478112 & 0.0228866 & -0.0501270 \\ 0.0295424 & 0.9904844 & -0.0170491 \\ -0.0092345 & 0.0150436 & 0.7521316 \end{bmatrix} \begin{bmatrix} X_{\text{D65}} \\ Y_{\text{D65}} \\ Z_{\text{D65}} \end{bmatrix}$$

### 2.2 Standard RGB Color Space Specifications

| Parameter                  | sRGB (IEC 61966-2-1)                 | Display P3 (DCI-P3 D65)              | Adobe RGB (1998)                   | Linear sRGB             |
| :------------------------- | :----------------------------------- | :----------------------------------- | :--------------------------------- | :---------------------- |
| **White Point**            | D65 (0.3127, 0.3290)                 | D65 (0.3127, 0.3290)                 | D65 (0.3127, 0.3290)               | D65 (0.3127, 0.3290)    |
| **Red Primary $(x, y)$**   | (0.6400, 0.3300)                     | (0.6800, 0.3200)                     | (0.6400, 0.3300)                   | (0.6400, 0.3300)        |
| **Green Primary $(x, y)$** | (0.3000, 0.6000)                     | (0.2650, 0.6900)                     | (0.2100, 0.7100)                   | (0.3000, 0.6000)        |
| **Blue Primary $(x, y)$**  | (0.1500, 0.0600)                     | (0.1500, 0.0600)                     | (0.1500, 0.0600)                   | (0.1500, 0.0600)        |
| **Gamut Volume (vs sRGB)** | 100%                                 | ~126%                                | ~135%                              | 100%                    |
| **Transfer Function**      | IEC piecewise ($\gamma \approx 2.2$) | IEC piecewise ($\gamma \approx 2.2$) | Simple power $\gamma = 2.19921875$ | Linear ($\gamma = 1.0$) |

#### Transfer Curves (EOTF & OETF)

- **sRGB / Display P3 Electro-Optical Transfer Function (EOTF)**:
  $$\text{linear}(V) = \begin{cases} \frac{V}{12.92} & V \le 0.04045 \\ \left(\frac{V + 0.055}{1.055}\right)^{2.4} & V > 0.04045 \end{cases}$$
- **Adobe RGB (1998) Transfer Function**:
  $$\text{linear}(V) = V^{2.19921875}, \quad \text{encoded}(L) = L^{1 / 2.19921875}$$

### 2.3 Perceptual Metrics & Gamut Evaluation

#### Delta E Formulations ($\Delta E^*$)

1. **CIE 1976 ($\Delta E\_{76}^\*$)**: Euclidean distance in CIELAB space:
   $$\Delta E_{76}^* = \sqrt{(\Delta L^*)^2 + (\Delta a^*)^2 + (\Delta b^*)^2}$$
   _Limitation:_ Perceptual non-uniformity; severely overstates color differences in high-chroma blues and understates differences in yellows.
2. **CIEDE2000 ($\Delta E\_{00}^\*$, ISO/CIE 11664-6:2014)**:
   $$\Delta E_{00}^* = \sqrt{\left(\frac{\Delta L'}{k_L S_L}\right)^2 + \left(\frac{\Delta C'}{k_C S_C}\right)^2 + \left(\frac{\Delta H'}{k_H S_H}\right)^2 + R_T \left(\frac{\Delta C'}{k_C S_C}\right)\left(\frac{\Delta H'}{k_H S_H}\right)}$$
   Includes rotation term $R_T$ to account for chromatic non-elliptical distortion in blue hues ($h' \approx 275^\circ$) and weighting functions $S_L, S_C, S_H$.

#### Gamut Excursion Detection & Soft-Proofing

- **Rendering Intent `"unclipped"`**: Standard relative-colorimetric mapping clamps out-of-gamut values to $[0, 1]$. To detect whether a color falls outside the target gamut, Canoli Studio's color engine provides an unclipped conversion mode. Coordinates falling outside $[0, 1]$ (with tolerance $\epsilon = 10^{-4}$) trigger out-of-gamut flags.
- **Soft-Proof Gamut Warning Mask**: Generates an overlay highlighting out-of-gamut pixels in neon cyan (`rgba(0, 255, 255, 255)`), providing artists with immediate feedback on out-of-gamut excursions prior to printing or web publication.

### 2.4 Binary ICC.1:2010 Profile Parser & Generator

The implemented ICC engine (`src/core/color/icc.ts`) operates directly on raw binary buffers according to the ICC.1:2010 specification:

- **128-byte Header**:
  - Profile Size (bytes 0–3, big-endian uint32)
  - CMM Type (bytes 4–7)
  - Version (bytes 8–11, e.g. `0x02100000` for v2.1, `0x04000000` for v4.0)
  - Device Class (`'scnr'`, `'mntr'`, `'prtr'`, `'spac'`)
  - Color Space (`'RGB '`, `'CMYK'`, `'GRAY'`)
  - Connection Space (`'XYZ '`, `'Lab '`)
  - Rendering Intent (bytes 64–67)
  - Illuminant D50 vector: $X=0.9642, Y=1.0, Z=0.8249$ in s15Fixed16Number format.
- **Tag Table**:
  - `desc`: Multi-localized Unicode (`'mluc'`) or ASCII text description (`'desc'`).
  - `cprt`: Copyright text.
  - `wtpt`: White point tristimulus (`'XYZ '`).
  - `rXYZ`, `gXYZ`, `bXYZ`: Chromatic primaries in PCS XYZ.
  - `rTRC`, `gTRC`, `bTRC`: Tone reproduction curves (gamma or 1D lookup tables).
- **Profile Generation**: Generates compliant standalone binary `.icc` profiles for standard spaces without external native dependencies.

---

## 3. Photoshop Interchange Engine (PSD/PSB) (F11)

### 3.1 Adobe Photoshop Binary File Format Breakdown

The Adobe Photoshop format consists of five sequential sections:

```
┌────────────────────────────────────────────────────────┐
│ 1. File Header (26 bytes)                              │
│    '8BPS', Version (1=PSD, 2=PSB), Channels, Rows, Cols│
├────────────────────────────────────────────────────────┤
│ 2. Color Mode Data Section (Length + Mode Data)        │
│    Indexed color table or duotone specifications       │
├────────────────────────────────────────────────────────┤
│ 3. Image Resources Section (Length + 8BIM Blocks)      │
│    0x040F: Embedded ICC Profile                        │
│    0x03ED: ResolutionInfo (DPI / Print Scale)          │
├────────────────────────────────────────────────────────┤
│ 4. Layer and Mask Information Section                  │
│    Layer count, records, channels, PackBits RLE pixels │
├────────────────────────────────────────────────────────┤
│ 5. Composite Image Data Section                        │
│    Full flattened document composite (raw or PackBits) │
└────────────────────────────────────────────────────────┘
```

#### PSB (Photoshop Large Document Format)

PSB supports canvas dimensions up to 300,000 pixels. The parser and stream reader dynamically handle:

- Header version check (`version === 2`).
- 64-bit length fields in place of standard 32-bit fields for the Layer and Mask Information section and individual channel data lengths.

### 3.2 PackBits RLE Compression

Photoshop standardizes on Apple PackBits run-length encoding for scanline compression:

- Byte $n$ in range $[0, 127]$: Literal run of $n + 1$ bytes follows.
- Byte $n$ in range $[-127, -1]$ (two's complement $129 \le n \le 255$): Repeat the next single byte $(-n + 1)$ times.
- Byte $n = -128$ (`0x80`): No-op byte (skipped).

Canoli Studio implements high-speed PackBits decoding and encoding (`src/core/interchange/psd/packbits.ts`) operating directly on typed byte buffers.

### 3.3 Layer Record & Channel Architecture

Each layer record specifies:

- 32-bit signed bounding box: $(\text{top}, \text{left}, \text{bottom}, \text{right})$.
- Channel count and channel IDs:
  - Channel `0`: Red channel
  - Channel `1`: Green channel
  - Channel `2`: Blue channel
  - Channel `-1`: Transparency mask (Alpha)
  - Channel `-2`: User layer mask
- Blend Mode: 4-character signature `'8BIM'` followed by blend mode key (`'norm'`, `'mul '`, `'scrn'`, `'over'`, `'dark'`, `'lite'`, `'diff'`, `'diss'`, `'colr'`, etc.).
- Opacity: $[0, 255]$ byte mapped linearly to $[0, 1]$.
- Layer Flags: Bit 0 = Transparency protected, Bit 1 = Visible, Bit 3 = Pixel data irrelevant.
- User Layer Mask: Bounding box, default color (255 for white, 0 for black), and disabled flag.

### 3.4 Bidirectional Model Mapping

```
      Photoshop Binary (8BPS)                  Canoli Studio Document Model
   ┌───────────────────────────┐           ┌───────────────────────────┐
   │ PsdParsedDocument         │           │ Document                  │
   │  - Header (width, height) │ ────────> │  - width, height, name    │
   │  - Resolution (DPI)       │           │                           │
   │  - ICC Profile Tag        │           │                           │
   │  - Layers[]               │           │  - children[]             │
   │     - Bounding Rect       │           │     - RasterLayer         │
   │     - Blend Mode          │           │        - x, y, width, h   │
   │     - Opacity             │           │        - blendMode        │
   │     - Pixel Data          │           │        - opacity          │
   │     - User Mask           │           │        - LayerMask        │
   │  - Composite Image        │           │  - AssetStore (ImageData) │
   └───────────────────────────┘           └───────────────────────────┘
```

When importing:

- If `mode: "layered"` and layers are present: Individual pixel layers are extracted into Canoli Studio `RasterLayer` entities, and pixel data is stored in the `AssetStore`.
- If `mode: "flatten"` or unsupported layer constructs exist: The high-resolution composite merged image is imported as a single background `RasterLayer`.

When exporting:

- Multi-layer compositions are rasterized and serialized into a valid `8BPS` binary file with PackBits RLE compression, embedded sRGB ICC profile (`0x040F`), ResolutionInfo (`0x03ED`), and a fully rendered composite image section ensuring compatibility with external readers (Photoshop, macOS QuickLook, InDesign).

---

## 4. Capability Matrix & Preflight Audit

The table below delineates Canoli Studio's current capability matrix for PSD interchange:

| Feature Category    | PSD Feature                                           | Import Support               | Export Support        | Preflight Classification              |
| :------------------ | :---------------------------------------------------- | :--------------------------- | :-------------------- | :------------------------------------ |
| **Document Specs**  | Version 1 (PSD, $\le 30\text{k}\times 30\text{k}$)    | Full                         | Full                  | Preserved                             |
|                     | Version 2 (PSB, $\le 300\text{k}\times 300\text{k}$)  | Full                         | Planned Phase 5       | Warning (Exports as PSD v1)           |
|                     | Resolution (DPI / 0x03ED)                             | Full                         | Full (72 DPI default) | Preserved                             |
|                     | Embedded ICC Profile (0x040F)                         | Full (Extracted & Inspected) | Full (Embedded)       | Preserved                             |
| **Color Modes**     | RGB (8-bit per channel)                               | Full                         | Full                  | Preserved                             |
|                     | RGB (16-bit per channel)                              | Downsampled to 8-bit         | Planned Phase 5       | Degraded (16-bit to 8-bit)            |
|                     | CMYK (8-bit)                                          | Composite flattened / Sim    | Planned Phase 5       | Warning (DeviceCMYK converted to RGB) |
|                     | Grayscale (8-bit)                                     | Full (Expanded to RGB)       | Planned Phase 5       | Preserved (as RGB)                    |
|                     | Indexed / Duotone / Lab                               | Flattened Composite only     | Unsupported           | Omitted (Composite used)              |
| **Layer Structure** | Raster Pixel Layers                                   | Full                         | Full                  | Preserved                             |
|                     | Blend Modes (Normal, Multiply, Screen, Overlay, etc.) | Full (Mapped to DOM)         | Full                  | Preserved                             |
|                     | Opacity (0–100%)                                      | Full                         | Full                  | Preserved                             |
|                     | User Layer Masks (Raster)                             | Full (Selection mask)        | Planned Phase 3       | Preserved / Flattened                 |
|                     | Layer Groups / Hierarchy                              | Full (Group boundaries)      | Planned Phase 3       | Flattened in prototype                |
|                     | Text Layers (Type Tool)                               | Rendered Pixels              | Planned Phase 5       | Degraded (Rasterized)                 |
|                     | Vector / Shape Layers                                 | Rendered Pixels              | Planned Phase 5       | Degraded (Rasterized)                 |
|                     | Adjustment Layers (Curves/Levels)                     | Rendered Pixels              | Planned Phase 5       | Degraded (Baked into Pixels)          |
|                     | Smart Objects / Filters                               | Rendered Pixels              | Unsupported           | Degraded (Baked into Pixels)          |

---

## 5. Production Readiness & Dependency/Licensing Review (Decision D10)

### 5.1 Evaluation of Third-Party Alternatives

Prior to building the in-tree prototype, candidate third-party libraries were evaluated against Canoli Studio's core architectural constraints:

| Library      | License | Size / Footprint    | Strengths                                     | Disqualifying Limitations                                                                                                            |
| :----------- | :------ | :------------------ | :-------------------------------------------- | :----------------------------------------------------------------------------------------------------------------------------------- |
| `ag-psd`     | MIT     | ~280 KB minified    | High feature coverage (effects, text, shapes) | Large bundle weight; couples canvas DOM to browser globals; complex internal data structures diverge from Canoli Studio's OOP model.          |
| `psd.js`     | MIT     | ~180 KB             | Node / Browser support                        | Abandoned (no updates in 7+ years); lacks 16-bit support, PSB support, and modern ICC embedding.                                     |
| `lcms2-wasm` | MIT     | ~1.8 MB WASM binary | Gold-standard LittleCMS color engine          | Heavy binary download; high initialization overhead; overkill for standard RGB/Display P3/Adobe RGB gamut mapping and soft-proofing. |
| `colorjs.io` | MIT     | ~85 KB              | Comprehensive color math                      | General-purpose library; lacks binary ICC profile parsing, PackBits codecs, and high-performance typed array batch transforms.       |

### 5.2 Resolution of Decision D10

**Decision D10 Resolution:**  
Canoli Studio will **retain its zero-dependency, specification-compliant in-tree engine** (`src/core/color/` and `src/core/interchange/psd/`) for the following strategic reasons:

1. **Auditability & Zero External Licensing Risk:** No GPL, LGPL, or restrictive Adobe patents. All code is pure TypeScript utilizing standardized binary specifications (ICC.1:2010 and Adobe Photoshop File Format Specification).
2. **Deterministic Web Worker & Sandboxed Scripting:** The engine operates entirely on `ArrayBuffer` and `Uint8Array` primitives, running seamlessly in web workers, headless Node/Vitest test suites, and browser UI threads.
3. **Tight Architectural Integration:** Directly maps PSD data structures into Canoli Studio's OOP document model (`Document`, `RasterLayer`, `LayerMask`), routing mutations through single-transaction undoable commands.
4. **Minimal Bundle Overhead:** The complete color and PSD engine adds less than 35 KB minified to the application bundle, compared to 1.8+ MB for external WASM/CMM alternatives.

---

## 6. Phased Implementation Roadmap

### Phase 3: Wide-Gamut Production Pipeline

- Target: Display P3 viewport acceleration with WebGPU color space configuration.
- Native Canvas 2D context options `{ colorSpace: "display-p3" }` where supported.
- Non-destructive user layer mask export to PSD channel `-2`.
- Layer group hierarchy preservation in PSD export.

### Phase 5: Print Prepress & Enterprise Interchange

- 16-bit and 32-bit floating point pixel pipeline (`Float32Array` tiles).
- Native CMYK channel separation export with custom ICC profile embedding (`FOGRA39`, `SWOP v2`).
- Vector shape layer (`path` and `vsms` resource blocks) round-trip interchange.
- Editable text layer (`TySh` resource block) round-trip interchange.

---

## 7. Verification & Test Evidence

The feasibility prototype is validated by comprehensive unit, integration, and end-to-end tests:

- **Color Engine Tests (`tests/color-management.test.ts`)**: 15 tests verifying transfer curves, Bradford adaptation matrices, round-trip conversions, $\Delta E_{76}$ and $\Delta E_{00}$ calculations, gamut boundary detection, gamut warning masks, and ICC binary parsing/serialization.
- **PSD Interchange Tests (`tests/psd-interchange.test.ts`)**: 11 tests verifying PackBits RLE encoding/decoding, big-endian binary stream handling, multi-layer PSD construction, round-trip fidelity, CMYK/16-bit capability reporting, and verification against synthetic disk fixtures (`basic-rgb-8bit.psd`, `cmyk-unsupported.psd`, `16bit-gradient.psd`).
- **Export Engine Tests (`tests/export.test.ts`)**: Verifying PSD export format, capability report generation, and valid MIME type output.
- **End-to-End Browser Tests (`tests/color-interchange.e2e.ts`)**: Verifying the UI Color Profile dialog, ICC tag inspection, soft-proofing toggles, PSD preflight inspection dialog, and canvas import.
