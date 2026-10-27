import { TONE_LIMITS } from "../../core/tone";
import type { DocumentData, LayerData } from "../../core/model";
import { allLayers, findLayer, id } from "../../core/model";
import { execute } from "../../core/commands";
import {paragraphStyleSchema,paragraphTextLayers,PARAGRAPH_FORMAT_KEYS} from '../../core/paragraph-styles';
import type {RecipeParagraphStyleTarget} from './types';
import type { EditorCommand } from "../../core/commands";
import type {
  Recipe,
  RecipeParameter,
  RecipeStep,
  SemanticTarget,
} from "./types";
import { RECIPE_SCHEMA_VERSION } from "./types";
import {documentFontFiles,type FontFileData} from '../../core/font-files';
import {recipeFontIds} from './fonts';

export interface RecorderOptions {
  name?: string;
  description?: string;
  autoParameterizeTone?: boolean;
}

interface RecordingState {
  steps: RecipeStep[];
  unsupported: Set<string>;
  outputs: Map<string, SemanticTarget>;
  styles:Map<string,RecipeParagraphStyleTarget>;
  fonts:Map<string,FontFileData>;
  lastTarget: string | null;
}

export class RecipeRecorder {
  private active = false;
  private paused = false;
  private steps: RecipeStep[] = [];
  private unsupported = new Set<string>();

  private past: RecordingState[] = [];
  private future: RecordingState[] = [];
  private historyError?: string;

  getUnsupportedCommands(): string[] {
    return [
      ...this.unsupported,
      ...(this.historyError ? [this.historyError] : []),
    ];
  }

  private snapshot(): RecordingState {
    return structuredClone({
      steps: this.steps,
      unsupported: this.unsupported,
      outputs: this.createdLayerOutputs,
      styles:this.styleOutputs,
      fonts:this.fontFiles,
      lastTarget: this.lastCommandTargetLayerId,
    });
  }

  private restore(state: RecordingState): void {
    this.steps = state.steps;
    this.unsupported = state.unsupported;
    this.createdLayerOutputs = state.outputs;
    this.styleOutputs=state.styles;this.fontFiles=state.fonts;
    this.lastCommandTargetLayerId = state.lastTarget;
    this.notify();
  }

  invalidateHistory(reason: string): void {
    if (!this.active) return;
    this.historyError = reason;
    this.notify();
  }

  navigateHistory(direction: "undo" | "redo"): void {
    if (!this.active || this.historyError) return;
    const from = direction === "undo" ? this.past : this.future;
    const to = direction === "undo" ? this.future : this.past;
    const state = from.pop();
    if (!state) {
      this.invalidateHistory(
        "History crossed the recording boundary; start a new recording.",
      );
      return;
    }
    to.push(this.snapshot());
    this.restore(state);
  }
  private createdLayerOutputs = new Map<string, SemanticTarget>(); // creation-time identity for roots and descendants
  private styleOutputs=new Map<string,RecipeParagraphStyleTarget>();
  private fontFiles=new Map<string,FontFileData>();

  private captureFonts(value:unknown,before:DocumentData,after?:DocumentData):void{
    const ids=recipeFontIds(value);if(!ids.size)return;
    const available=[...documentFontFiles(before),...(after?documentFontFiles(after):[])];
    for(const id of ids)if(!this.fontFiles.has(id)){const file=available.find(file=>file.id===id);if(file)this.fontFiles.set(id,structuredClone(file));}
  }
  private captureStyle(styleId:string,document:DocumentData):RecipeParagraphStyleTarget {
    const existing=this.styleOutputs.get(styleId);if(existing)return structuredClone(existing);
    const style=document.paragraphStyles?.find(value=>value.id===styleId);
    if(!style)throw new Error('Recorded paragraph style is missing from its document.');
    const parsed=paragraphStyleSchema.parse(style),stepId=`step-${id()}`;this.captureFonts(parsed.format,document);
    const basedOn=parsed.basedOn?{style:this.captureStyle(parsed.basedOn.id,document),overrides:structuredClone(parsed.basedOn.overrides)}:undefined;
    this.steps.push({id:stepId,name:`Use paragraph style ${parsed.name}`,action:{type:'paragraphStyle.ensure',name:parsed.name,format:parsed.format,...(basedOn?{basedOn}:{})}});
    const reference:RecipeParagraphStyleTarget={by:'stepResult',stepId};
    this.styleOutputs.set(styleId,reference);return structuredClone(reference);
  }
  private initialSelectedId: string | null = null;
  private lastCommandTargetLayerId: string | null = null;
  private listeners = new Set<() => void>();

  constructor(private readonly assetSource?:(id:string)=>Pick<import('../../core/assets').ImageAsset,'raw'>) {}

  isRecording(): boolean {
    return this.active && !this.paused;
  }

  isPaused(): boolean {
    return this.active && this.paused;
  }

  getRecordedSteps(): RecipeStep[] {
    return [...this.steps];
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notify() {
    for (const listener of this.listeners) {
      try {
        listener();
      } catch (e) {
        console.error("RecipeRecorder listener error:", e);
      }
    }
  }

  start(selectedId: string | null = null): void {
    this.active = true;
    this.paused = false;
    this.steps = [];
    this.past = [];
    this.future = [];
    this.historyError = undefined;
    this.unsupported.clear();
    this.createdLayerOutputs.clear();
    this.styleOutputs.clear();this.fontFiles.clear();
    this.initialSelectedId = selectedId;
    this.lastCommandTargetLayerId = null;
    this.notify();
  }

  pause(): void {
    if (this.active) {
      this.paused = true;
      this.notify();
    }
  }

  resume(): void {
    if (this.active) {
      this.paused = false;
      this.lastCommandTargetLayerId = null;
      this.notify();
    }
  }

  setSelectedId(_selectedId: string | null): void {
    // Optional selection state hook
  }

  private trackCreatedTree(
    layer: LayerData,
    stepId: string,
    childPath: number[] = [],
  ): void {
    this.createdLayerOutputs.set(layer.id, {
      by: "stepResult",
      stepId,
      ...(childPath.length ? { childPath } : {}),
    });
    if (layer.kind === "group")
      layer.children.forEach((child, index) =>
        this.trackCreatedTree(child, stepId, [...childPath, index]),
      );
  }

  recordCommand(
    command: EditorCommand,
    beforeDoc: DocumentData,
    afterDoc: DocumentData,
  ): void {
    if (!this.active || this.historyError) return;
    this.past.push(this.snapshot());
    this.past = this.past.slice(-60); // Match the document's retained undo window.
    this.future = [];
    this.captureCommand(command, beforeDoc, afterDoc);
  }

  private captureCommand(
    command: EditorCommand,
    beforeDoc: DocumentData,
    afterDoc: DocumentData,
  ): void {
    if (!this.active || this.paused) return;

    if (command.type === "transaction") {
      let currentDoc = beforeDoc;
      for (const child of command.commands) {
        let nextDoc = currentDoc;
        try {
          nextDoc = execute(currentDoc, child);
        } catch {
          nextDoc = afterDoc;
        }
        this.captureCommand(child, currentDoc, nextDoc);
        currentDoc = nextDoc;
      }
      return;
    }

    this.captureFonts(command,beforeDoc,afterDoc);

    const targetFromLayer = (layer: LayerData): SemanticTarget => {
      const priorStepResult = this.createdLayerOutputs.get(layer.id);
      if (priorStepResult) {
        return structuredClone(priorStepResult);
      }
      if (this.initialSelectedId && layer.id === this.initialSelectedId) {
        return { role: "selected" };
      }
      return { by: "name", pattern: layer.name, literal: true };
    };

    switch (command.type) {
      case 'layer.align': {
        const reference=(layerId:string):SemanticTarget=>{
          const layer=findLayer(beforeDoc,layerId);if(!layer)throw new Error('Missing recorded alignment layer.');
          return this.createdLayerOutputs.has(layerId)?structuredClone(this.createdLayerOutputs.get(layerId)!):{by:'name',pattern:layer.name,literal:true,ambiguityStrategy:'fail'};
        };
        this.steps.push({id:`step-${id()}`,name:'Align layers',action:{type:'layer.align',targets:command.ids.map(reference),alignment:command.alignment,
          reference:command.target?.type==='layer'?{type:'layer',layer:reference(command.target.id)}:command.target??{type:'selection'}}});
        this.lastCommandTargetLayerId=null;this.notify();break;
      }
      case 'font.file.add':
      case 'font.file.rename':
      case 'font.file.remove': {
        const action=command.type==='font.file.add'?{type:command.type,id:command.file.id}:structuredClone(command);
        this.steps.push({id:`step-${id()}`,name:'Update embedded font file',action});this.lastCommandTargetLayerId=null;this.notify();break;
      }
      case 'component.set': {
        const previous=beforeDoc.components?.find(value=>value.id===command.definition.id),source=command.definition.source;
        const layer=allLayers(beforeDoc.children).filter(value=>value.kind==='smart-object'&&value.componentId===command.definition.id)
          .sort((a,b)=>Number(b.id===this.initialSelectedId)-Number(a.id===this.initialSelectedId))[0];
        let recorded=false;
        if(previous?.source.kind==='asset'&&source.kind==='asset'&&layer&&this.assetSource){
          try{
            const before=this.assetSource(previous.source.assetId).raw,after=this.assetSource(source.assetId).raw;
            if(before&&after&&before.original.sha256===after.original.sha256&&before.original.byteLength===after.original.byteLength&&before.original.type===after.original.type&&
              JSON.stringify({...previous,source:null})===JSON.stringify({...command.definition,source:null})){
              this.steps.push({id:`step-${id()}`,name:`Develop RAW ${layer.name}`,target:targetFromLayer(layer),action:{type:'raw.develop',development:structuredClone(after.settings.development),allowPrecisionLoss:true}});recorded=true;
            }
          }catch{/* Unavailable provenance cannot become a semantic recording. */}
        }
        if(!recorded)this.unsupported.add(command.type);
        this.lastCommandTargetLayerId=null;this.notify();break;
      }
      case 'paragraphStyle.set': {
        const previous=beforeDoc.paragraphStyles?.find(style=>style.id===command.style.id);
        const style=paragraphStyleSchema.parse(command.style);
        if(previous){
          const reference=this.captureStyle(previous.id,beforeDoc);
          const stepId=`step-${id()}`;
          const basedOn=style.basedOn?{style:this.captureStyle(style.basedOn.id,beforeDoc),overrides:structuredClone(style.basedOn.overrides)}:undefined;
          this.steps.push({id:stepId,name:`Update paragraph style ${style.name}`,action:{type:'paragraphStyle.update',style:reference,name:style.name,format:style.format,...(basedOn?{basedOn}:{})}});
          this.styleOutputs.set(style.id,{by:'stepResult',stepId});
        }else{
          this.styleOutputs.delete(style.id);this.captureStyle(style.id,afterDoc);
        }
        this.lastCommandTargetLayerId=null;this.notify();break;
      }
      case 'paragraphStyle.remove': {
        const reference=this.captureStyle(command.id,beforeDoc);
        this.steps.push({id:`step-${id()}`,name:'Remove paragraph style',action:{type:'paragraphStyle.remove',style:reference}});
        this.styleOutputs.delete(command.id);this.lastCommandTargetLayerId=null;this.notify();break;
      }
      case 'text.paragraphStyle':
      case 'text.paragraphOverrides.clear': {
        const layer=findLayer(beforeDoc,command.id);if(!layer)return;
        const style=command.type==='text.paragraphStyle'&&command.styleId!==null?this.captureStyle(command.styleId,beforeDoc):null;
        this.steps.push({id:`step-${id()}`,name:`${command.type==='text.paragraphStyle'?'Apply or detach paragraph style':'Reset paragraph overrides'} on ${layer.name}`,
          target:targetFromLayer(layer),action:command.type==='text.paragraphStyle'
            ?{type:'text.paragraphStyle',style,keepOverrides:command.keepOverrides}
            :{type:'text.paragraphOverrides.clear',keys:command.keys?structuredClone(command.keys):undefined}});
        this.lastCommandTargetLayerId=null;this.notify();break;
      }
      case "layer.update": {
        const layer = findLayer(beforeDoc, command.id);
        if (!layer) return;
        const target = targetFromLayer(layer);
        const patch={...command.patch};
        // JSON has no undefined value. Preserve explicit inheritance resets as commands.
        const resetKeys=layer.kind==='text'&&layer.paragraphStyle
          ?PARAGRAPH_FORMAT_KEYS.filter(key=>key in patch&&patch[key]===undefined):[];
        if(resetKeys.length){
          for(const key of resetKeys)delete patch[key];
          this.steps.push({id:`step-${id()}`,name:`Reset paragraph overrides on ${layer.name}`,target,
            action:{type:'text.paragraphOverrides.clear',keys:resetKeys}});
          this.lastCommandTargetLayerId=null;
          if(!Object.keys(patch).length){this.notify();return;}
        }

        // Check if we can coalesce into previous layer.update on the SAME layer
        const lastStep = this.steps[this.steps.length - 1];
        if (
          lastStep &&
          lastStep.action.type === "layer.update" &&
          this.lastCommandTargetLayerId === layer.id
        ) {
          lastStep.action.patch = {
            ...lastStep.action.patch,
            ...patch,
          };
          this.notify();
          return;
        }

        this.steps.push({
          id: `step-${id()}`,
          name: `Update ${layer.name}`,
          target,
          action: {
            type: "layer.update",
            patch,
          },
        });
        this.lastCommandTargetLayerId = layer.id;
        this.notify();
        break;
      }

      case "effect.tone": {
        const layer = findLayer(beforeDoc, command.id);
        if (!layer) return;
        const target = targetFromLayer(layer);

        // Coalesce consecutive tone adjustments on the SAME layer
        const lastStep = this.steps[this.steps.length - 1];
        if (
          lastStep &&
          lastStep.action.type === "effect.tone" &&
          this.lastCommandTargetLayerId === layer.id
        ) {
          lastStep.action.values = {
            ...lastStep.action.values,
            ...command.values,
          };
          this.notify();
          return;
        }

        this.steps.push({
          id: `step-${id()}`,
          name: `Adjust tone on ${layer.name}`,
          target,
          action: {
            type: "effect.tone",
            values: { ...command.values },
          },
        });
        this.lastCommandTargetLayerId = layer.id;
        this.notify();
        break;
      }

      case "effect.add":
      case "effect.update": {
        const layer = findLayer(beforeDoc, command.id);
        if (!layer || layer.kind !== "raster") return;
        this.steps.push({
          id: `step-${id()}`,
          name: `${command.type === "effect.add" ? "Add" : "Update"} effect on ${layer.name}`,
          target: targetFromLayer(layer),
          action:
            command.type === "effect.add"
              ? { type: "effect.add", effect: structuredClone(command.effect) }
              : {
                  type: "effect.update",
                  effectIndex: layer.effects.findIndex(
                    (effect) => effect.id === command.effectId,
                  ),
                  values: structuredClone(command.values),
                },
        });
        this.notify();
        break;
      }

      case "effect.remove":
      case "effect.reset": {
        const layer = findLayer(beforeDoc, command.id);
        if (!layer || layer.kind !== "raster") return;
        this.steps.push({
          id: `step-${id()}`,
          name: `${command.type === "effect.remove" ? "Remove effect" : "Reset effects"} on ${layer.name}`,
          target: targetFromLayer(layer),
          action:
            command.type === "effect.reset"
              ? { type: "effect.reset" }
              : {
                  type: "effect.remove",
                  effectIndex: layer.effects.findIndex(
                    (effect) => effect.id === command.effectId,
                  ),
                },
        });
        this.notify();
        break;
      }

      case "layer.duplicate": {
        const layer = findLayer(beforeDoc, command.id);
        if (!layer) return;
        const target = targetFromLayer(layer);
        const stepId = `step-${id()}`;
        const outputVar = `output_${stepId}`;

        // Find newly duplicated layer in afterDoc to map to outputVar
        const beforeIds = new Set(
          allLayers(beforeDoc.children).map((l) => l.id),
        );
        const newLayer = allLayers(afterDoc.children).find(
          (l) => !beforeIds.has(l.id),
        );
        if (newLayer) {
          this.trackCreatedTree(newLayer, stepId);
        }

        this.steps.push({
          id: stepId,
          name: `Duplicate ${layer.name}`,
          target,
          action: {
            type: "layer.duplicate",
          },
          outputVar,
        });
        this.notify();
        break;
      }

      case "layer.remove": {
        const layer = findLayer(beforeDoc, command.id);
        if (!layer) return;
        const target = targetFromLayer(layer);
        this.steps.push({
          id: `step-${id()}`,
          name: `Remove ${layer.name}`,
          target,
          action: {
            type: "layer.remove",
          },
        });
        this.notify();
        break;
      }

      case "layer.reorder": {
        const layer = findLayer(beforeDoc, command.id);
        if (!layer) return;
        const target = targetFromLayer(layer);
        this.steps.push({
          id: `step-${id()}`,
          name: `Move ${layer.name} ${command.direction}`,
          target,
          action: {
            type: "layer.reorder",
            direction: command.direction,
          },
        });
        this.notify();
        break;
      }

      case "layer.add": {
        let parentTarget: SemanticTarget | undefined = undefined;
        if (command.parentId) {
          const parent = findLayer(beforeDoc, command.parentId);
          if (parent) {
            parentTarget = targetFromLayer(parent);
          }
        }
        const cleanTemplate = structuredClone(command.layer) as any;
        delete cleanTemplate.id;
        const paragraphStyles:Record<string,RecipeParagraphStyleTarget>={};
        for(const text of paragraphTextLayers([cleanTemplate]))if(text.paragraphStyle){
          const reference=this.captureStyle(text.paragraphStyle.id,beforeDoc);
          const key=`style-${Object.keys(paragraphStyles).length}`;
          paragraphStyles[key]=reference;text.paragraphStyle.id=key;
        }

        const stepId = `step-${id()}`;
        const outputVar = `output_${stepId}`;

        // Track the added layer's ID so subsequent operations on it reference stepResult
        this.trackCreatedTree(command.layer, stepId);

        this.steps.push({
          id: stepId,
          name: `Add ${command.layer.name}`,
          action: {
            type: "layer.add",
            layerTemplate: cleanTemplate,
            parentTarget,
            ...(Object.keys(paragraphStyles).length?{paragraphStyles}:{}),
          },
          outputVar,
        });
        this.notify();
        break;
      }

      case 'document.font.replace': {
        this.steps.push({id:`step-${id()}`,name:'Replace document font',action:{type:command.type,from:command.from,to:command.to}});
        this.lastCommandTargetLayerId=null;this.notify();break;
      }
      case 'document.precision.float':{
        this.steps.push({id:`step-${id()}`,name:'Use 32-bit linear editing',action:{type:'document.precision.float'}});this.notify();break;
      }
      case "document.rename": {
        this.steps.push({
          id: `step-${id()}`,
          name: "Rename Document",
          action: { type: "document.rename", name: command.name },
        });
        this.notify();
        break;
      }

      case "document.resizeImage":
      case "document.resize": {
        this.steps.push({
          id: `step-${id()}`,
          name: command.type === "document.resizeImage" ? "Resize Image" : "Resize Artboard",
          action: {
            type: command.type,
            width: command.width,
            height: command.height,
          },
        });
        this.notify();
        break;
      }

      case "document.crop": {
        this.steps.push({
          id: `step-${id()}`,
          name: `Crop Canvas`,
          action: {
            type: "document.crop",
            bounds: { ...command.bounds },
          },
        });
        this.notify();
        break;
      }

      case "selection.polygon":
      case "selection.set": {
        const selection = command.type === "selection.polygon" ? afterDoc.selection : command.selection;
        this.steps.push({
          id: `step-${id()}`,
          name: selection ? "Set Selection" : "Clear Selection",
          action: {
            type: "selection.set",
            selection: selection
              ? structuredClone(selection)
              : null,
          },
        });
        this.notify();
        break;
      }
      default:
        this.unsupported.add(command.type);
        this.lastCommandTargetLayerId = null;
        this.notify();
    }
  }

  stop(options: RecorderOptions = {}): Recipe {
    this.past = [];
    this.future = [];
    this.active = false;
    this.paused = false;
    if (this.historyError) {
      this.notify();
      throw new Error(this.historyError);
    }
    if (this.unsupported.size) {
      this.notify();
      throw new Error(
        `Recording contains unsupported commands: ${[...this.unsupported].join(", ")}. No partial recipe was saved. Start a new recording using supported actions.`,
      );
    }
    if (this.steps.length === 0) {
      this.notify();
      throw new Error(
        "No supported actions were recorded. No recipe was created.",
      );
    }

    const parameters: RecipeParameter[] = [];
    const steps = structuredClone(this.steps);
    // Display labels have a smaller contract than arbitrary document layer names.
    for (const step of steps) {
      step.name = step.name.slice(0, 240);
      step.literalValues = true;
    }

    if (options.autoParameterizeTone) {
      const existingNames = new Set(parameters.map((p) => p.name));
      let toneStepIndex = 1;
      for (const step of steps) {
        if (step.action.type === "effect.tone") {
          step.literalValues = false;
          const toneVals = step.action.values;
          const suffix = toneStepIndex > 1 ? `_${toneStepIndex}` : "";

          if (toneVals.exposure !== undefined) {
            let paramName = `exposure${suffix}`;
            let counter = 1;
            while (existingNames.has(paramName)) {
              paramName = `exposure_${toneStepIndex}_${counter++}`;
            }
            existingNames.add(paramName);
            parameters.push({
              name: paramName,
              label: toneStepIndex > 1 ? `Exposure (${step.name})` : "Exposure",
              type: "number",
              default: toneVals.exposure,
              ...TONE_LIMITS.exposure,
            });
            toneVals.exposure = `\${${paramName}}`;
          }
          if (toneVals.contrast !== undefined) {
            let paramName = `contrast${suffix}`;
            let counter = 1;
            while (existingNames.has(paramName)) {
              paramName = `contrast_${toneStepIndex}_${counter++}`;
            }
            existingNames.add(paramName);
            parameters.push({
              name: paramName,
              label: toneStepIndex > 1 ? `Contrast (${step.name})` : "Contrast",
              type: "number",
              default: toneVals.contrast,
              ...TONE_LIMITS.contrast,
            });
            toneVals.contrast = `\${${paramName}}`;
          }
          if (toneVals.saturation !== undefined) {
            let paramName = `saturation${suffix}`;
            let counter = 1;
            while (existingNames.has(paramName)) {
              paramName = `saturation_${toneStepIndex}_${counter++}`;
            }
            existingNames.add(paramName);
            parameters.push({
              name: paramName,
              label:
                toneStepIndex > 1 ? `Saturation (${step.name})` : "Saturation",
              type: "number",
              default: toneVals.saturation,
              ...TONE_LIMITS.saturation,
            });
            toneVals.saturation = `\${${paramName}}`;
          }
          toneStepIndex++;
        }
      }
    }

    const fonts=[...recipeFontIds(steps.map(step=>step.action))].map(id=>{
      const file=this.fontFiles.get(id);if(!file)throw new Error(`Recorded embedded font declaration is unavailable: ${id}. Embed the source before recording.`);return structuredClone(file);
    });
    const recipe: Recipe = {
      schemaVersion: fonts.length?2:RECIPE_SCHEMA_VERSION,
      ...(fonts.length?{fontFiles:fonts}:{}),
      id: `recipe-${id()}`,
      name: options.name?.trim() || "Recorded Action",
      description:
        options.description?.trim() ||
        `Deterministic recipe recorded with ${steps.length} action${steps.length === 1 ? "" : "s"}.`,
      version: 1,
      parameters,
      steps,
      tags: ["recorded", "user-recipe"],
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
    };

    this.steps = [];
    this.unsupported.clear();
    this.createdLayerOutputs.clear();
    this.styleOutputs.clear();this.fontFiles.clear();
    this.notify();
    return recipe;
  }
}
