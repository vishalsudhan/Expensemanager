import { Router, type IRouter } from "express";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  CreateCounterpartyBody,
  CreateCounterpartyResponse,
  DeleteCounterpartyParams,
  DeleteCounterpartyResponse,
  ListCounterpartiesQueryParams,
  ListCounterpartiesResponse,
  UpdateCounterpartyBody,
  UpdateCounterpartyParams,
  UpdateCounterpartyResponse,
} from "@workspace/api-zod";
import { counterpartiesTable, db, expensesTable } from "@workspace/db";
import { deleteOutcome } from "../lib/record-delete";

const router: IRouter = Router();

const DUPLICATE_NAME = "A person or company with this name already exists.";

function isUniqueConstraintError(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 4) return false;
  const wrappedError = error as { code?: unknown; cause?: unknown };
  if (wrappedError.code === "23505") return true;
  return isUniqueConstraintError(wrappedError.cause, depth + 1);
}

async function nameTaken(name: string, exceptId?: string): Promise<boolean> {
  const conditions = [sql`lower(${counterpartiesTable.name}) = lower(${name})`];
  if (exceptId) conditions.push(ne(counterpartiesTable.id, exceptId));
  const [clash] = await db
    .select({ id: counterpartiesTable.id })
    .from(counterpartiesTable)
    .where(and(...conditions))
    .limit(1);
  return Boolean(clash);
}

router.get("/counterparties", async (req, res): Promise<void> => {
  const parsed = ListCounterpartiesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid status filter." });
    return;
  }
  const status = parsed.data.status ?? "active";

  const [rows, usageRows] = await Promise.all([
    db
      .select()
      .from(counterpartiesTable)
      .where(status === "all" ? undefined : eq(counterpartiesTable.status, status))
      .orderBy(asc(counterpartiesTable.name)),
    db
      .select({ id: expensesTable.counterpartyId, usageCount: sql<number>`count(*)::int` })
      .from(expensesTable)
      .where(sql`${expensesTable.counterpartyId} is not null`)
      .groupBy(expensesTable.counterpartyId),
  ]);
  const usage = new Map(usageRows.map((row) => [row.id, Number(row.usageCount)]));

  res.json(
    ListCounterpartiesResponse.parse(
      rows.map((row) => ({ ...row, usageCount: usage.get(row.id) ?? 0 })),
    ),
  );
});

router.post("/counterparties", async (req, res): Promise<void> => {
  const parsed = CreateCounterpartyBody.safeParse(req.body);
  const name = parsed.success ? parsed.data.name.trim() : "";
  if (!name) {
    res.status(400).json({ error: "Enter a name for the person or company." });
    return;
  }
  if (await nameTaken(name)) {
    res.status(409).json({ error: DUPLICATE_NAME });
    return;
  }

  try {
    const [created] = await db.insert(counterpartiesTable).values({ name }).returning();
    res.status(201).json(CreateCounterpartyResponse.parse({ ...created, usageCount: 0 }));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: DUPLICATE_NAME });
      return;
    }
    throw error;
  }
});

router.patch("/counterparties/:counterpartyId", async (req, res): Promise<void> => {
  const params = UpdateCounterpartyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID." });
    return;
  }
  const parsed = UpdateCounterpartyBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data).length === 0) {
    res.status(400).json({ error: "Provide a new name or status." });
    return;
  }

  const changes = { ...parsed.data };
  if (changes.name !== undefined) {
    changes.name = changes.name.trim();
    if (!changes.name) {
      res.status(400).json({ error: "Enter a name for the person or company." });
      return;
    }
    if (await nameTaken(changes.name, params.data.counterpartyId)) {
      res.status(409).json({ error: DUPLICATE_NAME });
      return;
    }
  }

  try {
    const [updated] = await db
      .update(counterpartiesTable)
      .set(changes)
      .where(eq(counterpartiesTable.id, params.data.counterpartyId))
      .returning();
    if (!updated) {
      res.status(404).json({ error: "Person or company not found." });
      return;
    }
    res.json(UpdateCounterpartyResponse.parse(updated));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: DUPLICATE_NAME });
      return;
    }
    throw error;
  }
});

/** Deletes when unused; archives when expenses still point at it. */
router.delete("/counterparties/:counterpartyId", async (req, res): Promise<void> => {
  const params = DeleteCounterpartyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid ID." });
    return;
  }
  const id = params.data.counterpartyId;

  const [{ usageCount } = { usageCount: 0 }] = await db
    .select({ usageCount: sql<number>`count(*)::int` })
    .from(expensesTable)
    .where(eq(expensesTable.counterpartyId, id));

  if (usageCount > 0) {
    const [archived] = await db
      .update(counterpartiesTable)
      .set({ status: "archived" })
      .where(eq(counterpartiesTable.id, id))
      .returning();
    if (!archived) {
      res.status(404).json({ error: "Person or company not found." });
      return;
    }
    res.json(DeleteCounterpartyResponse.parse(deleteOutcome(archived.id, archived.name, usageCount)));
    return;
  }

  // Projects only use it as a suggestion; the FK clears that on delete.
  const [deleted] = await db
    .delete(counterpartiesTable)
    .where(eq(counterpartiesTable.id, id))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Person or company not found." });
    return;
  }
  res.json(DeleteCounterpartyResponse.parse(deleteOutcome(deleted.id, deleted.name, 0)));
});

export default router;
