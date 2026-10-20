# Color Management and File Interchange: Feasibility Study & Prototype Architecture

**Ticket:** T17  
**Milestone:** Precedes F10 (Color Management & Precision) and F11 (Interchange & High-Fidelity Export) Claims  
**Author:** Canoli Studio Architecture Team
**Status:** Approved & Implemented in Prototype  
**Date:** 2026-09-28

Current Photoshop export renders through the native compositor and offers explicit flattening. PSD/PSB layers now retain supported nested folders, ordinary/pass-through modes, pixel child records and document-bounded user pixel-mask coverage. Group fill folds into opacity; only unstyled Normal pixel fill remains separate, with non-Normal fill/masks and unsupported effects/dependencies baking in real isolation scopes. Original mask controls/linkage/off-canvas coverage, native type/vector/adjustment/effect controls and broader color/precision/desktop fidelity remain unproven. PSB uses eight-byte section/channel lengths and four-byte RLE rows. White-matted merged-preview precision and normative limits are in SCRIPTING_API.md. Historical prototype descriptions below do not establish professional color/interchange parity.

Current TIFF output (2026-10-17) is a flattened lossless Deflate RGBA8 sRGB image with unassociated alpha and embedded output ICC. Automatic/classic/BigTIFF choices use actual output addressing. Input supports a reported unsigned RGB/grayscale/palette/bilevel raw/LZW/Deflate/PackBits strip/tile/planar subset, either endian and orientations 1–8, with explicit selected page and 16-bit-to-8-bit consent. Original bytes and decode settings persist separately from decoded editing pixels. RGB ICC is delegated to browser color management; this is not broader profile conformance. Higher precision editing/CMYK/HDR, JPEG/fax input, editable/multipage output, real files exceeding 4 GiB and broad device/color/heap gates remain unverified or unimplemented. See SCRIPTING_API.md for the exact trusted host contracts.

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

## Raster PDF delivery and output-profile correction

PDF delivery now supports one native-resolution lossless RGB raster page, transparency soft mask, output sRGB ICC and DPI-based physical sizing. Canonical tiled readback feeds row-streamed RGB/alpha compression; a single PDF image placement avoids independent tile edge shifts. PDF/X/PDF/A, CMYK/spot colors, bleed/trim, searchable/editable content, import, batch and server rendering remain outside this increment. Independent MuPDF decoding/rendering and exact stored samples are the current verification boundary, not universal viewer/print/device/heap conformance. The writer's large-offset tests are synthetic; actual multi-GiB output remains unverified.

That independent reader exposed a prior output-profile error: generated sRGB/P3 profiles encoded gamma 2.2, while native pixels use the sRGB piecewise curve. Future profiles now use 4,096-entry ICC-v2 curve tables, including the dark toe. Adobe RGB's gamma and linear-sRGB identity are retained. Independent LittleCMS sample conversion checks sRGB exports; broader P3/device/profile conformance remains open. Original source profiles and previously exported files are not modified. This shared output-profile repair also affects newly generated TIFF/PSD profiles and requires their regression suites.

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

The table below is the historical prototype capability matrix, not the current acceptance matrix. The current rendered PSD/PSB boundary is specified in SCRIPTING_API.md; wider color/editability claims in this table remain unverified.

| Feature Category    | PSD Feature                                           | Import Support               | Export Support        | Preflight Classification              |
| :------------------ | :---------------------------------------------------- | :--------------------------- | :-------------------- | :------------------------------------ |
| **Document Specs**  | Version 1 (PSD, $\le 30\text{k}\times 30\text{k}$)    | Full                         | Full                  | Preserved                             |
|                     | Version 2 (PSB, $\le 300\text{k}\times 300\text{k}$)  | RGB8 subset; memory dependent | Rendered RGB8 subset | PSB-compatible reader required       |
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
- Implemented RGB8 subset: separate user pixel-mask coverage in channel `-2`; original mask controls/off-canvas fidelity remain open.
- Implemented supported nested PSD/PSB folder records; native effects/type/adjustments and broader Photoshop hierarchy fidelity remain open.

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


### Current PSB verification boundary

The browser rendered writer extends the [Adobe Photoshop file format](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/) version-2 length/RLE rules. Independent tests use released psd-tools 1.10.9 in a temporary environment, not an application dependency. The newer 1.24.0 reader rejects axes beyond 30,000 even for version 2; this reader limitation is recorded rather than treating failure as an editor dimension cap. Independent external RLE fixtures exercise 30,001 and 100,000 pixel axes, including rows larger than 65,535 compressed bytes. Small layered cases force independent recomposition; large flattened cases compare native decoded layer/merged samples to PNG. These are encoded RGB8 tests with reader ICC conversion disabled, not Photoshop desktop, complete color/editability, real multi-GiB, physical-device or peak-memory acceptance.


### Current Photoshop input execution boundary

The browser now performs full parse and PNG staging in cancellable private workers, returning only metadata for preflight. It still materializes input/decoded planes and does not reconstruct full Photoshop group/mask/color/precision semantics. Reports now identify inspected-but-unapplied/unretained ICC data, prototype unverified CMYK interpretation, rectangular mask coverage and omitted group appearance; these are explicit remaining fidelity gates, not completed color work. Low-level synchronous helpers remain separate. See SCRIPTING_API.md for host signatures, legacy buffer/result ownership, errors and memory boundaries.


### Eight-bit Photoshop ZIP input

The trusted worker path now decodes native zlib ZIP and byte-predicted ZIP in 8-bit RGB/Gray PSD/PSB layer and merged channels. The shared parser preserves unsupported ZIP reports for synchronous adapters and higher precision. Independent psd-tools fixtures cover RGB/Gray alpha, prediction/channel/row boundaries, 100,000-pixel PSB rows and native 50 MP ZIP source pixels. No claim of high-precision/CMYK/HDR, ICC application, full editable mask/group semantics, whole-file streaming, original-container retention or independent Photoshop desktop acceptance follows from codec support. Adobe defines compression codes and planar merged ordering in its [file-format specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/); predictor fixtures use released psd-tools without the app codec.


Supported eight-bit Photoshop user-mask channels now retain independent pixel coverage through the existing native bitmap-mask and asset transport. Original-resolution source grids, bounds, black/white outside coverage, inversion, disabled state, density and coordinate planes are retained. Nonzero Photoshop feather and extended/combined/rendered/vector masks remain explicit unsupported layered paths; a supplied merged image can still import. Separate UI linkage metadata, full desktop/color/precision semantics and whole-process memory acceptance are not established by independent codec/source-grid tests.


### Current hierarchy increment (2026-10-17)

The earlier prototype group-import limitation is superseded for supported nested PSD/PSB raster groups: native OO hierarchy/order/placement, group opacity/visibility, ordinary/pass-through modes, conservative locks and supported user pixel masks now persist. Source PNGs and native group state survive project/workspace transport. Native pass-through currently uses Canvas/WASM fallback and rejects incompatible own fill/styles. Rendered PSD/PSB/SVG output bakes the dependent backdrop prefix; editable Photoshop group output is still unsupported. This does not establish full Photoshop effects/clipping/type/vector/feather/ICC/precision fidelity, complete container retention, streamed-file memory bounds or desktop/hardware/device interoperability.
