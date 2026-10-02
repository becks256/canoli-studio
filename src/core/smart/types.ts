import type { LayerMaskData } from "../masks";
import type { SmartFilterData } from "./filters";
import type {
  DocumentData,
  GroupLayerData,
  LayerBaseData,
  LayerData,
} from "../model";

/** Embedded component graph contracts shared by schema 12, commands and the public DOM. */
export interface SmartObjectInstanceData extends LayerBaseData {
  kind: "smart-object";
  componentId: string;
  width: number;
  height: number;
  smartFilters?: SmartFilterData[];
  filterMask?: LayerMaskData | null;
}
export type SmartLayerData =
  Exclude<LayerData, GroupLayerData> | SmartObjectInstanceData | SmartGroupData;
export interface SmartGroupData extends Omit<GroupLayerData, "children"> {
  children: SmartLayerData[];
}
export interface SmartDocumentData extends Omit<DocumentData, "children"> {
  children: SmartLayerData[];
}
export interface LinkedImageFile {
  kind: "local-file";
  name: string;
  sha256: string;
  byteLength: number;
  lastModified: number;
}
export type SmartObjectSource =
  | {
      kind: "asset";
      assetId: string;
      width: number;
      height: number;
      link?: LinkedImageFile;
    }
  | { kind: "document"; document: SmartDocumentData };
export interface SmartComponentDefinition {
  id: string;
  name: string;
  source: SmartObjectSource;
}
