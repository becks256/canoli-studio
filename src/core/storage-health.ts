export type StorageManagerAccess = Partial<
  Pick<StorageManager, "estimate" | "persisted" | "persist">
>;
export interface StorageHealth {
  usage?: number;
  quota?: number;
  persisted?: boolean;
  canRequestPersistence: boolean;
  errors: string[];
}
function browserStorage(): StorageManagerAccess | undefined {
  return typeof navigator === "undefined" ? undefined : navigator.storage;
}
const bytes = (value: unknown): value is number =>
  typeof value === "number" && Number.isFinite(value) && value >= 0;

/** Origin-wide estimates, independent of checkpoint validity and save success. */
export async function readStorageHealth(
  storage = browserStorage(),
): Promise<StorageHealth> {
  const result: StorageHealth = {
    canRequestPersistence: typeof storage?.persist === "function",
    errors: [],
  };
  const [estimate, persistence] = await Promise.allSettled([
    Promise.resolve().then(() => storage?.estimate?.()),
    Promise.resolve().then(() => storage?.persisted?.()),
  ]);
  if (estimate.status === "fulfilled") {
    if (bytes(estimate.value?.usage)) result.usage = estimate.value.usage;
    if (bytes(estimate.value?.quota) && estimate.value.quota > 0)
      result.quota = estimate.value.quota;
  } else result.errors.push("Storage usage could not be read.");
  if (persistence.status === "fulfilled") {
    if (typeof persistence.value === "boolean")
      result.persisted = persistence.value;
  } else result.errors.push("Storage persistence status could not be read.");
  return result;
}

/** Only invoke from an explicit user action; browsers may decline the request. */
export async function requestStoragePersistence(
  storage = browserStorage(),
): Promise<boolean> {
  if (!storage?.persist)
    throw new Error(
      "Persistent storage requests are unavailable in this browser.",
    );
  return storage.persist();
}
