import { expensesTable } from "@workspace/db";

/** Who put the money up. Matches the `paid_by` enum in the database. */
export type PaidBy = "me" | "someone_else";
/** Whether a tracked amount has changed hands. Matches `settlement_status`. */
export type SettlementStatus = "pending" | "settled";

export type MoneyTrackingInput = {
  paidBy?: string | null;
  counterparty?: string | null;
  trackedAmount?: string | null;
  settlementStatus?: string | null;
};

export type NormalizedMoneyTracking = {
  paidBy: PaidBy;
  counterparty: string | null;
  trackedAmount: string | null;
  settlementStatus: SettlementStatus | null;
};

export type MoneyTrackingProblem = {
  field: "paidBy" | "counterparty" | "trackedAmount" | "settlementStatus";
  message: string;
};

const MAX_COUNTERPARTY = 200;

const PAID_BY = ["me", "someone_else"] as const satisfies readonly PaidBy[];
const SETTLEMENT_STATUS = ["pending", "settled"] as const satisfies readonly SettlementStatus[];

function isPaidBy(value: string): value is PaidBy {
  return (PAID_BY as readonly string[]).includes(value);
}

function isSettlementStatus(value: string): value is SettlementStatus {
  return (SETTLEMENT_STATUS as readonly string[]).includes(value);
}

/**
 * Reduces the three money-tracking fields to a single consistent shape.
 *
 * `counterparty` is the opt-in: with none set the row is an ordinary expense
 * and the tracking columns are cleared. That is the one rule worth being strict
 * about, because it means "no counterparty" and "a settlement with nobody" can
 * never disagree, whichever client wrote them.
 */
export function normalizeMoneyTracking(
  input: MoneyTrackingInput,
  expenseAmount: string,
): { ok: true; value: NormalizedMoneyTracking } | { ok: false; problem: MoneyTrackingProblem } {
  if (input.paidBy != null && !isPaidBy(input.paidBy)) {
    return {
      ok: false,
      problem: { field: "paidBy", message: "Paid by must be either me or someone_else." },
    };
  }
  if (input.settlementStatus != null && !isSettlementStatus(input.settlementStatus)) {
    return {
      ok: false,
      problem: {
        field: "settlementStatus",
        message: "Settlement status must be either pending or settled.",
      },
    };
  }

  const counterparty = normalizeCounterparty(input.counterparty);
  if (counterparty && counterparty.length > MAX_COUNTERPARTY) {
    return {
      ok: false,
      problem: {
        field: "counterparty",
        message: `Counterparty must be ${MAX_COUNTERPARTY} characters or fewer.`,
      },
    };
  }

  if (!counterparty) {
    // Not reimbursable, or nothing named. Either way nothing is tracked, so the
    // amount has to be cleared too or the two would disagree.
    return {
      ok: true,
      value: {
        paidBy: input.paidBy ?? "me",
        counterparty: null,
        trackedAmount: null,
        settlementStatus: null,
      },
    };
  }

  const trackedAmount = input.trackedAmount?.trim() || expenseAmount;
  if (!/^[0-9]{1,12}(\.[0-9]{1,2})?$/.test(trackedAmount)) {
    return {
      ok: false,
      problem: { field: "trackedAmount", message: "Enter a valid tracked amount." },
    };
  }
  if (Number(trackedAmount) <= 0) {
    return {
      ok: false,
      problem: {
        field: "trackedAmount",
        message: "The tracked amount must be greater than zero.",
      },
    };
  }
  if (Number(trackedAmount) > Number(expenseAmount)) {
    // Someone can owe less than the expense, but never more than it.
    return {
      ok: false,
      problem: {
        field: "trackedAmount",
        message: "The tracked amount cannot be more than the expense amount.",
      },
    };
  }

  return {
    ok: true,
    value: {
      paidBy: input.paidBy ?? "me",
      counterparty,
      trackedAmount,
      // Naming somebody makes the amount outstanding until told otherwise.
      settlementStatus: input.settlementStatus ?? "pending",
    },
  };
}

/**
 * Whether this expense is tracking money owed either way.
 *
 * Deliberately derived rather than stored: paidBy and the presence of a
 * counterparty already answer it, and a stored flag could disagree with them.
 */
export function isTracked(value: {
  counterparty: string | null;
  trackedAmount: string | null;
}): boolean {
  return value.counterparty !== null && value.trackedAmount !== null;
}

function normalizeCounterparty(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length ? trimmed : null;
}

/**
 * "Received" and "paid back" are the same settled fact seen from either side,
 * so the stored value is shared and only the wording depends on the direction.
 */
export function settlementLabel(
  status: SettlementStatus | null,
  paidBy: PaidBy,
): string {
  if (status === "settled") return paidBy === "someone_else" ? "Paid back" : "Received";
  return "Pending";
}

/** The heading that matches a direction, used for the report and the form. */
export function directionLabel(direction: "owed_by_me" | "owed_to_me"): string {
  return direction === "owed_to_me" ? "Money to pay back" : "Money to get back";
}

/** The expense column a direction reads from. */
export function directionPaidBy(direction: "owed_by_me" | "owed_to_me"): PaidBy {
  return direction === "owed_to_me" ? "someone_else" : "me";
}

/** Columns to project onto an expense row in the money reports. */
export const moneyColumns = {
  paidBy: expensesTable.paidBy,
  counterparty: expensesTable.counterparty,
  trackedAmount: expensesTable.trackedAmount,
  settlementStatus: expensesTable.settlementStatus,
};