import { z } from "zod";
import { BudgetLedger } from "./ledger";
import type { BudgetLedgerSnapshot } from "./ledger";
import type { HumanApprovedBudget } from "../providers/types";

const identifier = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0);
const entrySchema = z
  .object({
    jobId: identifier,
    budgetId: identifier,
    providerId: identifier,
    requestFingerprint: identifier,
    idempotencyKey: identifier.optional(),
    billingState: z.enum(["reserved", "pending", "settled"]),
    estimatedCostCents: z.number().positive(),
    actualCostCents: z.number().nonnegative().optional(),
    reservationId: identifier.optional(),
    createdAt: z.string().refine((value) => Number.isFinite(Date.parse(value))),
  })
  .strict();
export type GenerationJournalEntry = z.infer<typeof entrySchema>;
export interface GenerationJournalSnapshot {
  schemaVersion: 1;
  ledger: BudgetLedgerSnapshot;
  entries: GenerationJournalEntry[];
}

function validate(value: unknown): GenerationJournalSnapshot {
  const parsed = z
    .object({
      schemaVersion: z.literal(1),
      ledger: z.unknown(),
      entries: z.array(entrySchema),
    })
    .strict()
    .parse(value);
  const ledger = new BudgetLedger();
  ledger.restore(parsed.ledger);
  const snapshot = ledger.snapshot();
  const jobs = new Set<string>();
  const keys = new Set<string>();
  const reservations = new Map(
    snapshot.reservations.map((reservation) => [
      reservation.reservationId,
      reservation,
    ]),
  );
  for (const entry of parsed.entries) {
    if (jobs.has(entry.jobId)) throw new Error("Duplicate journal job.");
    jobs.add(entry.jobId);
    if (!ledger.getBudget(entry.budgetId))
      throw new Error("Journal job references a missing budget.");
    if (entry.idempotencyKey) {
      if (keys.has(entry.idempotencyKey))
        throw new Error("Duplicate journal idempotency key.");
      keys.add(entry.idempotencyKey);
    }
    if (entry.billingState === "settled") {
      if (
        entry.actualCostCents === undefined ||
        entry.reservationId !== undefined
      )
        throw new Error("Invalid settled journal accounting.");
    } else {
      const reservation = entry.reservationId
        ? reservations.get(entry.reservationId)
        : undefined;
      if (
        !reservation ||
        reservation.jobId !== entry.jobId ||
        reservation.budgetId !== entry.budgetId ||
        reservation.amountCents !== entry.estimatedCostCents ||
        entry.actualCostCents !== undefined
      ) {
        throw new Error(
          "Journal job reservation does not match its accounting.",
        );
      }
      reservations.delete(reservation.reservationId);
    }
  }
  if (reservations.size)
    throw new Error("Journal contains orphaned reservations.");
  return { schemaVersion: 1, ledger: snapshot, entries: parsed.entries };
}

function empty(): GenerationJournalSnapshot {
  return {
    schemaVersion: 1,
    ledger: new BudgetLedger().snapshot(),
    entries: [],
  };
}

/** Atomic browser accounting journal. No memory fallback and no provider credentials. */
export class GenerationJournal {
  private database?: Promise<IDBDatabase>;
  private async open(): Promise<IDBDatabase> {
    if (typeof indexedDB === "undefined")
      throw new Error("Durable generation storage is unavailable.");
    if (!this.database) {
      this.database = new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open("luma-generation-journal", 1);
        let blocked = false;
        request.onupgradeneeded = () =>
          request.result.createObjectStore("state");
        request.onerror = () =>
          reject(request.error ?? new Error("Cannot open generation journal."));
        request.onblocked = () => {
          blocked = true;
          reject(
            new Error("Generation journal upgrade is blocked by another tab."),
          );
        };
        request.onsuccess = () => {
          const db = request.result;
          if (blocked) {
            db.close();
            return;
          }
          db.onversionchange = () => {
            db.close();
            this.database = undefined;
          };
          resolve(db);
        };
      }).catch((error) => {
        this.database = undefined;
        throw error;
      });
    }
    return this.database;
  }

  private async transaction<T>(
    write: boolean,
    action: (state: GenerationJournalSnapshot) => T,
  ): Promise<T> {
    const db = await this.open();
    return new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(
        "state",
        write ? "readwrite" : "readonly",
        { durability: "strict" },
      );
      let result: T;
      let failure: unknown;
      transaction.oncomplete = () => resolve(structuredClone(result));
      transaction.onabort = () =>
        reject(
          failure ??
            transaction.error ??
            new Error("Generation journal transaction aborted."),
        );
      transaction.onerror = () => {
        failure ??= transaction.error;
      };
      const store = transaction.objectStore("state");
      const request = store.get("journal");
      request.onsuccess = () => {
        try {
          const state =
            request.result === undefined ? empty() : validate(request.result);
          result = action(state);
          if (write) store.put(validate(state), "journal");
        } catch (error) {
          failure = error;
          transaction.abort();
        }
      };
    });
  }

  read(): Promise<GenerationJournalSnapshot> {
    return this.transaction(false, (state) => state);
  }

  /** Read-only lookup works even when the original provider is no longer configured. */
  findRequest(
    idempotencyKey: string,
    requestFingerprint: string,
    providerId: string,
    budgetId: string,
  ): Promise<GenerationJournalEntry | undefined> {
    return this.transaction(false, (state) => {
      const key = idempotencyKey.trim();
      const existing = key
        ? state.entries.find((entry) => entry.idempotencyKey === key)
        : undefined;
      if (
        existing &&
        (existing.requestFingerprint !== requestFingerprint ||
          existing.providerId !== providerId ||
          existing.budgetId !== budgetId)
      ) {
        throw new Error(
          "Idempotency key already belongs to a different generation request.",
        );
      }
      return existing;
    });
  }

  /** Reserve and deduplicate in one transaction shared by every tab. */
  reserve(input: {
    jobId: string;
    budgetId: string;
    providerId: string;
    requestFingerprint: string;
    idempotencyKey?: string;
    estimatedCostCents: number;
    initialBudget: HumanApprovedBudget;
  }): Promise<GenerationJournalEntry> {
    const config = structuredClone(input);
    return this.transaction(true, (state) => {
      const key = config.idempotencyKey?.trim() || undefined;
      const existing = key
        ? state.entries.find((entry) => entry.idempotencyKey === key)
        : undefined;
      if (existing) {
        if (
          existing.requestFingerprint !== config.requestFingerprint ||
          existing.providerId !== config.providerId ||
          existing.budgetId !== config.budgetId
        ) {
          throw new Error(
            "Idempotency key already belongs to a different generation request.",
          );
        }
        return existing;
      }
      if (state.entries.some((entry) => entry.jobId === config.jobId))
        throw new Error("Journal job already exists.");
      const ledger = new BudgetLedger();
      ledger.restore(state.ledger);
      if (!ledger.getBudget(config.budgetId))
        ledger.createBudget({
          budgetId: config.budgetId,
          ...config.initialBudget,
        });
      const reservation = ledger.reserve(
        config.budgetId,
        config.jobId,
        config.estimatedCostCents,
      );
      const entry: GenerationJournalEntry = {
        jobId: config.jobId,
        budgetId: config.budgetId,
        providerId: config.providerId,
        requestFingerprint: config.requestFingerprint,
        idempotencyKey: key,
        estimatedCostCents: config.estimatedCostCents,
        reservationId: reservation.reservationId,
        billingState: "reserved",
        createdAt: new Date().toISOString(),
      };
      state.entries.push(entry);
      state.ledger = ledger.snapshot();
      return entry;
    });
  }

  /** Must commit before invoking the provider. A recovered pending job must not redispatch. */
  beginDispatch(jobId: string): Promise<GenerationJournalEntry> {
    return this.transaction(true, (state) => {
      const entry = state.entries.find((entry) => entry.jobId === jobId);
      if (!entry || entry.billingState !== "reserved")
        throw new Error("Job is not available for dispatch.");
      const ledger = new BudgetLedger();
      ledger.restore(state.ledger);
      ledger.requireConsent(entry.budgetId);
      entry.billingState = "pending";
      return entry;
    });
  }

  setConsent(
    budgetId: string,
    consentGiven: boolean,
    approverId?: string,
    initialBudget?: HumanApprovedBudget,
  ): Promise<void> {
    return this.transaction(true, (state) => {
      const ledger = new BudgetLedger();
      ledger.restore(state.ledger);
      if (!ledger.getBudget(budgetId) && initialBudget)
        ledger.createBudget({ budgetId, ...initialBudget });
      ledger.setConsent(budgetId, consentGiven, approverId);
      state.ledger = ledger.snapshot();
    });
  }

  /** Provider-confirmed accounting; repeated identical settlement cannot double-charge. */
  settle(
    jobId: string,
    actualCostCents: number,
  ): Promise<GenerationJournalEntry> {
    return this.transaction(true, (state) => {
      const entry = state.entries.find((entry) => entry.jobId === jobId);
      if (!entry) throw new Error("Unknown journal job.");
      if (entry.billingState === "settled") {
        if (entry.actualCostCents !== actualCostCents)
          throw new Error("Conflicting final journal charge.");
        return entry;
      }
      if (entry.billingState !== "pending")
        throw new Error("Job has not been dispatched.");
      const ledger = new BudgetLedger();
      ledger.restore(state.ledger);
      ledger.commit(entry.reservationId!, actualCostCents);
      entry.billingState = "settled";
      entry.actualCostCents = actualCostCents;
      delete entry.reservationId;
      state.ledger = ledger.snapshot();
      return entry;
    });
  }

  cancelQueued(jobId: string): Promise<GenerationJournalEntry> {
    return this.transaction(true, (state) => {
      const entry = state.entries.find((entry) => entry.jobId === jobId);
      if (entry?.billingState === "settled" && entry.actualCostCents === 0)
        return entry;
      if (!entry || entry.billingState !== "reserved")
        throw new Error(
          "Only an undispatched job can release its reservation without billing evidence.",
        );
      const ledger = new BudgetLedger();
      ledger.restore(state.ledger);
      ledger.release(entry.reservationId!);
      entry.billingState = "settled";
      entry.actualCostCents = 0;
      delete entry.reservationId;
      state.ledger = ledger.snapshot();
      return entry;
    });
  }
}
