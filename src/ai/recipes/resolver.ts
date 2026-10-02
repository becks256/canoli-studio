import { stepConditionSchema } from "./schema";
import type { DocumentData, LayerData } from "../../core/model";
import { allLayers, findLayer, isLocked } from "../../core/model";
import type { SemanticTarget, StepCondition } from "./types";

/**
 * Interpolates parameter references in values.
 * Supports:
 * - Direct variable substitution: "${foo}" -> params["foo"] (preserves number, boolean, object types)
 * - String interpolation: "Prefix ${foo} Suffix" -> "Prefix bar Suffix"
 * - Recursive object/array traversal
 */
export function interpolateValue(
  value: unknown,
  params: Record<string, unknown>,
): unknown {
  if (typeof value === "string") {
    // Exact single parameter match: "${paramName}"
    const exactMatch = value.match(/^\$\{([a-zA-Z0-9_-]+)\}$/);
    if (exactMatch) {
      const key = exactMatch[1];
      if (Object.hasOwn(params, key)) {
        return params[key];
      }
      return value;
    }

    // Substring interpolation: "Hello ${name}!"
    return value.replace(/\$\{([a-zA-Z0-9_-]+)\}/g, (match, key) => {
      if (Object.hasOwn(params, key)) {
        const val = params[key];
        return val !== undefined && val !== null ? String(val) : "";
      }
      return match;
    });
  }

  if (Array.isArray(value)) {
    return value.map((item) => interpolateValue(item, params));
  }

  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = Object.create(null);
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      result[k] = interpolateValue(v, params);
    }
    return result;
  }

  return value;
}

/**
 * Evaluates whether a layer name matches a search pattern (wildcard or exact).
 */
export function matchPattern(name: string, pattern: string): boolean {
  if (pattern === "*" || pattern === "") return true;
  if (name.toLowerCase() === pattern.toLowerCase()) return true;

  // Wildcard matching: e.g. "Shadow*" or "*copy"
  if (pattern.includes("*") || pattern.includes("?")) {
    const regexPattern =
      "^" +
      pattern
        .replace(/[.+^${}()|[\]\\]/g, "\\$&")
        .replace(/\*/g, ".*")
        .replace(/\?/g, ".") +
      "$";
    try {
      const regex = new RegExp(regexPattern, "i");
      return regex.test(name);
    } catch {
      return false;
    }
  }

  return false;
}

export interface ResolveTargetResult {
  layer: LayerData | null;
  error?: string;
}

/**
 * Resolves a semantic target against a document state.
 * Never relies on transient IDs in recipe definitions.
 */
export function resolveTarget(
  target: SemanticTarget,
  document: DocumentData,
  selectedId: string | null,
  stepOutputs: Map<string, string> = new Map(),
  params: Record<string, unknown> = {},
): ResolveTargetResult {
  const strategy = target.allowMultiple
    ? "first"
    : (target.ambiguityStrategy ?? "fail");

  // 1. Role-based resolution
  if (target.role) {
    switch (target.role) {
      case "selected": {
        if (!selectedId) {
          return {
            layer: null,
            error: "No layer is currently selected in the document.",
          };
        }
        const layer = findLayer(document, selectedId);
        if (!layer) {
          return {
            layer: null,
            error: "The currently selected layer could not be found.",
          };
        }
        return { layer };
      }
      case "background": {
        if (document.children.length === 0) {
          return {
            layer: null,
            error: "Document has no layers to resolve as background.",
          };
        }
        // First look for bottommost raster layer
        const bottomRaster = document.children.find((l) => l.kind === "raster");
        if (bottomRaster) {
          return { layer: bottomRaster };
        }
        // Fall back to bottommost layer of any kind
        return { layer: document.children[0] };
      }
      case "foreground":
      case "topmost": {
        if (document.children.length === 0) {
          return {
            layer: null,
            error: "Document has no layers to resolve as topmost.",
          };
        }
        return { layer: document.children[document.children.length - 1] };
      }
      case "bottommost": {
        if (document.children.length === 0) {
          return {
            layer: null,
            error: "Document has no layers to resolve as bottommost.",
          };
        }
        return { layer: document.children[0] };
      }
      case "active-mask": {
        const selected = selectedId
          ? findLayer(document, selectedId)
          : undefined;
        const withMask = selected?.mask ? selected : undefined;
        if (!withMask) {
          return {
            layer: null,
            error: "No layer with an active mask found in the document.",
          };
        }
        return { layer: withMask };
      }
      case "all": {
        if (document.children.length === 0) {
          return { layer: null, error: "Document has no layers to resolve." };
        }
        return { layer: document.children[document.children.length - 1] };
      }
    }
  }

  // 2. Prior step output resolution
  if (target.by === "stepResult") {
    if (!target.stepId) {
      return {
        layer: null,
        error: "Semantic target missing required 'stepId'.",
      };
    }
    const layerId = stepOutputs.get(
      target.childPath?.length
        ? JSON.stringify([target.stepId, target.childPath])
        : target.stepId,
    );
    if (!layerId) {
      return {
        layer: null,
        error: `Step result for '${target.stepId}' was not produced by any preceding step.`,
      };
    }
    const layer = findLayer(document, layerId);
    if (!layer) {
      return {
        layer: null,
        error: `Layer produced by step '${target.stepId}' (id: ${layerId}) no longer exists.`,
      };
    }
    return { layer };
  }

  // 3. Parameter-based resolution
  if (target.by === "parameter") {
    if (!target.paramName) {
      return {
        layer: null,
        error: "Semantic target missing required 'paramName'.",
      };
    }
    const paramVal = Object.hasOwn(params, target.paramName)
      ? params[target.paramName]
      : undefined;
    if (paramVal === undefined || paramVal === null || paramVal === "") {
      return {
        layer: null,
        error: `Required target parameter '${target.paramName}' was not provided.`,
      };
    }
    const strVal = String(paramVal);
    // Try by layer ID first
    const byId = findLayer(document, strVal);
    if (byId) return { layer: byId };

    // Try by exact name match
    const matching = allLayers(document.children).filter(
      (l) => l.name === strVal,
    );
    if (matching.length > 1 && strategy !== "first") {
      return {
        layer: null,
        error: `Target parameter '${target.paramName}' ('${strVal}') is ambiguous; matches ${matching.length} layers. Supply a layer ID or explicitly select the first-match strategy.`,
      };
    }
    if (matching.length > 0) return { layer: matching[0] };

    return {
      layer: null,
      error: `Layer specified by parameter '${target.paramName}' ('${strVal}') was not found.`,
    };
  }

  // 4. Name pattern resolution
  if (target.by === "name") {
    if (!target.pattern) {
      return {
        layer: null,
        error: "Semantic target missing required 'pattern'.",
      };
    }
    const resolvedPattern = target.literal
      ? target.pattern
      : String(interpolateValue(target.pattern, params));
    const matching = allLayers(document.children).filter((l) =>
      target.literal
        ? l.name === resolvedPattern
        : matchPattern(l.name, resolvedPattern),
    );

    if (matching.length === 0) {
      return {
        layer: null,
        error: `No layer matching name pattern '${resolvedPattern}' was found.`,
      };
    }

    if (matching.length > 1) {
      if (strategy === "first") {
        return { layer: matching[0] };
      }
      return {
        layer: null,
        error: `Target pattern '${resolvedPattern}' is ambiguous; matches ${matching.length} layers: ${matching.map((l) => `'${l.name}'`).join(", ")}.`,
      };
    }

    return { layer: matching[0] };
  }

  // 5. Kind-based resolution
  if (target.by === "kind") {
    if (!target.kind) {
      return { layer: null, error: "Semantic target missing required 'kind'." };
    }
    const matching = allLayers(document.children).filter(
      (l) => l.kind === target.kind,
    );

    if (matching.length === 0) {
      return {
        layer: null,
        error: `No layer of kind '${target.kind}' was found in the document.`,
      };
    }

    if (matching.length > 1) {
      if (strategy === "first") {
        return { layer: matching[0] };
      }
      return {
        layer: null,
        error: `Target kind '${target.kind}' is ambiguous; matches ${matching.length} layers.`,
      };
    }

    return { layer: matching[0] };
  }

  // 6. Tag-based resolution
  if (target.by === "tag") {
    if (!target.tag) {
      return { layer: null, error: "Semantic target missing required 'tag'." };
    }
    const resolvedTag = String(interpolateValue(target.tag, params));
    const matching = allLayers(document.children).filter((l) =>
      l.metadata?.keywords?.some(
        (k) => k.toLowerCase() === resolvedTag.toLowerCase(),
      ),
    );

    if (matching.length === 0) {
      return {
        layer: null,
        error: `No layer with tag '${resolvedTag}' was found in the document.`,
      };
    }

    if (matching.length > 1) {
      if (strategy === "first") {
        return { layer: matching[0] };
      }
      return {
        layer: null,
        error: `Target tag '${resolvedTag}' is ambiguous; matches ${matching.length} layers.`,
      };
    }

    return { layer: matching[0] };
  }

  return { layer: null, error: "Unrecognized semantic target specification." };
}

/**
 * Checks preconditions for targeting a layer (e.g. locked state).
 */
export function checkTargetPreconditions(
  layer: LayerData,
  document: DocumentData,
  target?: SemanticTarget,
): { satisfied: boolean; error?: string } {
  if (target?.ignoreLocked) {
    return { satisfied: true };
  }
  if (isLocked(document, layer.id)) {
    return {
      satisfied: false,
      error: `Layer '${layer.name}' is locked. Unlock it before executing this step.`,
    };
  }
  return { satisfied: true };
}

/**
 * Evaluates a step condition against parameter values and document state.
 */
export function evaluateCondition(
  condition: StepCondition,
  params: Record<string, unknown>,
  document: DocumentData,
  selectedId: string | null = null,
  stepOutputs: Map<string, string> = new Map(),
  outputGroups: Map<string, string[]> = new Map(),
): { met: boolean; reason?: string } {
  stepConditionSchema.parse(condition);
  if (condition.target) {
    if (condition.op === "layerExists") {
      // Existence does not select a layer for mutation; multiple matches qualify.
      const target = condition.target;
      const key = target.childPath?.length
        ? JSON.stringify([target.stepId, target.childPath])
        : target.stepId;
      const outputs =
        !target.role && target.by === "stepResult" && key !== undefined
          ? outputGroups.get(key)
          : undefined;
      // Existence accepts any surviving output; mutation resolution remains strict
      // when a previously bound output has disappeared.
      const met =
        outputs !== undefined
          ? outputs.some((id) => !!findLayer(document, id))
          : resolveTarget(
              { ...target, allowMultiple: true },
              document,
              selectedId,
              stepOutputs,
              params,
            ).layer !== null;
      return {
        met,
        reason: met
          ? undefined
          : `Target layer specified in condition was not found.`,
      };
    }
  }

  if (condition.op === "layerCountEquals") {
    const all = allLayers(document.children);
    const count = Number(condition.value);
    const met = all.length === count;
    return {
      met,
      reason: met
        ? undefined
        : `Document layer count (${all.length}) does not equal expected ${count}.`,
    };
  }

  if (condition.param) {
    const paramVal = Object.hasOwn(params, condition.param)
      ? params[condition.param]
      : undefined;
    let met = false;
    switch (condition.op) {
      case "equals":
        met = paramVal === condition.value;
        break;
      case "notEquals":
        met = paramVal !== condition.value;
        break;
      case "truthy":
        met = Boolean(paramVal);
        break;
      case "greaterThan":
        met = Number(paramVal) > Number(condition.value);
        break;
      case "lessThan":
        met = Number(paramVal) < Number(condition.value);
        break;
      default:
        met = false;
        break;
    }
    return {
      met,
      reason: met
        ? undefined
        : `Condition '${condition.param} ${condition.op} ${condition.value ?? ""}' not satisfied.`,
    };
  }

  return { met: false, reason: "Condition could not be evaluated." };
}

/** Resolve a step's complete target set before executing any of its commands. */
export function resolveTargets(
  target: SemanticTarget,
  document: DocumentData,
  selectedId: string | null,
  stepOutputs: Map<string, string> = new Map(),
  params: Record<string, unknown> = {},
  outputGroups: Map<string, string[]> = new Map(),
): { layers: LayerData[]; error?: string } {
  const all = allLayers(document.children);
  let matches: LayerData[] | undefined;
  if (target.role === "all") matches = all;
  else if (!target.role && target.by === "stepResult" && target.stepId) {
    const key = target.childPath?.length
      ? JSON.stringify([target.stepId, target.childPath])
      : target.stepId;
    const ids = outputGroups.get(key);
    if (ids) {
      matches = ids
        .map((id) => findLayer(document, id))
        .filter((layer): layer is LayerData => !!layer);
      if (matches.length !== ids.length)
        return {
          layers: [],
          error: "A referenced step output no longer exists.",
        };
    }
  } else if (!target.role && target.allowMultiple) {
    if (target.by === "name" && target.pattern)
      matches = all.filter((layer) =>
        target.literal
          ? layer.name === target.pattern
          : matchPattern(
              layer.name,
              String(interpolateValue(target.pattern, params)),
            ),
      );
    if (target.by === "kind" && target.kind)
      matches = all.filter((layer) => layer.kind === target.kind);
    if (target.by === "tag" && target.tag) {
      const tag = String(interpolateValue(target.tag, params)).toLowerCase();
      matches = all.filter((layer) =>
        layer.metadata?.keywords?.some((word) => word.toLowerCase() === tag),
      );
    }
    if (
      target.by === "parameter" &&
      target.paramName &&
      Object.hasOwn(params, target.paramName) &&
      params[target.paramName] != null
    ) {
      const value = String(params[target.paramName]);
      const exact = findLayer(document, value);
      matches = exact ? [exact] : all.filter((layer) => layer.name === value);
    }
  }
  if (!matches) {
    const single = resolveTarget(
      target,
      document,
      selectedId,
      stepOutputs,
      params,
    );
    return { layers: single.layer ? [single.layer] : [], error: single.error };
  }
  if (!matches.length)
    return { layers: [], error: "No layers match the recipe target." };
  if (matches.length > 1 && target.role !== "all" && !target.allowMultiple) {
    if (target.ambiguityStrategy === "first") return { layers: [matches[0]] };
    return {
      layers: [],
      error:
        "Step output is ambiguous; enable allowMultiple or explicitly choose the first match.",
    };
  }
  return { layers: matches };
}
