import type { LayerData, ToneEffectData } from "../../core/model";
import type { EditorCommand } from "../../core/commands";
import type { SelectionData } from "../../core/drawing";
import type {ParagraphFormat} from '../../core/paragraph-styles';

/** Recipe references never contain a source document's style identity. */
export type RecipeParagraphStyleTarget =
  | {by:'name';name:string}
  | {by:'stepResult';stepId:string};
export type RecipeParagraphFormat = {[K in keyof ParagraphFormat]:ParagraphFormat[K]|string};
export interface RecipeParagraphBase {style:RecipeParagraphStyleTarget;overrides:Partial<RecipeParagraphFormat>}

export const RECIPE_SCHEMA_VERSION = 1;

export type RecipeParameterType =
  "string" | "number" | "boolean" | "layer" | "color" | "choice";

export interface RecipeParameter {
  name: string;
  label: string;
  type: RecipeParameterType;
  default?: unknown;
  description?: string;
  required?: boolean;
  options?: string[]; // for "choice" type
  min?: number; // for "number" type
  max?: number;
  step?: number;
}

export type AmbiguityStrategy = "first" | "fail";

export interface SemanticTarget {
  role?:
    | "selected"
    | "background"
    | "topmost"
    | "bottommost"
    | "foreground"
    | "all"
    | "active-mask";
  by?: "name" | "kind" | "tag" | "stepResult" | "parameter";
  literal?: boolean; // exact case-sensitive name; no wildcard or parameter interpolation
  pattern?: string; // name pattern or wildcard, e.g. "Shadow*", "${targetName}"
  kind?: LayerData["kind"];
  tag?: string;
  stepId?: string; // references outputVar or stepId from an earlier step
  childPath?: number[]; // child indices at creation time, bound to the produced descendant ID
  paramName?: string; // parameter name that resolves to layer name or ID
  ambiguityStrategy?: AmbiguityStrategy;
  allowMultiple?: boolean;
  ignoreLocked?: boolean;
}

export interface StepCondition {
  param?: string;
  op:
    | "equals"
    | "notEquals"
    | "truthy"
    | "greaterThan"
    | "lessThan"
    | "layerExists"
    | "layerCountEquals";
  value?: unknown;
  target?: SemanticTarget;
}

export interface RecipeLensCorrection {
  version?:1;enabled?:boolean|string;scale?:number|string;
  center?:{x?:number|string;y?:number|string};
  distortion?:{k1?:number|string;k2?:number|string;k3?:number|string};
  chromatic?:{red?:number|string;blue?:number|string};
  vignette?:{k1?:number|string;k2?:number|string;k3?:number|string};
  profile?:import('../../core/interchange/lens/schema').LensProfileSelectionOptions|string;
}
export type RecipeRawDevelopment = {
  [K in keyof import('../../core/interchange/raw/types').RawDevelopOptions]?:
    K extends 'multipliers' ? {red?:number|string;green?:number|string;blue?:number|string}
    : K extends 'lens' ? RecipeLensCorrection|string
    : import('../../core/interchange/raw/types').RawDevelopOptions[K]|string;
};
export interface PlannedRawDevelopment {
  assetId:string;
  sourceAssetId:string;
  options:import('../../core/interchange/raw/types').RawDecodeSettings;
}

export type RecipeAction =
  | {type:'layer.align';targets:SemanticTarget[];alignment:import('../../core/layer-layout').LayerAlignment;reference?:{type:'selection'}|{type:'canvas'}|{type:'layer';layer:SemanticTarget}}
  | {type:'font.file.add';id:string}
  | {type:'font.file.rename';id:string;name:string}
  | {type:'font.file.remove';id:string;replaceWith?:string}
  | {type:'raw.develop';development:RecipeRawDevelopment;allowPrecisionLoss:true}
  | {type:'paragraphStyle.ensure';name:string;format:RecipeParagraphFormat;basedOn?:RecipeParagraphBase|null}
  | {type:'paragraphStyle.update';style:RecipeParagraphStyleTarget;name:string;format:RecipeParagraphFormat;basedOn?:RecipeParagraphBase|null}
  | {type:'paragraphStyle.remove';style:RecipeParagraphStyleTarget}
  | {type:'text.paragraphStyle';style:RecipeParagraphStyleTarget|null;keepOverrides?:boolean}
  | {type:'text.paragraphOverrides.clear';keys?:(keyof ParagraphFormat)[]}
  | {type:'document.font.replace';from:string;to:string}
  | { type: "layer.translate"; dx: number | string; dy: number | string }
  | {
      type: "layer.update";
      patch: Record<string, unknown>;
    }
  | {
      type: "layer.duplicate";
      newName?: string;
      inPlace?: boolean;
    }
  | {
      type: "layer.remove";
    }
  | {
      type: "layer.reorder";
      direction: "up" | "down";
    }
  | {
      type: "layer.add";
      layerTemplate: {
        kind: LayerData["kind"];
        name: string;
        [key: string]: unknown;
      };
      parentTarget?: SemanticTarget;
      /** Map template-local binding IDs to portable style references, including group text. */
      paragraphStyles?:Record<string,RecipeParagraphStyleTarget>;
    }
  | {
      type: "effect.tone";
      values: Partial<{
        exposure: number | string;
        contrast: number | string;
        saturation: number | string;
      }>;
    }
  | {
      type: "effect.add";
      effect: ToneEffectData;
    }
  | {
      type: "effect.update";
      effectId?: string;
      effectIndex?: number;
      values: Partial<ToneEffectData>;
    }
  | { type: "effect.remove"; effectId?: string; effectIndex?: number }
  | { type: "effect.reset" }
  | {
      type: "document.resize" | "document.resizeImage";
      width: number | string;
      height: number | string;
    }
  | {
      type: "document.crop";
      bounds: {
        x: number | string;
        y: number | string;
        width: number | string;
        height: number | string;
      };
    }
  | {
      type: "document.rename";
      name: string;
    }
  | {
      type: "selection.set";
      selection?: SelectionData | null;
    }
  | {
      type: "ai.generate";
      prompt: string;
      modality: "text-to-image" | "masked-edit";
      output?: {
        width: number;
        height: number;
        alpha?: boolean;
      };
      estimatedCostCents?: number;
    };

export interface RecipeStep {
  id: string;
  name: string;
  description?: string;
  condition?: StepCondition;
  target?: SemanticTarget;
  action: RecipeAction;
  /** Preserve action strings verbatim instead of interpolating parameter expressions. */
  literalValues?: boolean;
  outputVar?: string;
}

export interface Recipe {
  schemaVersion: 1|2;
  /** Version 2 only. Exact source/face metadata; bytes belong to a package/store. */
  fontFiles?:import('../../core/font-files').FontFileData[];
  id: string;
  name: string;
  description: string;
  version: number;
  parameters: RecipeParameter[];
  steps: RecipeStep[];
  tags?: string[];
  author?: string;
  created?: string;
  modified?: string;
}

export interface PreconditionCheck {
  id: string;
  description: string;
  satisfied: boolean;
  error?: string;
}

export interface PlannedStepChange {
  stepId: string;
  stepName: string;
  skipped: boolean;
  skipReason?: string;
  resolvedTargetId?: string;
  resolvedTargetName?: string;
  resolvedCommand?: EditorCommand;
  expectedVisualChange: string;
  estimatedSpendCents: number;
  actionType: string;
}

export interface EditPlanSummary {
  layersAdded: number;
  layersModified: number;
  layersRemoved: number;
  canvasResized: boolean;
  estimatedSpendCents: number;
  requiresAI: boolean;
  affectedLayerNames: string[];
}

export interface EditPlan {
  recipeId: string;
  recipeName: string;
  valid: boolean;
  errors: string[];
  warnings: string[];
  preconditions: PreconditionCheck[];
  steps: PlannedStepChange[];
  resolvedCommands: EditorCommand[];
  /** Native outputs are private planning identities until asynchronous preparation succeeds. */
  rawDevelopments?: PlannedRawDevelopment[];
  summary: EditPlanSummary;
  parameterValues: Record<string, unknown>;
  stepOutputs?: Map<string, string>;
}
