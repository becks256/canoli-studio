/** Preserve ordinary errors; make browser quota failures actionable across save surfaces. */
export function storageErrorMessage(error: unknown): string {
  if (
    error &&
    typeof error === "object" &&
    "name" in error &&
    error.name === "QuotaExceededError"
  ) {
    return "Browser storage is full. Download your current projects as backups, remove unneeded saved work, then retry saving. Latest changes are not saved locally.";
  }
  return error instanceof Error ? error.message : String(error);
}
