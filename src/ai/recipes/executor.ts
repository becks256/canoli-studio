import { recipeOutputBindingsUnique, stepConditionSchema } from "./schema";
import type { DocumentData, LayerData } from "../../core/model";
import {
  allLayers,
  findLayer,
  findParent,
  referencedAssets,
  createAdjustmentLayer,
  createGroup,
  createRaster,
  createText,
  id,
} from "../../core/model";
import { execute } from "../../core/commands";
import type { EditorCommand, LayerPatch } from "../../core/commands";
import {PaintLayer,VectorLayer,type Document} from "../../dom";
import type {
  EditPlan,
  PlannedStepChange,
  PreconditionCheck,
  Recipe,
  RecipeParameter,
} from "./types";
import {
  checkTargetPreconditions,
  evaluateCondition,
  interpolateValue,
  resolveTargets,
} from "./resolver";

function numericValue(value: unknown): number {
  if (typeof value === "number") return value;
  if (
    typeof value !== "string" ||
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?$/i.test(value.trim())
  )
    return NaN;
  return Number(value);
}

/**
 * Resolves full parameter map combining defaults and user-supplied arguments.
 */
export function resolveParameterValues(
  parameters: RecipeParameter[],
  supplied: Record<string, unknown>,
): {
  values: Record<string, unknown>;
  errors: string[];
} {
  const values: Record<string, unknown> = Object.create(null);
  const errors: string[] = [];

  for (const param of parameters) {
    let val = Object.hasOwn(supplied, param.name)
      ? supplied[param.name]
      : undefined;
    if (val === undefined || val === null || val === "") {
      if (param.default !== undefined) {
        val = param.default;
      } else if (param.required) {
        errors.push(
          `Missing required parameter '${param.label}' (${param.name}).`,
        );
        continue;
      }
    }

    if (val !== undefined && val !== null && val !== "") {
      if (param.type === "number") {
        const numVal = numericValue(val);
        if (!Number.isFinite(numVal)) {
          errors.push(
            `Parameter '${param.label}' must be a finite decimal number.`,
          );
        } else {
          if (param.min !== undefined && numVal < param.min) {
            errors.push(
              `Parameter '${param.label}' (${numVal}) is below minimum allowed value ${param.min}.`,
            );
          }
          if (param.max !== undefined && numVal > param.max) {
            errors.push(
              `Parameter '${param.label}' (${numVal}) exceeds maximum allowed value ${param.max}.`,
            );
          }
          val = numVal;
        }
      } else if (param.type === "choice" && param.options) {
        if (!param.options.includes(String(val))) {
          errors.push(
            `Parameter '${param.label}' value '${val}' is not in allowed options: [${param.options.join(", ")}].`,
          );
        }
      } else if (param.type === "boolean") {
        if (val === "true") val = true;
        else if (val === "false") val = false;
        else if (typeof val !== "boolean")
          errors.push(`Parameter '${param.label}' must be true or false.`);
      }
    }

    values[param.name] = val;
  }

  // Also include any extra user parameters
  for (const [k, v] of Object.entries(supplied)) {
    if (!Object.hasOwn(values, k)) {
      values[k] = v;
    }
  }

  return { values, errors };
}

/**
 * Compiles and validates an EditPlan from a Recipe and Document state (Dry-run).
 * Never mutates the document or history.
 */
export function compileEditPlan(
  recipe: Recipe,
  document: DocumentData,
  selectedId: string | null = null,
  rawParams: Record<string, unknown> = {},
  availableAssetIds?: ReadonlySet<string>,
): EditPlan {
  const errors: string[] = [];
  if (!recipeOutputBindingsUnique(recipe))
    errors.push(
      "Recipe output aliases must not collide with another step ID or output alias.",
    );
  const warnings: string[] = [];
  const preconditions: PreconditionCheck[] = [];
  const plannedSteps: PlannedStepChange[] = [];
  const resolvedCommands: EditorCommand[] = [];

  const { values: params, errors: paramErrors } = resolveParameterValues(
    recipe.parameters,
    rawParams,
  );
  if (paramErrors.length > 0) {
    errors.push(...paramErrors);
    for (const pErr of paramErrors) {
      preconditions.push({
        id: `param-validation`,
        description: "Valid parameter inputs",
        satisfied: false,
        error: pErr,
      });
    }
  }

  // Working copy of document for simulation
  let simDoc = structuredClone(document);
  const stepOutputs = new Map<string, string>();
  const outputGroups = new Map<string, string[]>();
  const effectIds = new Map<string, string>();
  const bindOutput = (key: string, layer: LayerData): void => {
    const bind = (binding: string, id: string) => {
      stepOutputs.set(binding, id);
      outputGroups.set(binding, [
        ...new Set([...(outputGroups.get(binding) ?? []), id]),
      ]);
    };
    const descendants = (node: LayerData, path: number[]): void => {
      if (path.length) bind(JSON.stringify([key, path]), node.id);
      if (node.kind === "group")
        node.children.forEach((child, index) =>
          descendants(child, [...path, index]),
        );
    };
    descendants(layer, []);
    bind(key, layer.id);
  };
  const affectedLayerNames = new Set<string>();

  let layersAdded = 0;
  let layersModified = 0;
  let layersRemoved = 0;
  let canvasResized = false;
  let estimatedSpendCents = 0;
  let requiresAI = false;

  for (const step of recipe.steps) {
    const actionValue = (value: unknown): unknown =>
      step.literalValues
        ? structuredClone(value)
        : interpolateValue(value, params);
    // 1. Condition evaluation
    if (step.condition) {
      const validation = stepConditionSchema.safeParse(step.condition);
      if (!validation.success) {
        errors.push(
          `Step '${step.name}' has an invalid condition: ${validation.error.issues.map((issue) => issue.message).join("; ")}`,
        );
        continue;
      }
      const condResult = evaluateCondition(
        step.condition,
        params,
        simDoc,
        selectedId,
        stepOutputs,
        outputGroups,
      );

      if (!condResult.met) {
        plannedSteps.push({
          stepId: step.id,
          stepName: step.name,
          skipped: true,
          skipReason: condResult.reason ?? "Condition not satisfied.",
          expectedVisualChange: "Skipped (condition not met)",
          estimatedSpendCents: 0,
          actionType: step.action.type,
        });
        continue;
      }
    }

    // Resolve the complete set once; earlier targets cannot change later matches.
    const resolution = step.target
      ? resolveTargets(
          step.target,
          simDoc,
          selectedId,
          stepOutputs,
          params,
          outputGroups,
        )
      : { layers: [] as LayerData[] };
    if (resolution.error) {
      errors.push(`Step '${step.name}': ${resolution.error}`);
      preconditions.push({
        id: `target-${step.id}`,
        description: `Resolve targets for '${step.name}'`,
        satisfied: false,
        error: resolution.error,
      });
      continue;
    }
    let targets = resolution.layers;
    // Structural operations already include descendants of selected groups.
    if (
      step.action.type === "layer.remove" ||
      step.action.type === "layer.duplicate"
    ) {
      const ids = new Set(targets.map((layer) => layer.id));
      targets = targets.filter((layer) => {
        let parent = findParent(simDoc.children, layer.id);
        while (parent) {
          if (ids.has(parent)) return false;
          parent = findParent(simDoc.children, parent);
        }
        return true;
      });
    }
    for (const targetId of step.target
      ? targets.map((layer) => layer.id)
      : [null]) {
      const targetLayer = targetId ? findLayer(simDoc, targetId) : null;
      if (step.target && targetLayer) {
        const targetPrecond = checkTargetPreconditions(
          targetLayer,
          simDoc,
          step.target,
        );
        if (!targetPrecond.satisfied) {
          preconditions.push({
            id: `target-precond-${step.id}`,
            description: `Target layer '${targetLayer.name}' must be editable`,
            satisfied: false,
            error: targetPrecond.error,
          });
          errors.push(targetPrecond.error!);
        } else {
          preconditions.push({
            id: `target-${step.id}`,
            description: `Target layer '${targetLayer.name}' is editable`,
            satisfied: true,
          });
        }
      }

      // 3. Command generation & simulation
      try {
        let visualChange = "";
        let stepSpend = 0;
        const stepCommands: EditorCommand[] = [];

        switch (step.action.type) {
          case "layer.translate": {
            if (!targetLayer)
              throw new Error(`Step '${step.name}' requires a target layer.`);
            const dx = actionValue(step.action.dx);
            const dy = actionValue(step.action.dy);
            if (
              typeof dx !== "number" ||
              typeof dy !== "number" ||
              !Number.isFinite(dx) ||
              !Number.isFinite(dy)
            ) {
              throw new Error(
                "Layer translation requires finite numeric offsets.",
              );
            }
            const cmd: EditorCommand = {
              type: "layer.update",
              id: targetLayer.id,
              patch: { x: targetLayer.x + dx, y: targetLayer.y + dy },
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            layersModified++;
            affectedLayerNames.add(targetLayer.name);
            visualChange = `Translate '${targetLayer.name}' by (${dx}, ${dy})`;
            break;
          }

          case "layer.update": {
            if (!targetLayer) {
              throw new Error(`Step '${step.name}' requires a target layer.`);
            }
            const rawPatch = actionValue(step.action.patch) as Record<
              string,
              unknown
            >;
            const patch: LayerPatch = {};
            for (const [k, v] of Object.entries(rawPatch)) {
              if (
                [
                  "opacity",
                  "fillOpacity",
                  "x",
                  "y",
                  "width",
                  "height",
                  "fontSize",
                  "lineHeight",
                ].includes(k)
              ) {
                (patch as Record<string, unknown>)[k] = numericValue(v);
              } else {
                (patch as Record<string, unknown>)[k] = v;
              }
            }

            const wasLocked = Boolean(targetLayer.locked);
            if (step.target?.ignoreLocked && wasLocked) {
              const unlockCmd: EditorCommand = {
                type: "layer.update",
                id: targetLayer.id,
                patch: { locked: false },
              };
              stepCommands.push(unlockCmd);
              simDoc = execute(simDoc, unlockCmd);
            }

            const cmd: EditorCommand = {
              type: "layer.update",
              id: targetLayer.id,
              patch,
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);

            if (
              step.target?.ignoreLocked &&
              wasLocked &&
              !("locked" in patch)
            ) {
              const relockCmd: EditorCommand = {
                type: "layer.update",
                id: targetLayer.id,
                patch: { locked: true },
              };
              stepCommands.push(relockCmd);
              simDoc = execute(simDoc, relockCmd);
            }

            layersModified++;
            affectedLayerNames.add(targetLayer.name);
            visualChange = `Update properties [${Object.keys(patch).join(", ")}] on layer '${targetLayer.name}'`;
            break;
          }

          case "layer.duplicate": {
            if (!targetLayer) {
              throw new Error(
                `Step '${step.name}' requires a target layer to duplicate.`,
              );
            }
            const newIds: Record<string, string> = {};
            for (const node of allLayers([targetLayer])) {
              newIds[node.id] = id();
              if (node.kind === "raster")
                node.effects.forEach((effect) => {
                  newIds[effect.id] = id();
                });
              if (node.kind === "paint")
                node.strokes.forEach((stroke) => {
                  newIds[stroke.id] = id();
                });
              if (node.kind === "vector")
                node.paths.forEach((path) => {
                  newIds[path.id] = id();
                });
            }
            const newDuplicateId = newIds[targetLayer.id];
            const duplicateCmd: EditorCommand = {
              type: "layer.duplicate",
              id: targetLayer.id,
              newIds,
            };
            stepCommands.push(duplicateCmd);
            simDoc = execute(simDoc, duplicateCmd);
            const duplicated = allLayers(simDoc.children).find(
              (l) => l.id === newDuplicateId,
            );

            if (duplicated) {
              if (step.action.inPlace) {
                const position: EditorCommand = {
                  type: "layer.update",
                  id: duplicated.id,
                  patch: { x: targetLayer.x, y: targetLayer.y },
                };
                stepCommands.push(position);
                simDoc = execute(simDoc, position);
              }

              layersAdded++;
              affectedLayerNames.add(duplicated.name);
              bindOutput(step.id, duplicated);
              if (step.outputVar) {
                bindOutput(step.outputVar, duplicated);
              }
              if (step.action.newName) {
                const resolvedName = String(actionValue(step.action.newName));
                const renameCmd: EditorCommand = {
                  type: "layer.update",
                  id: duplicated.id,
                  patch: { name: resolvedName },
                };
                stepCommands.push(renameCmd);
                simDoc = execute(simDoc, renameCmd);
                duplicated.name = resolvedName;
              }
              visualChange = `Duplicate layer '${targetLayer.name}' -> '${duplicated.name}'`;
            } else {
              visualChange = `Duplicate layer '${targetLayer.name}'`;
            }
            break;
          }

          case "layer.remove": {
            if (!targetLayer) {
              throw new Error(
                `Step '${step.name}' requires a target layer to remove.`,
              );
            }
            const cmd: EditorCommand = {
              type: "layer.remove",
              id: targetLayer.id,
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            layersRemoved++;
            affectedLayerNames.add(targetLayer.name);
            visualChange = `Remove layer '${targetLayer.name}'`;
            break;
          }

          case "layer.reorder": {
            if (!targetLayer) {
              throw new Error(
                `Step '${step.name}' requires a target layer to reorder.`,
              );
            }
            const cmd: EditorCommand = {
              type: "layer.reorder",
              id: targetLayer.id,
              direction: step.action.direction,
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            layersModified++;
            affectedLayerNames.add(targetLayer.name);
            visualChange = `Reorder layer '${targetLayer.name}' ${step.action.direction}`;
            break;
          }

          case "layer.add": {
            const rawTemplate = actionValue(
              step.action.layerTemplate,
            ) as Record<string, unknown>;
            const templateKind = rawTemplate.kind as LayerData["kind"];
            const templateName = String(rawTemplate.name || "New Layer");

            let newLayerData: LayerData;
            switch (templateKind) {
              case "paint":
                newLayerData = new PaintLayer({name:templateName}).toJSON();
                break;
              case "vector":
                newLayerData = new VectorLayer({name:templateName}).toJSON();
                break;
              case "adjustment":
                newLayerData = createAdjustmentLayer(
                  templateName,
                  (rawTemplate.adjustment as any) ?? undefined,
                );
                break;
              case "text":
                newLayerData = createText(
                  templateName,
                  String(rawTemplate.text || "Text"),
                  {
                    fontSize: Number(rawTemplate.fontSize) || 32,
                    fontFamily: String(rawTemplate.fontFamily || "sans-serif"),
                    color: String(rawTemplate.color || "#ffffff"),
                  },
                );
                break;
              case "group":
                newLayerData = createGroup(templateName);
                break;
              case "raster":
                newLayerData = createRaster(
                  templateName,
                  String(rawTemplate.assetId || id()),
                  Number(rawTemplate.width) || simDoc.width,
                  Number(rawTemplate.height) || simDoc.height,
                );
                break;
              default:
                newLayerData = {
                  ...createGroup(templateName),
                  kind: templateKind as any,
                };
                break;
            }

            // Templates recorded from the DOM contain complete editable artwork.
            // Preserve it; constructor defaults only fill omitted optional fields.
            newLayerData = {
              ...newLayerData,
              ...structuredClone(rawTemplate),
              id: id(),
            } as LayerData;
            for (const node of allLayers([newLayerData])) {
              node.id = id();
              if (node.kind === "raster")
                node.effects.forEach((effect) => {
                  effect.id = id();
                });
              if (node.kind === "paint")
                node.strokes.forEach((stroke) => {
                  stroke.id = id();
                });
              if (node.kind === "vector")
                node.paths.forEach((path) => {
                  path.id = id();
                });
            }

            let parentId: string | undefined = undefined;
            if (step.action.parentTarget) {
              const parentRes = resolveTargets(
                step.action.parentTarget,
                simDoc,
                selectedId,
                stepOutputs,
                params,
                outputGroups,
              );
              if (
                parentRes.error ||
                parentRes.layers.length !== 1 ||
                parentRes.layers[0].kind !== "group"
              ) {
                throw new Error(
                  "Specified parent target must resolve to exactly one existing group.",
                );
              }
              parentId = parentRes.layers[0].id;
            }

            const cmd: EditorCommand = {
              type: "layer.add",
              layer: newLayerData,
              parentId,
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            layersAdded++;
            affectedLayerNames.add(newLayerData.name);
            bindOutput(step.id, newLayerData);
            if (step.outputVar) {
              bindOutput(step.outputVar, newLayerData);
            }
            visualChange = `Add ${newLayerData.kind} layer '${newLayerData.name}'`;
            break;
          }

          case "effect.tone": {
            if (!targetLayer) {
              throw new Error(`Step '${step.name}' requires a target layer.`);
            }
            if (targetLayer.kind !== "raster") {
              throw new Error(
                `Tone adjustment can only be applied to raster image layers, but '${targetLayer.name}' is a ${targetLayer.kind} layer.`,
              );
            }
            const interpValues = actionValue(step.action.values) as Record<
              string,
              unknown
            >;
            const parsedValues: Partial<{
              exposure: number;
              contrast: number;
              saturation: number;
            }> = {};
            if (interpValues.exposure !== undefined)
              parsedValues.exposure = Number(interpValues.exposure);
            if (interpValues.contrast !== undefined)
              parsedValues.contrast = Number(interpValues.contrast);
            if (interpValues.saturation !== undefined)
              parsedValues.saturation = Number(interpValues.saturation);

            const cmd: EditorCommand = {
              type: "effect.tone",
              id: targetLayer.id,
              values: parsedValues,
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            layersModified++;
            affectedLayerNames.add(targetLayer.name);
            visualChange = `Adjust tone on '${targetLayer.name}' (exp: ${parsedValues.exposure ?? 0}, con: ${parsedValues.contrast ?? 0}, sat: ${parsedValues.saturation ?? 0})`;
            break;
          }

          case "effect.add": {
            if (!targetLayer) {
              throw new Error(`Step '${step.name}' requires a target layer.`);
            }
            if (targetLayer.kind !== "raster") {
              throw new Error(
                `Effects can only be added to raster image layers.`,
              );
            }
            const addedEffectId = id();
            effectIds.set(
              JSON.stringify([targetLayer.id, step.action.effect.id]),
              addedEffectId,
            );
            const cmd: EditorCommand = {
              type: "effect.add",
              id: targetLayer.id,
              effect: { ...step.action.effect, id: addedEffectId },
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            layersModified++;
            affectedLayerNames.add(targetLayer.name);
            visualChange = `Add effect '${step.action.effect.kind}' to '${targetLayer.name}'`;
            break;
          }

          case "effect.update":
          case "effect.remove": {
            if (!targetLayer) {
              throw new Error(`Step '${step.name}' requires a target layer.`);
            }
            let effectId = step.action.effectId
              ? (effectIds.get(
                  JSON.stringify([targetLayer.id, step.action.effectId]),
                ) ?? step.action.effectId)
              : `tone-${targetLayer.id}`;
            if (step.action.effectIndex !== undefined) {
              if (
                targetLayer.kind !== "raster" ||
                !targetLayer.effects[step.action.effectIndex]
              ) {
                throw new Error(
                  "Recorded effect position does not exist on the target layer.",
                );
              }
              effectId = targetLayer.effects[step.action.effectIndex].id;
            }
            if (
              targetLayer.kind !== "raster" ||
              !targetLayer.effects.some((effect) => effect.id === effectId)
            ) {
              throw new Error(
                "Referenced effect does not exist on the target layer.",
              );
            }
            const cmd: EditorCommand =
              step.action.type === "effect.update"
                ? {
                    type: "effect.update",
                    id: targetLayer.id,
                    effectId,
                    values: step.action.values,
                  }
                : { type: "effect.remove", id: targetLayer.id, effectId };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            layersModified++;
            affectedLayerNames.add(targetLayer.name);
            visualChange = `${step.action.type === "effect.update" ? "Update" : "Remove"} effect on '${targetLayer.name}'`;
            break;
          }

          case "effect.reset": {
            if (!targetLayer || targetLayer.kind !== "raster")
              throw new Error("Effect reset requires a raster layer.");
            const cmd: EditorCommand = {
              type: "effect.reset",
              id: targetLayer.id,
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            layersModified++;
            affectedLayerNames.add(targetLayer.name);
            visualChange = `Reset effects on '${targetLayer.name}'`;
            break;
          }

          case "document.resizeImage":
          case "document.resize": {
            const w = Math.round(Number(actionValue(step.action.width)));
            const h = Math.round(Number(actionValue(step.action.height)));
            if (
              w < 1 ||
              h < 1 ||
              !Number.isSafeInteger(w) ||
              !Number.isSafeInteger(h)
            ) {
              throw new Error(
                `Resize dimensions must be positive integers: ${w} × ${h}`,
              );
            }
            const cmd: EditorCommand = {
              type: step.action.type,
              width: w,
              height: h,
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            canvasResized = true;
            visualChange = `Resize artboard from ${document.width}×${document.height} to ${w}×${h} px`;
            break;
          }

          case "document.crop": {
            const b = actionValue(step.action.bounds) as Record<
              string,
              unknown
            >;
            const bounds = {
              x: Math.round(Number(b.x)),
              y: Math.round(Number(b.y)),
              width: Math.round(Number(b.width)),
              height: Math.round(Number(b.height)),
            };
            const cmd: EditorCommand = {
              type: "document.crop",
              bounds,
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            canvasResized = true;
            visualChange = `Crop canvas to ${bounds.width}×${bounds.height} at (${bounds.x}, ${bounds.y})`;
            break;
          }

          case "document.rename": {
            const name = String(actionValue(step.action.name));
            const cmd: EditorCommand = {
              type: "document.rename",
              name,
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            visualChange = `Rename document to '${name}'`;
            break;
          }

          case "selection.set": {
            const cmd: EditorCommand = {
              type: "selection.set",
              selection: (step.action.selection as any) ?? null,
            };
            stepCommands.push(cmd);
            simDoc = execute(simDoc, cmd);
            visualChange = step.action.selection
              ? "Set canvas selection"
              : "Clear selection";
            break;
          }

          case "ai.generate": {
            requiresAI = true;
            stepSpend = step.action.estimatedCostCents ?? 2.0;
            estimatedSpendCents += stepSpend;
            const prompt = String(actionValue(step.action.prompt));
            visualChange = `AI Generation: "${prompt.slice(0, 60)}${prompt.length > 60 ? "..." : ""}" ($${(stepSpend / 100).toFixed(2)})`;
            errors.push(
              `Step '${step.name}' specifies 'ai.generate' which cannot be executed in offline synchronous transactions. Asynchronous AI steps must be scheduled via GenerationJobService.`,
            );
            preconditions.push({
              id: `ai-support-${step.id}`,
              description: `Execute AI generation step '${step.name}'`,
              satisfied: false,
              error:
                "Synchronous recipe execution does not support offline AI synthesis.",
            });
            break;
          }
        }

        resolvedCommands.push(...stepCommands);
        plannedSteps.push({
          stepId: targets.length > 1 ? `${step.id}:${targetId}` : step.id,
          stepName: step.name,
          skipped: false,
          resolvedTargetId: targetLayer?.id,
          resolvedTargetName: targetLayer?.name,
          resolvedCommand: stepCommands[0],
          expectedVisualChange: visualChange,
          estimatedSpendCents: stepSpend,
          actionType: step.action.type,
        });
      } catch (stepErr: unknown) {
        const msg =
          stepErr instanceof Error ? stepErr.message : String(stepErr);
        errors.push(`Step '${step.name}' failed: ${msg}`);
        preconditions.push({
          id: `step-eval-${step.id}`,
          description: `Execute step '${step.name}'`,
          satisfied: false,
          error: msg,
        });
        plannedSteps.push({
          stepId: targets.length > 1 ? `${step.id}:${targetId}` : step.id,
          stepName: step.name,
          skipped: false,
          resolvedTargetId: targetLayer?.id,
          resolvedTargetName: targetLayer?.name,
          expectedVisualChange: `Error: ${msg}`,
          estimatedSpendCents: 0,
          actionType: step.action.type,
        });
      }
    }
  }

  if (availableAssetIds) {
    const missing = [...referencedAssets(simDoc)].filter(
      (assetId) => !availableAssetIds.has(assetId),
    );
    if (missing.length) {
      const error = `Recipe requires unavailable image assets: ${missing.join(", ")}. Import the source assets or use a recipe that references this document's artwork.`;
      errors.push(error);
      preconditions.push({
        id: "recipe-assets",
        description: "All recipe image assets are available",
        satisfied: false,
        error,
      });
    }
  }
  const valid = errors.length === 0;

  return {
    recipeId: recipe.id,
    recipeName: recipe.name,
    valid,
    errors,
    warnings,
    preconditions,
    steps: plannedSteps,
    resolvedCommands,
    summary: {
      layersAdded,
      layersModified,
      layersRemoved,
      canvasResized,
      estimatedSpendCents,
      requiresAI,
      affectedLayerNames: Array.from(affectedLayerNames),
    },
    parameterValues: params,
    stepOutputs,
  };
}

export interface ExecuteRecipeResult {
  success: boolean;
  plan: EditPlan;
  error?: string;
}

/**
 * Executes a recipe atomically against a Document within a single transaction.
 * If dry-run fails, aborts immediately without modifying the document.
 * If any command fails mid-execution, transaction aborts and cleanly rolls back.
 */
export function executeRecipe(
  recipe: Recipe,
  document: Document,
  rawParams: Record<string, unknown> = {},
): ExecuteRecipeResult {
  const plan = compileEditPlan(
    recipe,
    document.toJSON(),
    document.selectedLayer?.id ?? null,
    rawParams,
    document.assetStore
      ? new Set(document.assetStore.values().map((asset) => asset.id))
      : undefined,
  );

  if (!plan.valid || plan.errors.length > 0) {
    const errorMsg = `Recipe '${recipe.name}' validation failed: ${plan.errors.join("; ")}`;
    return {
      success: false,
      plan,
      error: errorMsg,
    };
  }

  try {
    document.transaction(`Execute Recipe: ${recipe.name}`, () => {
      for (const cmd of plan.resolvedCommands) {
        document._dispatch(cmd);
      }
    });

    if (plan.stepOutputs && plan.stepOutputs.size > 0) {
      const lastCreatedId = Array.from(plan.stepOutputs.values()).pop();
      if (lastCreatedId) {
        const createdLayer = document.getLayer(lastCreatedId);
        if (createdLayer) {
          document.selectedLayer = createdLayer;
        }
      }
    }

    return {
      success: true,
      plan,
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      plan,
      error: `Execution error: ${message}. Document state rolled back.`,
    };
  }
}
