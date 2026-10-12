/** Host-only execution controls; not part of serialized export options. */
export interface ExportProgress { phase: 'rendering' | 'encoding'; fraction: number | null }
export interface ExportControl { signal?: AbortSignal; onProgress?(progress: ExportProgress): void }
export function checkExport(control?: ExportControl) { control?.signal?.throwIfAborted(); }
