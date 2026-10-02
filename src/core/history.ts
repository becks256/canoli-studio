import { z } from "zod";
import { validateDocument, type DocumentData } from "./model";

export interface HistoryEntry {
  canvasChanged: boolean;
  document: DocumentData;
  label: string;
}
export interface RetainedHistory {
  version: 1;
  past: HistoryEntry[];
  future: HistoryEntry[];
}
const entrySchema = z
  .object({
    canvasChanged: z.boolean(),
    document: z.unknown(),
    label: z.string(),
  })
  .strict();
const schema = z
  .object({
    version: z.literal(1),
    past: z.array(entrySchema).max(60),
    future: z.array(entrySchema).max(60),
  })
  .strict()
  .refine(
    (value) => value.past.length + value.future.length <= 60,
    "Retained history exceeds the 60-entry budget.",
  );

/** Validate every state before any workspace session is installed. */
export function parseRetainedHistory(
  input: unknown,
  current: DocumentData,
): RetainedHistory {
  const parsed = schema.parse(input);
  const validate = (entry: z.infer<typeof entrySchema>): HistoryEntry => {
    validateDocument(entry.document);
    if (entry.document.id !== current.id)
      throw new Error("History entry belongs to another document.");
    return { ...entry, document: structuredClone(entry.document) };
  };
  return {
    version: 1,
    past: parsed.past.map(validate),
    future: parsed.future.map(validate),
  };
}
