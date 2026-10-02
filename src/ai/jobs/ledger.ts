/**
 * Human-Approved Budget Reservation Ledger.
 *
 * Enforces explicit human consent, authorized approver validation,
 * budget ceiling reservation before queueing, and exact reconciliation
 * on job completion, failure, or cancellation.
 */

import { z } from "zod";
import { id } from "../../core/model";
import type { HumanApprovedBudget } from "../providers/types";
import { BudgetExceededError, ConsentRequiredError } from "./types";

export interface BudgetReservation {
  reservationId: string;
  budgetId: string;
  jobId: string;
  amountCents: number;
  timestamp: string;
}

const identifier = z
  .string()
  .min(1)
  .refine((value) => value.trim().length > 0, "Identifier must not be blank");
const timestamp = z
  .string()
  .refine(
    (value) => Number.isFinite(Date.parse(value)),
    "Invalid ledger timestamp",
  );
const budgetSchema = z
  .object({
    approvedCeilingCents: z.number().positive(),
    consentGiven: z.boolean(),
    approverId: identifier,
    approvalTimestamp: timestamp,
    spentSoFarCents: z.number().nonnegative(),
    expiresAt: timestamp.optional(),
  })
  .strict();
const ledgerSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    budgets: z.array(
      z.object({ budgetId: identifier, budget: budgetSchema }).strict(),
    ),
    reservations: z.array(
      z
        .object({
          reservationId: identifier,
          budgetId: identifier,
          jobId: identifier,
          amountCents: z.number().positive(),
          timestamp,
        })
        .strict(),
    ),
  })
  .strict();

export type BudgetLedgerSnapshot = z.infer<typeof ledgerSnapshotSchema>;

export class BudgetLedger {
  private budgets = new Map<string, HumanApprovedBudget>();
  private reservations = new Map<string, BudgetReservation>();

  /** Detached, versioned host snapshot; no provider credentials or image data. */
  snapshot(): BudgetLedgerSnapshot {
    return ledgerSnapshotSchema.parse({
      schemaVersion: 1,
      budgets: this.listBudgets(),
      reservations: this.listReservations(),
    });
  }

  /** Validate the complete snapshot before replacing any live accounting state. */
  restore(snapshot: unknown): void {
    const parsed = ledgerSnapshotSchema.parse(snapshot);
    const budgets = new Map<string, HumanApprovedBudget>();
    const reservations = new Map<string, BudgetReservation>();
    const jobs = new Set<string>();
    for (const { budgetId, budget } of parsed.budgets) {
      if (budgets.has(budgetId))
        throw new Error(`Duplicate budget '${budgetId}' in ledger snapshot.`);
      budgets.set(budgetId, budget);
    }
    for (const reservation of parsed.reservations) {
      if (!budgets.has(reservation.budgetId))
        throw new Error("Reservation references a missing budget.");
      if (reservations.has(reservation.reservationId))
        throw new Error("Duplicate reservation in ledger snapshot.");
      if (jobs.has(reservation.jobId))
        throw new Error("Duplicate job reservation in ledger snapshot.");
      jobs.add(reservation.jobId);
      reservations.set(reservation.reservationId, reservation);
    }
    // Actual charges can exceed estimates; retain over-budget balances on recovery.
    this.budgets = budgets;
    this.reservations = reservations;
  }

  /**
   * Registers a human-approved budget allocation.
   */
  createBudget(config: {
    budgetId?: string;
    approverId: string;
    approvedCeilingCents: number;
    consentGiven?: boolean;
    spentSoFarCents?: number;
    approvalTimestamp?: string;
    expiresAt?: string;
  }): HumanApprovedBudget {
    if (!config.approverId || config.approverId.trim() === "") {
      throw new ConsentRequiredError(
        "Budget must be explicitly approved by an authorized user ID.",
      );
    }
    if (
      !Number.isFinite(config.approvedCeilingCents) ||
      config.approvedCeilingCents <= 0
    ) {
      throw new BudgetExceededError(
        "Approved budget ceiling must be greater than zero cents.",
      );
    }

    if (
      config.spentSoFarCents !== undefined &&
      (!Number.isFinite(config.spentSoFarCents) || config.spentSoFarCents < 0)
    ) {
      throw new BudgetExceededError(
        "Prior spending must be a non-negative finite number of cents.",
      );
    }
    const budgetId = identifier.parse(config.budgetId ?? id());
    if (this.budgets.has(budgetId))
      throw new Error(`Budget "${budgetId}" already exists.`);
    const budget: HumanApprovedBudget = {
      approvedCeilingCents: config.approvedCeilingCents,
      consentGiven: config.consentGiven ?? true,
      approverId: config.approverId.trim(),
      approvalTimestamp: config.approvalTimestamp || new Date().toISOString(),
      spentSoFarCents: config.spentSoFarCents || 0,
      expiresAt: config.expiresAt,
    };

    this.budgets.set(budgetId, budget);
    return { ...budget };
  }

  getBudget(budgetId: string): HumanApprovedBudget | undefined {
    const budget = this.budgets.get(budgetId);
    return budget ? { ...budget } : undefined;
  }

  listBudgets(): Array<{ budgetId: string; budget: HumanApprovedBudget }> {
    return Array.from(this.budgets.entries()).map(([budgetId, budget]) => ({
      budgetId,
      budget: { ...budget },
    }));
  }

  /**
   * Updates consent status or changes the authorized approver for a budget.
   */
  setConsent(
    budgetId: string,
    consentGiven: boolean,
    approverId?: string,
  ): void {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      throw new Error(`Budget "${budgetId}" not found.`);
    }
    budget.consentGiven = consentGiven;
    if (approverId && approverId.trim() !== "") {
      budget.approverId = approverId.trim();
      budget.approvalTimestamp = new Date().toISOString();
    }
  }

  /**
   * Sums active reservations for the specified budget.
   */
  getTotalReserved(budgetId: string): number {
    let total = 0;
    for (const res of this.reservations.values()) {
      if (res.budgetId === budgetId) {
        total += res.amountCents;
      }
    }
    return Math.round(total * 100) / 100;
  }

  /**
   * Returns remaining spendable ceiling for a budget (after accounting for spent and reserved funds).
   */
  getAvailableCeiling(budgetId: string): number {
    const budget = this.budgets.get(budgetId);
    if (!budget) return 0;
    const reserved = this.getTotalReserved(budgetId);
    return Math.max(
      0,
      Math.round(
        (budget.approvedCeilingCents - budget.spentSoFarCents - reserved) * 100,
      ) / 100,
    );
  }

  /** Recheck approval at the provider dispatch boundary without reserving twice. */
  requireConsent(budgetId: string): HumanApprovedBudget {
    const budget = this.budgets.get(budgetId);
    if (!budget) {
      throw new Error(`Budget "${budgetId}" not found.`);
    }
    if (!budget.consentGiven) {
      throw new ConsentRequiredError(
        "Explicit human consent required before generative API invocation.",
      );
    }
    if (!budget.approverId || budget.approverId.trim() === "") {
      throw new ConsentRequiredError(
        "Budget must be explicitly approved by an authorized user ID.",
      );
    }
    if (
      budget.expiresAt &&
      (!Number.isFinite(Date.parse(budget.expiresAt)) ||
        Date.now() >= Date.parse(budget.expiresAt))
    ) {
      throw new ConsentRequiredError(
        `Budget approval for "${budgetId}" expired on ${budget.expiresAt}.`,
      );
    }

    return { ...budget };
  }

  /**
   * Reserves an estimated cost amount before queueing a generative job.
   * Throws if consent is missing or if the ceiling would be breached.
   */
  reserve(
    budgetId: string,
    jobId: string,
    amountCents: number,
  ): BudgetReservation {
    if (!Number.isFinite(amountCents) || amountCents <= 0) {
      throw new Error(
        "Reservation amount must be a positive finite number of cents.",
      );
    }

    if (!jobId.trim()) throw new Error("Reservation requires a job ID.");
    if (
      Array.from(this.reservations.values()).some(
        (reservation) => reservation.jobId === jobId,
      )
    ) {
      throw new Error(`Job "${jobId}" already has a reservation.`);
    }
    const budget = this.requireConsent(budgetId);

    const reserved = this.getTotalReserved(budgetId);
    const projectedTotal =
      Math.round((budget.spentSoFarCents + reserved + amountCents) * 100) / 100;

    if (projectedTotal > budget.approvedCeilingCents) {
      const remaining =
        Math.round(
          (budget.approvedCeilingCents - budget.spentSoFarCents - reserved) *
            100,
        ) / 100;
      throw new BudgetExceededError(
        `Estimated generation cost (${amountCents}¢) exceeds remaining approved budget ceiling (${remaining}¢ available of ${budget.approvedCeilingCents}¢ ceiling).`,
      );
    }

    const reservationId = id();
    const reservation: BudgetReservation = {
      reservationId,
      budgetId,
      jobId,
      amountCents,
      timestamp: new Date().toISOString(),
    };

    this.reservations.set(reservationId, reservation);
    return { ...reservation };
  }

  /**
   * Commits actual spend when a generation job succeeds.
   * Releases the reservation and updates spentSoFarCents.
   */
  commit(reservationId: string, actualCostCents: number): void {
    if (!Number.isFinite(actualCostCents) || actualCostCents < 0) {
      throw new Error("Actual cost must be a non-negative finite number.");
    }

    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      throw new Error(`Budget reservation "${reservationId}" not found.`);
    }

    const budget = this.budgets.get(reservation.budgetId);
    if (budget) {
      budget.spentSoFarCents =
        Math.round((budget.spentSoFarCents + actualCostCents) * 100) / 100;
    }

    this.reservations.delete(reservationId);
  }

  /**
   * Releases a reservation when a job fails or is cancelled.
   * If chargedCostCents > 0 (e.g. cancellation fee from provider schedule),
   * records the charged amount against spentSoFarCents.
   */
  release(reservationId: string, chargedCostCents = 0): void {
    if (!Number.isFinite(chargedCostCents) || chargedCostCents < 0) {
      throw new Error("Charged cost must be a non-negative finite number.");
    }

    const reservation = this.reservations.get(reservationId);
    if (!reservation) {
      return; // Already released or non-existent
    }

    const budget = this.budgets.get(reservation.budgetId);
    if (budget && chargedCostCents > 0) {
      budget.spentSoFarCents =
        Math.round((budget.spentSoFarCents + chargedCostCents) * 100) / 100;
    }

    this.reservations.delete(reservationId);
  }

  listReservations(budgetId?: string): BudgetReservation[] {
    const list = Array.from(this.reservations.values(), (reservation) => ({
      ...reservation,
    }));
    return budgetId ? list.filter((r) => r.budgetId === budgetId) : list;
  }
}
