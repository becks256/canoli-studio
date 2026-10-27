import { isImmutable } from "../immutable";
import {visitMaskAssets} from '../asset-references';
import {assertBrushVersion} from '../drawing';
import { rebindLayerComps } from "../layer-comps";
import { layerMaskSchema,assertMaskOperationVersion } from "../masks";
import { smartFiltersSchema } from "./filters";
import { z } from "zod";
import {
  referencedAssets,
  validateDocument,
  type DocumentData,
  type LayerData,
} from "../model";
import type {
  SmartComponentDefinition,
  SmartDocumentData,
  SmartLayerData,
} from "./types";

const identifier = z.string().min(1).max(240);
const dimension = z
  .number()
  .finite()
  .int()
  .positive()
  .max(Number.MAX_SAFE_INTEGER);
const linkedImageFileSchema = z
  .object({
    kind: z.literal("local-file"),
    name: z.string().min(1).max(1024),
    sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteLength: z.number().int().nonnegative(),
    lastModified: z.number().int(),
  })
  .strict();
export const componentDefinitionSchema = z
  .object({
    id: identifier,
    name: identifier,
    source: z.discriminatedUnion("kind", [
      z
        .object({
          kind: z.literal("asset"),
          assetId: identifier,
          width: dimension,
          height: dimension,
          link: linkedImageFileSchema.optional(),
        })
        .strict(),
      z.object({ kind: z.literal("document"), document: z.unknown() }).strict(),
    ]),
  })
  .strict();

/** Validate ordinary layer properties through the existing model, without persisting placeholders. */
function inspectDocument(input: unknown, retainImmutable = false): {
  document: SmartDocumentData;
  references: string[];
  assets: Set<string>;
} {
  if (
    !input ||
    typeof input !== "object" ||
    !("children" in input) ||
    !Array.isArray(input.children)
  )
    throw new Error("Invalid component document.");
  if('precision'in input&&input.precision==='float32')throw new Error('Smart-object embedding requires its float document integration.');
  const references: string[] = [];
  const filterAssets = new Set<string>();
  const ancestors = new Set<object>();
  function convert(
    value: unknown,
    depth: number,
    forAssets: boolean,
  ): LayerData {
    if (
      !value ||
      typeof value !== "object" ||
      ancestors.has(value) ||
      depth > 8
    )
      throw new Error("Invalid component layer tree.");
    ancestors.add(value);
    try {
      const layer = value as SmartLayerData;
      if (layer.kind === "group") {
        if (!Array.isArray(layer.children))
          throw new Error("Invalid component group.");
        return {
          ...layer,
          children: layer.children.map((child) =>
            convert(child, depth + 1, forAssets),
          ),
        };
      }
      if ((layer.blendMode === "linear-light" || layer.blendMode === "linear-burn") && Number((input as SmartDocumentData).schemaVersion) < 36)
        throw new Error("Linear Light requires schema version 36.");
      if (layer.kind === "smart-object") {
        if (Number((input as SmartDocumentData).schemaVersion) < 10)
          throw new Error("Smart objects require schema version 10.");
        identifier.parse(layer.componentId);
        if (layer.filterMask != null) {
          if (Number((input as SmartDocumentData).schemaVersion) < 12)
            throw new Error("Smart-filter masks require schema version 12.");
          const mask = layerMaskSchema.parse(layer.filterMask);
          assertMaskOperationVersion(mask,Number((input as SmartDocumentData).schemaVersion));
          visitMaskAssets(mask,reference=>filterAssets.add(reference.assetId));
          for(const entry of mask.strokes??[])assertBrushVersion(entry.stroke.kind==='wet'?entry.stroke.brush:entry.stroke,Number((input as SmartDocumentData).schemaVersion));
        }
        if (layer.smartFilters !== undefined) {
          if (Number((input as SmartDocumentData).schemaVersion) < 11)
            throw new Error("Smart filters require schema version 11.");
          smartFiltersSchema.parse(layer.smartFilters);
          if(Number((input as SmartDocumentData).schemaVersion)<39&&layer.smartFilters.some(f=>f.kind==='bilateral-denoise'))
            throw new Error('Bilateral denoise filters require schema version 39.');
          if (Number((input as SmartDocumentData).schemaVersion) < 38 && layer.smartFilters.some(f=>f.kind==='median'))
            throw new Error('Median filters require schema version 38.');
          if (Number((input as SmartDocumentData).schemaVersion) < 36 && layer.smartFilters.some(f => f.kind === "frequency-band" || f.kind === "native-composition" || f.kind === "document-tone"))
            throw new Error("Frequency bands require schema version 36.");
        }
        z.number()
          .finite()
          .min(1)
          .max(Number.MAX_SAFE_INTEGER)
          .parse(layer.width);
        z.number()
          .finite()
          .min(1)
          .max(Number.MAX_SAFE_INTEGER)
          .parse(layer.height);
        if (!forAssets) references.push(layer.componentId);
        const {
          componentId: _reference,
          kind: _kind,
          width,
          height,
          ...base
        } = layer;
        // A group retains mask references without inventing a source asset for the instance.
        if (forAssets) return { ...base, kind: "group", children: [] };
        return {
          ...base,
          kind: "raster",
          width,
          height,
          assetId: "component-validation-placeholder",
          effects: [],
        };
      }
      return layer as LayerData;
    } finally {
      ancestors.delete(value);
    }
  }
  const document = input as SmartDocumentData;
  const { components: _definitions, ...ordinary } = document;
  const compatible = {
    ...ordinary,
    children: document.children.map((layer) => convert(layer, 0, false)),
  };
  validateDocument(compatible);
  const assets = referencedAssets({
    ...ordinary,
    children: document.children.map((layer) => convert(layer, 0, true)),
  } as DocumentData);
  for (const asset of filterAssets) assets.add(asset);
  return { document: retainImmutable && isImmutable(document) ? document : structuredClone(document), references, assets };
}

/** Immutable graph snapshots: validation must finish before callers publish a replacement. */
export class ComponentRegistry {
  private readonly definitions = new Map<string, SmartComponentDefinition>();
  private readonly dependencies = new Map<string, Set<string>>();
  private readonly dependents = new Map<string, Set<string>>();
  private readonly referenceCounts = new Map<string, number>();
  private readonly sourceAssets = new Set<string>();

  constructor(definitions: readonly SmartComponentDefinition[] = []) {
    for (const input of definitions) {
      const parsed = componentDefinitionSchema.parse(input);
      if (this.definitions.has(parsed.id))
        throw new Error(`Duplicate component definition: ${parsed.id}`);
      let definition: SmartComponentDefinition;
      let references: string[] = [];
      if (parsed.source.kind === "document") {
        if (
          parsed.source.document &&
          typeof parsed.source.document === "object" &&
          "components" in parsed.source.document &&
          parsed.source.document.components !== undefined
        )
          throw new Error(
            "Component masters must use the owning document registry.",
          );
        const inspected = inspectDocument(parsed.source.document);
        definition = {
          id: parsed.id,
          name: parsed.name,
          source: { kind: "document", document: inspected.document },
        };
        references = inspected.references;
        for (const asset of inspected.assets) this.sourceAssets.add(asset);
      } else {
        definition = structuredClone(parsed) as SmartComponentDefinition;
        this.sourceAssets.add(parsed.source.assetId);
      }
      this.definitions.set(definition.id, definition);
      this.dependencies.set(definition.id, new Set(references));
      for (const reference of references)
        this.referenceCounts.set(
          reference,
          (this.referenceCounts.get(reference) ?? 0) + 1,
        );
    }
    for (const [id, references] of this.dependencies)
      for (const reference of references) {
        if (!this.definitions.has(reference))
          throw new Error(
            `Component '${id}' references missing component '${reference}'.`,
          );
        const parents = this.dependents.get(reference) ?? new Set();
        parents.add(id);
        this.dependents.set(reference, parents);
      }
    // Kahn traversal avoids call-stack limits on deep component dependency chains.
    const remaining = new Map(
      [...this.dependencies].map(([id, refs]) => [id, refs.size]),
    );
    const ready = [...remaining]
      .filter(([, count]) => count === 0)
      .map(([id]) => id);
    for (let index = 0; index < ready.length; index++)
      for (const parent of this.dependents.get(ready[index]) ?? []) {
        const count = remaining.get(parent)! - 1;
        remaining.set(parent, count);
        if (count === 0) ready.push(parent);
      }
    if (ready.length !== this.definitions.size)
      throw new Error("Circular smart-object component dependency.");
  }

  validatePlacements(document: SmartDocumentData): SmartDocumentData {
    return this.placements(document, false);
  }

  /** @internal Read-only render view; only proven immutable input may be shared. */
  validatedView(document: SmartDocumentData): SmartDocumentData {
    return this.placements(document, true);
  }

  private placements(document: SmartDocumentData, retainImmutable: boolean): SmartDocumentData {
    const inspected = inspectDocument(document, retainImmutable);
    for (const reference of inspected.references)
      if (!this.definitions.has(reference)) {
        throw new Error(
          `Document references missing component '${reference}'.`,
        );
      }
    return inspected.document;
  }

  get(id: string): SmartComponentDefinition {
    const definition = this.definitions.get(id);
    if (!definition) throw new Error(`Unknown component: ${id}`);
    return structuredClone(definition);
  }
  values(): SmartComponentDefinition[] {
    return [...this.definitions.values()].map((value) =>
      structuredClone(value),
    );
  }
  assetIds(): Set<string> {
    return new Set(this.sourceAssets);
  }
  /** Root and all transitively referenced masters, once each, including diamond dependencies. */
  reachableFrom(id: string): Set<string> {
    this.get(id);
    const result = new Set([id]);
    for (const current of result)
      for (const child of this.dependencies.get(current) ?? [])
        result.add(child);
    return result;
  }

  /** Clone a complete reachable graph without copying or rewriting immutable image assets. */
  withIndependentCopy(
    id: string,
    ids: Record<string, string>,
  ): ComponentRegistry {
    return this.withDefinitions(this.copyDefinitions([id], ids, true)).registry;
  }

  /** Return a detached, closed graph for one or more roots, retaining shared descendants. */
  copyDefinitions(
    roots: readonly string[],
    ids: Record<string, string>,
    renameRoots = false,
  ): SmartComponentDefinition[] {
    const rootIds = new Set(roots);
    const reachable = new Set(
      [...rootIds].flatMap((key) => [...this.reachableFrom(key)]),
    );
    const mapping = new Map(Object.entries(ids));
    if (
      mapping.size !== reachable.size ||
      [...reachable].some((key) => !mapping.has(key))
    ) {
      throw new Error(
        "Independent copy requires exactly one new ID for each reachable component.",
      );
    }
    const assigned = new Set<string>();
    for (const value of mapping.values()) {
      identifier.parse(value);
      if (this.definitions.has(value) || assigned.has(value))
        throw new Error("Copied component IDs must be unique and unused.");
      assigned.add(value);
    }
    const definitions = [...reachable].map((key) => {
      const definition = this.get(key);
      definition.id = mapping.get(key)!;
      if (renameRoots && rootIds.has(key))
        definition.name = `${definition.name.slice(0, 234)} copy`;
      if (definition.source.kind === "document") {
        definition.source.document.id = definition.id;
        rebindLayerComps(definition.source.document);
        const remap = (layers: SmartLayerData[]) => {
          for (const layer of layers) {
            if (layer.kind === "smart-object")
              layer.componentId = mapping.get(layer.componentId)!;
            if (layer.kind === "group") remap(layer.children);
          }
        };
        remap(definition.source.document.children);
      }
      return definition;
    });
    return new ComponentRegistry(definitions).values();
  }

  /** Count placed references within masters, not root-document placements. */
  referenceCount(id: string): number {
    this.get(id);
    return this.referenceCounts.get(id) ?? 0;
  }
  affectedBy(id: string): Set<string> {
    this.get(id);
    const affected = new Set([id]);
    for (const current of affected)
      for (const parent of this.dependents.get(current) ?? [])
        affected.add(parent);
    return affected;
  }
  /** Batch replacement permits atomic edits to mutually related definitions. */
  withDefinitions(updates: readonly SmartComponentDefinition[]): {
    registry: ComponentRegistry;
    invalidated: Set<string>;
  } {
    const next = new Map(this.values().map((value) => [value.id, value]));
    const changed = new Set<string>();
    for (const update of updates) {
      if (changed.has(update.id))
        throw new Error(`Duplicate component update: ${update.id}`);
      changed.add(update.id);
      next.set(update.id, update);
    }
    const registry = new ComponentRegistry([...next.values()]);
    const invalidated = new Set<string>();
    for (const id of changed) {
      for (const dependent of registry.affectedBy(id))
        invalidated.add(dependent);
      if (this.definitions.has(id))
        for (const dependent of this.affectedBy(id)) invalidated.add(dependent);
    }
    return { registry, invalidated };
  }
  without(id: string): ComponentRegistry {
    this.get(id);
    if (this.referenceCount(id))
      throw new Error(
        `Component '${id}' is still referenced by another master.`,
      );
    return new ComponentRegistry(
      this.values().filter((value) => value.id !== id),
    );
  }
}
