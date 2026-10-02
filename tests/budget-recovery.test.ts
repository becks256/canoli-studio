import { describe, expect, it } from "vitest";
import { BudgetLedger } from "../src/ai/jobs/ledger";

function fixture() {
  const ledger = new BudgetLedger();
  ledger.createBudget({
    budgetId: "approved",
    approverId: "owner",
    approvedCeilingCents: 100,
    spentSoFarCents: 30,
  });
  const reservation = ledger.reserve("approved", "pending-job", 40);
  return { ledger, reservation };
}

describe("generation budget recovery foundation", () => {
  it("round-trips outstanding charges, consent and reconciliation without shared mutable data", () => {
    const { ledger, reservation } = fixture();
    ledger.setConsent("approved", false);
    const saved = ledger.snapshot();
    const restored = new BudgetLedger();
    restored.restore(JSON.parse(JSON.stringify(saved)));
    expect(restored.getAvailableCeiling("approved")).toBe(30);
    expect(() => restored.reserve("approved", "new-job", 1)).toThrow(/consent/);
    restored.commit(reservation.reservationId, 45);
    expect(restored.getBudget("approved")?.spentSoFarCents).toBe(75);
    expect(ledger.getBudget("approved")?.spentSoFarCents).toBe(30);
    expect(saved.reservations).toHaveLength(1);
    saved.budgets[0].budget.spentSoFarCents = 0;
    expect(restored.getBudget("approved")?.spentSoFarCents).toBe(75);
    expect(ledger.getBudget("approved")?.spentSoFarCents).toBe(30);
  });

  it.each([
    "version",
    "negative",
    "nonfinite",
    "missing-budget",
    "duplicate-budget",
    "duplicate-reservation",
    "duplicate-job",
    "timestamp",
  ])("rejects %s corruption atomically", (kind) => {
    const { ledger } = fixture();
    const before = ledger.snapshot();
    const corrupt = structuredClone(before);
    switch (kind) {
      case "version":
        (corrupt as { schemaVersion: number }).schemaVersion = 2;
        break;
      case "negative":
        corrupt.budgets[0].budget.spentSoFarCents = -1;
        break;
      case "nonfinite":
        corrupt.reservations[0].amountCents = Infinity;
        break;
      case "missing-budget":
        corrupt.reservations[0].budgetId = "missing";
        break;
      case "duplicate-budget":
        corrupt.budgets.push(structuredClone(corrupt.budgets[0]));
        break;
      case "duplicate-reservation":
        corrupt.reservations.push(structuredClone(corrupt.reservations[0]));
        break;
      case "duplicate-job":
        corrupt.reservations.push({
          ...corrupt.reservations[0],
          reservationId: "another",
        });
        break;
      case "timestamp":
        corrupt.reservations[0].timestamp = "invalid";
        break;
    }
    expect(() => ledger.restore(corrupt)).toThrow();
    expect(ledger.snapshot()).toEqual(before);
  });

  it("retains actual over-budget charges and prevents balance replacement or duplicate reservations", () => {
    const { ledger, reservation } = fixture();
    expect(() =>
      ledger.createBudget({
        budgetId: "approved",
        approverId: "owner",
        approvedCeilingCents: 100,
      }),
    ).toThrow(/already exists/);
    expect(() => ledger.reserve("approved", "pending-job", 1)).toThrow(
      /already has/,
    );
    expect(() =>
      ledger.createBudget({
        budgetId: "negative",
        approverId: "owner",
        approvedCeilingCents: 100,
        spentSoFarCents: -1,
      }),
    ).toThrow();
    ledger.commit(reservation.reservationId, 120);
    const restored = new BudgetLedger();
    restored.restore(ledger.snapshot());
    expect(restored.getBudget("approved")?.spentSoFarCents).toBe(150);
    expect(restored.getAvailableCeiling("approved")).toBe(0);
    expect(() => restored.reserve("approved", "next", 1)).toThrow(/exceeds/);
  });
});

describe("budget accounting ownership", () => {
  it("keeps consent and approved limits private across every budget return path", () => {
    const ledger = new BudgetLedger();
    const created = ledger.createBudget({
      budgetId: "owner",
      approverId: "owner",
      approvedCeilingCents: 100,
    });
    const snapshots = [
      created,
      ledger.getBudget("owner")!,
      ledger.requireConsent("owner"),
      ledger.listBudgets()[0].budget,
    ];
    ledger.setConsent("owner", false);
    for (const budget of snapshots) {
      budget.consentGiven = true;
      budget.approvedCeilingCents = 10000;
      budget.spentSoFarCents = -100;
    }
    expect(() => ledger.reserve("owner", "unapproved", 1)).toThrow(/consent/);
    ledger.setConsent("owner", true);
    expect(() => ledger.reserve("owner", "overspend", 101)).toThrow(/exceeds/);
    expect(ledger.getBudget("owner")?.spentSoFarCents).toBe(0);
  });

  it("prevents reservation mutation from bypassing ceilings or redirecting settlement", () => {
    const ledger = new BudgetLedger();
    ledger.createBudget({
      budgetId: "owner",
      approverId: "owner",
      approvedCeilingCents: 100,
    });
    ledger.createBudget({
      budgetId: "other",
      approverId: "other",
      approvedCeilingCents: 100,
    });
    const reservation = ledger.reserve("owner", "first", 80);
    const reservationId = reservation.reservationId;
    for (const value of [
      reservation,
      ledger.listReservations()[0],
      ledger.listReservations("owner")[0],
    ]) {
      value.amountCents = 1;
      value.budgetId = "other";
      value.jobId = "changed";
    }
    expect(ledger.getTotalReserved("owner")).toBe(80);
    expect(() => ledger.reserve("owner", "second", 80)).toThrow(/exceeds/);
    expect(() => ledger.reserve("owner", "first", 1)).toThrow(/already has/);
    ledger.commit(reservationId, 85);
    expect(ledger.getBudget("owner")?.spentSoFarCents).toBe(85);
    expect(ledger.getBudget("other")?.spentSoFarCents).toBe(0);
    expect(ledger.listReservations()).toHaveLength(0);
  });
});
