import {parseFontVariations} from '../core/font-variations';
import { checkExport, type ExportControl } from "./export-control";
import type { AssetStore } from "../core/assets";
import type { DocumentData } from "../core/model";
import { allLayers } from "../core/model";
import type { DocumentRenderer } from "./renderer";
import { exportPng, encodeRgbaPng } from "./png";
import { createCanvas, release } from "./canvas";
import { exportSvgBlob } from "../core/svg-export";
import { planSvgMasks } from '../core/svg-masks';
import { prepareSvgMasks } from './svg-masks';
import {planSvgStyles} from '../core/svg-styles';
import {planSvgImages} from '../core/svg-images';
import {svgArtwork} from '../core/svg-styles';
import {captureSvgSources,prepareSvgImages} from './svg-images';
import {prepareSvgTexts} from './svg-text';
import {captureSvgFonts} from './svg-fonts';
import {characterFontFamilies} from '../core/character-layout';
import {captureRasterExportSources} from './raster-export-source';
import {captureExportFonts,captureOwnedExportFonts} from './export-fonts';
import {fontFamilyNames} from '../core/font-families';
import {documentFontFiles} from '../core/font-files';
import {planSvgTexts} from '../core/svg-text';
import {planSvgSmart,type SvgSmartPlan} from '../core/svg-smart';
import {planSvgPaint} from '../core/svg-paint';
import {planSvgComposition,type SvgCompositionPlan} from '../core/svg-composition';
import { exportPsd } from "./psd";
import { planPsdExport, type PsdExportMode } from "../core/interchange/psd/export-plan";
import {exportTiff} from './tiff';
import {validateTiffVariant,type TiffVariant} from '../core/tiff';
import {exportPdf} from './pdf';
import {pdfPageGeometry} from '../core/pdf';
import {exportAvif} from './avif';
import {avifSettings} from '../core/avif';

export type ExportFormat = "png" | "jpeg" | "webp" | "avif" | "svg" | "psd" | "psb" | "tiff" | "pdf";

import type {ColorOutput} from '../core/color/color-settings';
import {colorOutputForFormat} from './icc-output';
import {iccTarget} from '../core/color/profile-source';

export interface ExportOptions {
  color?: ColorOutput;
  format: ExportFormat;
  psdMode?: PsdExportMode;
  tiffVariant?: TiffVariant;
  pdfDpi?: number; // Physical page sizing only; native pixels are not resampled.
  quality?: number; // 0.01 to 1.0 (JPEG, WebP and AVIF)
  avifLossless?:boolean;
  avifSpeed?:number; // Integer 0 (smallest/slowest) to 10 (fastest), default 8.
  backgroundColor?: string; // background fill for JPEG (default: "#ffffff")
}

export interface ExportCapabilityReport {
  format: ExportFormat;
  warnings: string[];
  featuresPreserved: string[];
  featuresDegradedOrOmitted: string[];
}

export interface ExportResult {
  blob: Blob;
  mimeType: string;
  extension: string;
  report: ExportCapabilityReport;
}

/**
 * Produces an honest, detailed preflight capability report assessing
 * what document features are preserved or degraded/omitted when exporting
 * to the requested target format.
 */
/** Pure page report; cross-document ownership is checked by EditorApplication. */
export function getTiffPagesCapabilityReport(documents:readonly DocumentData[],variant:TiffVariant='auto',color?:ColorOutput):ExportCapabilityReport {
  validateTiffVariant(variant);
  if(!documents.length)throw new Error('Choose at least one TIFF page.');
  const reports=documents.map(document=>getExportCapabilityReport(document,{format:'tiff',tiffVariant:variant,color}));
  const unique=(values:string[])=>[...new Set(values)];
  return {format:'tiff',warnings:unique([`Exports ${documents.length} TIFF page${documents.length===1?'':'s'} in the selected order. Some viewers display only the first page.`,...reports.flatMap(report=>report.warnings.map(warning=>warning.replace('TIFF is one flattened image.','Each TIFF page is a flattened image.')))]),
    featuresPreserved:unique(['Independent native page dimensions and page order',...reports.flatMap(report=>report.featuresPreserved)]),
    featuresDegradedOrOmitted:unique(reports.flatMap(report=>report.featuresDegradedOrOmitted))};
}

export function getExportCapabilityReport(
  document: DocumentData,
  options: ExportOptions,
): ExportCapabilityReport {
  options={...options,color:colorOutputForFormat(options.format,options.color)};
  const smart=options.format==='svg'?planSvgSmart(document):undefined;
  return describeExport(document,options,smart,smart?planSvgComposition(smart.document):undefined);
}
function describeExport(document:DocumentData,options:ExportOptions,smart?:SvgSmartPlan,composition?:SvgCompositionPlan):ExportCapabilityReport{
  const authored=document;
  const hasParagraphStyleMetadata=!!document.paragraphStyles?.length||!!document.components?.some(definition=>definition.source.kind==='document'&&definition.source.document.paragraphStyles?.length);
  if(composition)document=composition.document;else if(smart)document=smart.document;
  const format = options.format;
  const layers = allLayers(document.children);
  const hasVectors = layers.some((l) => l.kind === "vector");
  const hasAdjustments = layers.some((l) => l.kind === "adjustment");
  const hasText = layers.some((l) => l.kind === "text");
  const svgFontNames=options.format==='svg'?new Set(planSvgTexts(document).flatMap(text=>characterFontFamilies(text).flatMap(fontFamilyNames))):new Set<string>();
  const embeddedSvgFonts=options.format==='svg'&&documentFontFiles(authored).some(file=>svgFontNames.has(file.resource.report.faces[0].cssFamily.toLowerCase()));

  const warnings: string[] = options.color ? [`RGB samples are converted from sRGB8 to ${iccTarget(options.color.profile).name}; its original ICC profile is embedded. Soft proofing does not affect delivery. Intent availability depends on the profile; matrix profiles may use intent fallback.`] : [];
  const featuresPreserved: string[] = [];
  const featuresDegradedOrOmitted: string[] = [];

  switch (format) {
    case 'avif': {
      const settings=avifSettings({quality:options.quality,lossless:options.avifLossless,speed:options.avifSpeed});
      featuresPreserved.push('Native document resolution and visible composition','sRGB colour identification','Lossless 8-bit alpha transparency');
      if(settings.lossless)featuresPreserved.push('Lossless 8-bit colour samples');
      else{warnings.push(`AVIF colour compression uses quality ${Math.round(settings.quality*100)}%. Colour values can change; transparency remains lossless.`);featuresDegradedOrOmitted.push('Bit-exact colour values in lossy mode');}
      warnings.push('AVIF is one flattened image and requires a compatible viewer. Save a Canoli Studio project for editable layers, text, masks, effects and original sources.');
      featuresDegradedOrOmitted.push('Editable layers, typography, vectors, masks and component links','Source EXIF/GPS, authored metadata and font files','Higher-precision, CMYK/HDR and animation');
      if(document.alphaChannels?.length)featuresDegradedOrOmitted.push('Saved alpha channels');
      break;
    }
    case "pdf": {
      let geometry:ReturnType<typeof pdfPageGeometry>|undefined;
      try{geometry=pdfPageGeometry(document.width,document.height,options.pdfDpi);}catch(error){warnings.push(error instanceof Error?error.message:String(error));}
      featuresPreserved.push('Native-resolution visible composition on one PDF page','Lossless 8-bit RGB image with a transparency soft mask',options.color?'Embedded original output ICC profile':'Embedded output sRGB ICC profile');
      if(geometry)featuresPreserved.push(`Physical page sizing at ${geometry.dpi} DPI without resampling`);
      warnings.push('PDF artwork is rasterized at document resolution. Text is not searchable or selectable, and vectors, layers, masks, effects and component links are not independently editable. Save a Canoli Studio project for full editability.');
      warnings.push('Only the canvas is exported. Hidden/off-canvas content, saved alpha channels, source EXIF/GPS, authored metadata and font files are excluded. Viewer color conversion, transparency and scaling can affect appearance.');
      warnings.push('This is an RGB PDF 1.7 raster page, not PDF/X, PDF/A, CMYK/spot-color output, bleed/trim/crop marks or a print-readiness guarantee.');
      if(geometry&&geometry.userUnit>1)warnings.push('This large physical page uses PDF UserUnit scaling and requires a compatible viewer.');
      featuresDegradedOrOmitted.push('Editable or searchable text, vector geometry and document layers','Higher precision, CMYK/spot colors and print-production conformance','Source/authored metadata, hidden artwork and saved channels');
      break;
    }
    case "tiff":
      const variant=validateTiffVariant(options.tiffVariant);
      featuresPreserved.push('Native document resolution and visible composition',options.color?'Lossless Deflate-compressed 8-bit output RGB pixels':'Lossless Deflate-compressed 8-bit sRGB pixels','Unassociated RGBA transparency',options.color?'Embedded original output ICC profile':'Embedded output sRGB ICC profile');
      warnings.push('TIFF is one flattened image. Save a Canoli Studio project for editable layers, masks, text, effects and original sources.');
      warnings.push('Resolution metadata is 72 DPI; pixel dimensions are unchanged. Source EXIF/GPS and authored metadata are not copied.');
      if(variant==='big')warnings.push('BigTIFF requires a compatible viewer. Some TIFF applications support only classic TIFF.');
      else if(variant==='auto')warnings.push('Automatic selects classic TIFF when its actual output fits; larger files use BigTIFF and require a compatible viewer.');
      else warnings.push('Classic TIFF uses 32-bit file addresses. If the output exceeds that format, choose Automatic or BigTIFF.');
      featuresDegradedOrOmitted.push('Editable layers, masks, typography, effects and component links','Higher-bit-depth and CMYK/HDR output','Source-file and authored metadata');
      if(document.alphaChannels?.length)featuresDegradedOrOmitted.push('Saved alpha channels');
      break;
    case "png":
      featuresPreserved.push(
        "Full alpha channel (transparency)",
        options.color?"Lossless encoding of converted RGB8 samples":"Lossless pixel accuracy",
        "All layer types composited",
      );
      if (hasVectors) {
        warnings.push(
          `Vector layers will be rasterized at document resolution (${document.width}×${document.height}px).`,
        );
        featuresDegradedOrOmitted.push("Vector scalability and path editing");
      }
      break;

    case "jpeg":
      const bg = options.backgroundColor || "#ffffff";
      warnings.push(
        `JPEG does not support transparency. Transparent areas will be composited over the background color (${bg}).`,
      );
      featuresPreserved.push(
        "Full RGB color gamut",
        "High compression efficiency",
      );
      featuresDegradedOrOmitted.push(
        "Alpha channel (flattened)",
        "Lossless compression (lossy compression applied)",
      );
      if (hasVectors) {
        featuresDegradedOrOmitted.push("Vector scalability and path editing");
      }
      break;

    case "webp":
      featuresPreserved.push(
        "Alpha channel (transparency)",
        "Advanced predictive compression",
        "All layer types composited",
      );
      if (options.quality !== undefined && options.quality < 1) {
        warnings.push(
          `Lossy WebP compression will be applied at quality ${Math.round(options.quality * 100)}%.`,
        );
        featuresDegradedOrOmitted.push("Lossless bit-exact reproduction");
      }
      if (hasVectors) {
        featuresDegradedOrOmitted.push("Vector scalability and path editing");
      }
      break;

    case "svg":
      if(hasParagraphStyleMetadata){
        warnings.push('SVG preserves resolved text formatting but not linked paragraph-style definitions or local-override relationships. Save a native project to retain style editing.');
        featuresDegradedOrOmitted.push('Linked paragraph styles and override relationships');
      }
      if (!document.children.some(svgArtwork)) {
        warnings.push(
          "The document contains no visible vector, raster, text or paint artwork. The resulting SVG will be an empty canvas.",
        );
      }
      if(hasVectors){
        featuresPreserved.push(
          "Infinitely scalable Bézier vector paths",
          "Fill, stroke, and stroke-width styling",
          "Editable stroke caps, joins, miter limits, dash arrays and dash offsets",
          "Editable linear and radial vector gradient fills, opacity stops and affine paint coordinates",
          "Nested group order, visibility and full affine transforms",
          "Isolated layer/group opacity, fill opacity and CSS blend modes",
        );
      }
      const rasterPlans=planSvgImages(document).filter(plan=>plan.layer.kind==='raster'&&!plan.prefix);
      if(composition?.prefixes){
        featuresPreserved.push('Native adjustment layers, pass-through groups and Blend If in document-resolution PNG prefixes');
        warnings.push(`SVG renders ${composition.prefixes} affected sibling stack(s) through the last visible clipping layer, adjustment, pass-through group or Blend If layer. Their content, masks, styles and blending are baked into document-resolution PNG pixels clipped to expanded output support. Later artwork and parent settings remain separate. Source-file metadata is excluded. Save a project for complete editability and off-support data.`);
        warnings.push(`Native backdrop stacks end at: ${composition.stacks.map(name=>JSON.stringify(name)).join(', ')}.`);
        warnings.push('Native frame rebasing and SVG mask/filter/edge sampling can change edge pixels. Choose PNG for the flattened native reference.');
        featuresDegradedOrOmitted.push('Editable adjustment/Blend If settings and artwork/masks/styles inside native backdrop prefixes');
        if(composition.wetPaint){
          featuresPreserved.push('Prepared wet-paint color and transparency in native PNG backdrop prefixes');
          featuresDegradedOrOmitted.push('Editable wet-paint operations and preceding artwork inside native backdrop prefixes');
          warnings.push('Wet-paint layers require native replacement compositing. SVG bakes the affected sibling prefix through each wet-paint layer; save a project to retain ordered operations, original sources and brush metadata.');
        }
      }
      const paintPlans=planSvgPaint(document);
      if(paintPlans.length){
        featuresPreserved.push('Editable paint dab/fill geometry, pressure/flow coverage, stroke opacity and ordered erasure masks');
        if(paintPlans.some(plan=>plan.layer.strokes.some(stroke=>stroke.kind!=='fill'&&stroke.kind!=='wet'&&stroke.texture))){
          featuresPreserved.push('Embedded native-resolution brush texture coverage images with oriented per-dab alpha masks');
          warnings.push('Textured SVG paint embeds complete source-resolution coverage images, including coverage outside visible dabs; choose PNG for flattened delivery. Original texture bytes, color channels, source identity and brush dynamics remain native-project data. Viewer image filtering and rounding can differ from the native reference.');
        }
        if(paintPlans.some(plan=>plan.layer.strokes.some(stroke=>stroke.kind==='clone')))featuresPreserved.push('Native-resolution clone snapshots with editable brush coverage and placement');
        warnings.push('SVG paint uses vector dabs/fills and ordered alpha masks, not the original brush command model. Dabs outside conservative output support are excluded. Deep eraser sequences and dense paint can exceed viewer complexity or memory limits; edge/gradient rounding can differ from native PNG. Save a project for brush settings and complete strokes.');
        featuresDegradedOrOmitted.push('Original paint command settings and off-support brush dabs');
      }
      if(smart&&(smart.expanded||smart.filtered)){
        featuresPreserved.push('Smart-object instance placement, masks, styles and supported contents');
        if(smart.expanded)featuresPreserved.push(composition?.prefixes?'Unfiltered master contents and canvas clipping, editable outside native backdrop prefixes':'Unfiltered master vector/raster/text/paint contents and editable master-canvas clipping');
        warnings.push('SVG expands smart-object instances independently. Shared master links and component identity are not retained; save a project to keep them.');
        featuresDegradedOrOmitted.push('Smart-object master links and shared component identity');
        if(smart.filtered){
          featuresPreserved.push('Native-rendered smart filters and filter masks in document-resolution PNG pixels');
          warnings.push('Active smart filters and their master contents/filter masks are baked into document-resolution PNG images clipped to expanded shadow support. Outer masks and styles remain separate outside native backdrop prefixes; save a project for editable filters and masters.');
          featuresDegradedOrOmitted.push('Editable smart filters, filter-mask geometry and filtered master contents/off-support pixels');
        }
      }
      if(planSvgTexts(document).length){
        featuresPreserved.push('Editable SVG text with measured line baselines, typography, alignment and direction');
        if(planSvgTexts(document).some(layer=>(layer.fontVariantCaps??'normal')!=='normal'||(layer.fontStretch??'normal')!=='normal')){
          featuresPreserved.push('Native capital-variant and font-stretch requests as editable SVG typography');
          warnings.push('Capital variants and font stretch request font features and matching faces. Actual glyphs, synthesis and widths depend on the receiving font and browser.');
        }
        if(planSvgTexts(document).some(layer=>parseFontVariations(layer.fontVariationSettings??'normal').length>0)){featuresPreserved.push('Declared variable-font axis requests as editable SVG typography');warnings.push('Variable axes require the embedded font and a supporting SVG viewer; font substitution or variation support can change appearance.');}
        if (planSvgTexts(document).some(layer => layer.wrapWidth != null || layer.paragraphSpacing || layer.firstLineIndent || layer.paragraphJustify==='inter-word'))
          warnings.push('Paragraph text is exported as editable positioned lines. Original paragraph reflow settings and soft-break source spacing are retained in the native project, not portable SVG layout.');
        if(planSvgTexts(document).some(layer=>layer.paragraphJustify==='inter-word'))featuresPreserved.push('Editable per-line native inter-word justification spacing');
        if(embeddedSvgFonts){featuresPreserved.push('Complete selected embedded font faces as inline SVG font resources');warnings.push('SVG includes selected embedded font bytes referenced by visible editable text. Hidden/unused faces and system font files are excluded; viewer support and shaping can differ. Save a project to retain complete original font collections.');}
        else warnings.push('SVG text references font families without embedding font files. Other viewers may substitute fonts or shape text differently, changing appearance. Choose PNG for rendered text appearance; save a project for the original text model.');
        if (planSvgTexts(document).some(layer => layer.paragraphJustify==='inter-word' || (layer.wordSpacing && /(?:^|\n)[ \t\r\f\u00a0]|[ \t\r\f\u00a0](?:\n|$)/u.test(layer.text)))) {
          warnings.push('Native Canvas and SVG text can space glyphs differently at whitespace boundaries, even with the same local font. Choose PNG for the editor’s rendered glyph appearance.');
          featuresDegradedOrOmitted.push('Guaranteed Canvas/SVG boundary-space glyph placement');
          if(planSvgTexts(document).some(layer=>layer.paragraphJustify==='inter-word'))warnings.push('Fractional text positions, tracking and nonbreaking spaces can produce additional Canvas/SVG glyph-placement differences. Save a native project for the complete text model; use PNG for the rendered appearance.');
        }
        featuresDegradedOrOmitted.push(embeddedSvgFonts?'Guaranteed cross-viewer text appearance and unembedded system font files':'Embedded font files and guaranteed cross-viewer text appearance');
      }
      if(rasterPlans.length){
        if(rasterPlans.some(plan=>!plan.rendered)){
          featuresPreserved.push('Native-resolution raster imagery as embedded PNG pixels, without original source-file metadata');
          warnings.push('SVG embeds complete decoded source images, including pixels hidden by masks or canvas clipping. Choose PNG for flattened delivery. Original source-file metadata is excluded.');
        }
        if(rasterPlans.some(plan=>plan.rendered)){
          featuresPreserved.push('Rendered raster tone effects and erasures in document-resolution PNG pixels, without original source-file metadata');
          warnings.push('Raster tone effects and erasures are baked into document-resolution PNG images clipped to the expanded output support. Save a project to retain editable raster operations and original sources.');
          featuresDegradedOrOmitted.push('Editable raster tone effects/erasures and off-support pixels of processed rasters');
        }
      }
      const vectorTree = layers.filter(layer => layer.kind === "vector" || layer.kind === "group"||layer.kind==='raster'||layer.kind==='text'||layer.kind==='smart-object'||layer.kind==='paint');
      const svgMasks=planSvgMasks(document);
      if(svgMasks.some(plan=>plan.vector))featuresPreserved.push('Editable unfeathered vector layer/group masks, density and inversion');
      if(svgMasks.some(plan=>plan.clipPath))featuresPreserved.push('Hard vector masks as editable SVG clipping paths');
      if(svgMasks.some(plan=>!plan.vector)){
        featuresPreserved.push('Native-resolution layer/group/stroke mask coverage in embedded PNG tiles');
        warnings.push('Painted, sampled, bitmap and feathered masks are embedded as native-resolution PNG coverage tiles. Artwork paths remain vectors; these masks are rasterized and may soften when enlarged.');
        featuresDegradedOrOmitted.push('Editable geometry and unlimited scaling of rasterized mask coverage');
      }
      if(planSvgStyles(document).length){
        featuresPreserved.push('Color overlays and document-space drop shadows as editable SVG filters');
        warnings.push('SVG layer effects require a viewer supporting SVG filters. Viewers may rasterize effects internally; blur, edge sampling and working-memory limits can differ from native PNG rendering.');
      }
      if (vectorTree.some(layer => layer.blendMode !== "normal"))
        warnings.push("SVG blend modes require a viewer supporting CSS mix-blend-mode and isolation. Native backdrop prefixes retain their internal blending in pixels.");
      if (document.alphaChannels?.length)
        featuresDegradedOrOmitted.push("Saved alpha channels");
      break;

    case "psd":
    case "psb":
      const label=format.toUpperCase(),plan = planPsdExport(document, options.psdMode,format);
      if(document.alphaChannels?.length){
        warnings.push(`Saved alpha channels are omitted from ${label} export. Save a Canoli Studio project to retain them.`);
        featuresDegradedOrOmitted.push('Saved alpha channels');
      }
      featuresPreserved.push(
        "Rendered composition and transparency at native document resolution",
        "8-bit RGB channels with PackBits RLE compression",
        "Embedded ICC color profile (sRGB)",
        "Merged preview with transparency",
      );
      if (document.width > (format==='psb'?300000:30000) || document.height > (format==='psb'?300000:30000))
        warnings.push(format==='psb'?'PSB dimensions cannot exceed 300,000 pixels per side. Choose another output or save a native project.':'PSD dimensions cannot exceed 30,000 pixels per side. Choose PSB, PNG or save a native project.');
      if(format==='psb')warnings.push('PSB uses large-document lengths and requires a PSB-compatible reader. This remains an 8-bit RGB pixel-layer, folder and pixel-mask subset, not editable Photoshop text, vector paths, adjustment parameters or effects. Real multi-GiB and broader reader/device/memory acceptance remain unverified.');
      if (options.psdMode === "flatten") {
        warnings.push("All visible artwork is merged into one pixel layer. Hidden content and editable layer settings are not retained.");
        featuresDegradedOrOmitted.push("Separate layers and editable effects");
      } else {
        featuresPreserved.push("Independent top-level layers retained as named pixel layers or folders", "Layer opacity and blend modes");
        featuresPreserved.push('Separate fill opacity on retained unstyled Normal pixel layers');
        if(plan.records.some(entry=>entry.kind==='group'))featuresPreserved.push('Nested folder hierarchy, supported pass-through blending, visibility and locks');
        if(plan.masks.length){
          featuresPreserved.push('Editable pixel-mask channels with retained enabled state outside normalized clipping-base coverage');
          warnings.push('Separate masks retain final native coverage as editable document-bounded pixels. Vector/selection/paint identity, linkage, density, inversion and feather controls and off-canvas mask coverage are baked.');
          featuresDegradedOrOmitted.push('Original mask geometry and coverage controls');
        }
        if(plan.records.some(entry=>entry.kind==='group'&&!entry.group.visible)||plan.layers.some(layer=>!layer.visible||layer.left<0||layer.top<0||layer.left+layer.width>document.width||layer.top+layer.height>document.height))
          warnings.push('Layered output retains independent hidden artwork and supported placed-raster pixels outside the canvas. Choose Flatten for visible-canvas-only delivery.');
        if (plan.mergedThrough >= 0) {
          warnings.push(`The bottom ${plan.mergedThrough + 1} top-level layers are merged through “${document.children[plan.mergedThrough].name}” to preserve unsupported adjustment or conditional blending appearance, including current visibility. Hidden content in that merged portion is not retained.`);
          featuresDegradedOrOmitted.push("Layer separation and adjustment settings in the merged portion");
        }
        if(plan.scopedMerges.length>(plan.mergedThrough>=0?1:0)){
          warnings.push(`Unsupported adjustment/Blend If stacks are merged within their group isolation scope: ${plan.scopedMerges.map(name=>`“${name}”`).join(', ')}.`);
          featuresDegradedOrOmitted.push('Internal layer separation and adjustment controls in merged group prefixes');
        }
        if(plan.bakedGroups.length){
          warnings.push(`Styled group contents are rendered into one pixel child inside their retained folder: ${plan.bakedGroups.map(name=>`“${name}”`).join(', ')}. Their original children, masks, fill controls and effects are baked; hidden descendants inside those contents are omitted.`);
          featuresDegradedOrOmitted.push('Original child editability and controls inside styled groups');
        }
        if(plan.foldedGroupFill.length){
          warnings.push(`Photoshop groups expose overall opacity without a separate Fill control. Canoli group fill is folded into exported group opacity: ${plan.foldedGroupFill.map(name=>`“${name}”`).join(', ')}. Save a native project for the original separate controls.`);
          featuresDegradedOrOmitted.push('Separate group fill and opacity controls');
        }
        if(plan.bakedLayerFill.length){
          warnings.push(`Non-Normal layer fill and any attached masks are baked into pixel alpha to retain Canoli appearance without assuming Photoshop fill/blend equivalence: ${plan.bakedLayerFill.map(name=>`“${name}”`).join(', ')}.`);
          featuresDegradedOrOmitted.push('Separate fill/mask controls on non-Normal layers');
        }
      }
      if (hasVectors) {
        warnings.push(
          `Vector shape layers are rasterized into pixel layers in ${label} export.`,
        );
        featuresDegradedOrOmitted.push(
          "Editable vector Bézier paths (rasterized)",
        );
      }
      if (hasText) {
        warnings.push(
          `Text layers are rendered to pixel layers in ${label} export.`,
        );
        featuresDegradedOrOmitted.push("Editable text typography (rasterized)");
      }
      if (hasAdjustments) {
        warnings.push(
          `Adjustment appearance is baked into pixels; adjustment parameters are not editable in the ${label}.`,
        );
        featuresDegradedOrOmitted.push("Non-destructive adjustment layers");
      }
      if (layers.filter(layer=>layer.kind==='group').length>plan.records.filter(entry=>entry.kind==='group').length)
        featuresDegradedOrOmitted.push('Group hierarchy inside rendered styles or merged backdrop prefixes');
      if (layers.some(layer => layer.kind === "smart-object"))
        featuresDegradedOrOmitted.push("Editable smart objects, linked sources and smart filters (rendered to pixels)");
      warnings.push("Styles, paint operations and affine transforms are rendered into pixels. Group transforms are baked into descendant pixels; supported integer group origins and ordinary placed-raster bounds are retained. Other rendered content is clipped to document support. Save .luma to retain complete source editability.");
      const retainedClipping=plan.layers.filter(layer=>layer.clipped).length,totalClipping=layers.filter(layer=>layer.clipped).length;
      if(retainedClipping){featuresPreserved.push('Editable sibling pixel clipping with grouped base blending');warnings.push(`${retainedClipping} clipping member(s) retain editable pixel-layer relationships. Base intrinsic transparency and its final mask are combined into an enabled editable pixel mask, with binary intrinsic alpha, so coverage applies once after member blending. Original separate base-mask controls are baked. Original non-pixel authoring, transforms and rendered effects retain the format limitations described above.`);}
      if(totalClipping>retainedClipping){warnings.push('Unsupported clipping stacks are rendered into merged sibling prefixes or baked group contents. Group clipping, styled bases, separate base Fill and dependent adjustments require a native project for complete editability.');featuresDegradedOrOmitted.push('Editable clipping relationships in baked portions');}
      featuresDegradedOrOmitted.push("Original affine transforms, styles, paint operations and metadata");
      break;
  }

  return {
    format,
    warnings,
    featuresPreserved,
    featuresDegradedOrOmitted,
  };
}

/**
 * Multi-format export engine supporting PNG, JPEG (with background fill),
 * WebP (with quality control), and SVG (vector extraction), accompanied
 * by an honest capability report.
 */
export async function exportDocument(
  document: DocumentData,
  assets: AssetStore,
  renderer: DocumentRenderer,
  options: ExportOptions,
  control?: ExportControl,
): Promise<ExportResult> {
  checkExport(control);
  options={...options,color:colorOutputForFormat(options.format,options.color)};
  if(options.format==='avif'){
    const report=getExportCapabilityReport(document,options),blob=await exportAvif(document,assets,renderer,{quality:options.quality,lossless:options.avifLossless,speed:options.avifSpeed},control);
    return{blob,mimeType:'image/avif',extension:'avif',report};
  }
  if(options.format==='psd'||options.format==='psb'){
    const report=getExportCapabilityReport(document,options),blob=await exportPsd(document,assets,renderer,options.psdMode,control,options.format);
    return{blob,mimeType:'image/vnd.adobe.photoshop',extension:options.format,report};
  }
  if(options.format==='pdf'){
    const report=getExportCapabilityReport(document,options);
    const blob=await exportPdf(document,assets,renderer,options.pdfDpi,control,options.color);
    return{blob,mimeType:'application/pdf',extension:'pdf',report};
  }
  // TIFF captures sources/fonts before the first user progress callback.
  if(options.format==='tiff'){
    const report=getExportCapabilityReport(document,options);
    const blob=await exportTiff(document,assets,renderer,validateTiffVariant(options.tiffVariant),control,options.color);
    return{blob,mimeType:'image/tiff',extension:'tif',report};
  }
  const smart=options.format==='svg'?planSvgSmart(document):undefined;
  const composition=smart?planSvgComposition(smart.document):undefined;
  const authored=document;if(composition)document=composition.document;
  const editableTextFamilies=options.format==='svg'?planSvgTexts(document).flatMap(characterFontFamilies):[];
  const renderedTextFamilies=options.format==='svg'?[...editableTextFamilies,...smart!.filteredTexts.flatMap(characterFontFamilies),...composition!.nativeTexts.flatMap(characterFontFamilies)]:[];
  const fonts=options.format==='svg'?captureSvgFonts(authored,assets,editableTextFamilies):undefined;
  const ownedFonts=options.format==='svg'?captureOwnedExportFonts([authored],renderedTextFamilies,assets):undefined;
  let sourceCheck:((()=>void)&{release?:()=>void})|undefined;
  try{
  sourceCheck=options.format==='svg'?captureSvgSources(document,assets,control,[...smart!.filteredAssets,...composition!.nativeAssets]):captureRasterExportSources(document,assets,control,`${options.format.toUpperCase()} export`);
  const fontSet=options.format==='svg'?captureExportFonts(renderedTextFamilies):()=>{};
  const currentSources=()=>{sourceCheck!();fonts?.check();fontSet();ownedFonts?.();};
  control?.onProgress?.({phase:"rendering",fraction:null});
  currentSources();
  const report = describeExport(authored, options,smart,composition);

  if (options.format === "svg") {
    currentSources();
    const texts=await prepareSvgTexts(document,control,currentSources,[...smart!.filteredTexts,...composition!.nativeTexts]);
    const currentSvg=()=>{currentSources();texts.check();fonts?.check();};
    const fontDefinitions=await fonts!.definitions(currentSvg);
    const hasImages=planSvgImages(document).length>0,hasNativeMasks=planSvgMasks(document).some(plan=>!plan.vector);
    const imageShare=hasImages?(hasNativeMasks?0.5:1):0;
    const stage=(start:number,share:number):ExportControl=>({signal:control?.signal,onProgress:p=>{
      currentSvg();
      if(p.phase==='rendering'&&p.fraction!==null)control?.onProgress?.({phase:'rendering',fraction:start+p.fraction*share});
    }});
    const images=await prepareSvgImages(document,assets,renderer,stage(0,imageShare),currentSvg);
    currentSvg();
    const masks=await prepareSvgMasks(document,assets,renderer,stage(imageShare,1-imageShare));
    currentSvg();
    const blob = await exportSvgBlob(document,{signal:control?.signal,onProgress:p=>{
      currentSvg();control?.onProgress?.(p);currentSvg();
    }},masks,images,texts.layouts,fontDefinitions);
    currentSvg();
    return {
      blob,
      mimeType: "image/svg+xml",
      extension: "svg",
      report,
    };
  }

  if (options.format === "png") {
    const blob = await exportPng(document, assets, renderer, control,options.color);
    return {
      blob,
      mimeType: "image/png",
      extension: "png",
      report,
    };
  }

  // JPEG or WebP raster rendering
  const { width, height } = document;
  const canvas = createCanvas(width, height);
  try {
    const ctx = canvas.getContext("2d")!;

    if (options.format === "jpeg") {
      ctx.fillStyle = options.backgroundColor || "#ffffff";
      ctx.fillRect(0, 0, width, height);
    }

    // Tiled strip rendering to avoid exceeding device GPU memory
    const rowBytes = width * 4;
    const rowsPerStrip = Math.max(
      1,
      Math.min(1024, Math.floor(4_000_000 / Math.max(1, rowBytes))),
    );
    for (let y = 0; y < height; y += rowsPerStrip) {
      currentSources();
      const rows = Math.min(rowsPerStrip, height - y);
      for (let x = 0; x < width; x += 2048) {
        const tileWidth = Math.min(2048, width - x);
        const tile = await renderer.render(document, assets, {
          region: { x, y, width: tileWidth, height: rows },
          cache: false,
          readback: true,
        });
        try {
          currentSources();
          ctx.drawImage(tile, x, y);
        } finally {
          release(tile);
        }
      }
      control?.onProgress?.({phase:"rendering",fraction:(y+rows)/height});
      currentSources();
      await new Promise<void>(resolve=>setTimeout(resolve,0));
    }

    currentSources();
    control?.onProgress?.({phase:"encoding",fraction:null});
    currentSources();
    const mimeType = options.format === "jpeg" ? "image/jpeg" : "image/webp";
    const quality = options.quality ?? (options.format === "jpeg" ? 0.92 : 0.9);
    const extension = options.format === "jpeg" ? "jpg" : "webp";

    let blob: Blob;
    if (typeof canvas.toBlob === "function") {
      blob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob(
          (b) =>
            b
              ? resolve(b)
              : reject(
                  new Error(`Failed to encode image to ${options.format}`),
                ),
          mimeType,
          quality,
        ),
      );
    } else {
      // Fallback for mock/test environments
      const imgData = ctx.getImageData(0, 0, width, height);
      const bytes = new Uint8Array(
        imgData.data.buffer,
        imgData.data.byteOffset,
        imgData.data.byteLength,
      );
      blob = await encodeRgbaPng(bytes, width, height);
    }

    currentSources();
    return {
      blob,
      mimeType,
      extension,
      report,
    };
  } finally {
    release(canvas);
  }
  }finally{sourceCheck?.release?.();ownedFonts?.release();}
}
