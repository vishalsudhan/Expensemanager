import { Router, type IRouter } from "express";
import { and, asc, eq, ne, sql } from "drizzle-orm";
import {
  CreateTransactionTypeBody,
  ListTransactionTypesQueryParams,
  ListTransactionTypesResponse,
  UpdateTransactionTypeBody,
  UpdateTransactionTypeParams,
  UpdateTransactionTypeResponse,
} from "@workspace/api-zod";
import { db, expensesTable, transactionTypesTable } from "@workspace/db";
import { slugify } from "../lib/slug";

const router: IRouter = Router();

function isUniqueConstraintError(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 4) return false;
  const wrapped = error as { code?: unknown; cause?: unknown };
  if (wrapped.code === "23505") return true;
  return isUniqueConstraintError(wrapped.cause, depth + 1);
}

/** Appends -2, -3, ... until the slug is free. */
async function uniqueSlug(base: string, excludeId?: string): Promise<string> {
  const taken = new Set(
    (await db
      .select({ slug: transactionTypesTable.slug })
      .from(transactionTypesTable)
      .where(excludeId ? ne(transactionTypesTable.id, excludeId) : undefined)).map((row) => row.slug),
  );
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

/**
 * Expense counts per type, fetched as its own grouped query.
 *
 * A correlated subquery in the select list silently returns zero here, so this
 * follows the pattern the category, project and label masters already use.
 */
async function countsByType() {
  const rows = await db
    .select({ typeId: expensesTable.transactionTypeId, count: sql<number>`count(*)::int` })
    .from(expensesTable)
    .groupBy(expensesTable.transactionTypeId);
  return new Map(rows.map((row) => [row.typeId, Number(row.count)]));
}

router.get("/transaction-types", async (req, res): Promise<void> => {
  const parsed = ListTransactionTypesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid transaction type filter." });
    return;
  }

  const status = parsed.data.status ?? "active";
  const rows = await db
    .select({
      id: transactionTypesTable.id,
      name: transactionTypesTable.name,
      slug: transactionTypesTable.slug,
      kind: transactionTypesTable.kind,
      status: transactionTypesTable.status,
      createdAt: transactionTypesTable.createdAt,
      updatedAt: transactionTypesTable.updatedAt,
    })
    .from(transactionTypesTable)
    .where(status === "all" ? undefined : eq(transactionTypesTable.status, status))
    .orderBy(asc(transactionTypesTable.kind), asc(transactionTypesTable.name));

  const counts = await countsByType();
  res.json(
    ListTransactionTypesResponse.parse(
      rows.map((row) => ({ ...row, expenseCount: counts.get(row.id) ?? 0 })),
    ),
  );
});

router.post("/transaction-types", async (req, res): Promise<void> => {
  const parsed = CreateTransactionTypeBody.safeParse(req.body);
  if (!parsed.success || !parsed.data.kind) {
    res.status(400).json({ error: "Enter a name and choose whether it is an expense or a payment." });
    return;
  }

  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Type name cannot be blank." });
    return;
  }

  const slug = await uniqueSlug(slugify(name));
  try {
    const [created] = await db
      .insert(transactionTypesTable)
      .values({ name, slug, kind: parsed.data.kind })
      .returning();

    res.status(201).json(
      UpdateTransactionTypeResponse.parse({ ...created, expenseCount: 0 }),
    );
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A transaction type with this name already exists." });
      return;
    }
    throw error;
  }
});

router.patch("/transaction-types/:transactionTypeId", async (req, res): Promise<void> => {
  const params = UpdateTransactionTypeParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid transaction type ID." });
    return;
  }

  const parsed = UpdateTransactionTypeBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Provide at least one valid field." });
    return;
  }

  const typeId = params.data.transactionTypeId;
  const changes: Partial<typeof transactionTypesTable.$inferInsert> = {};

  if (parsed.data.name !== undefined) {
    const name = parsed.data.name.trim();
    if (!name) {
      res.status(400).json({ error: "Type name cannot be blank." });
      return;
    }
    const [clash] = await db
      .select({ id: transactionTypesTable.id })
      .from(transactionTypesTable)
      .where(
        and(
          sql`lower(${transactionTypesTable.name}) = lower(${name})`,
          ne(transactionTypesTable.id, typeId),
        ),
      )
      .limit(1);
    if (clash) {
      res.status(409).json({ error: "A transaction type with this name already exists." });
      return;
    }
    changes.name = name;
    // The slug is kept in step, unless it would collide with another type's.
    const wanted = slugify(name);
    const [taken] = await db
      .select({ slug: transactionTypesTable.slug })
      .from(transactionTypesTable)
      .where(
        and(eq(transactionTypesTable.slug, wanted), ne(transactionTypesTable.id, typeId)),
      )
      .limit(1);
    if (!taken) changes.slug = wanted;
  }
  if (parsed.data.status !== undefined) changes.status = parsed.data.status;

  const updated = (await db.transaction(async (tx) => {
    await tx.update(transactionTypesTable).set(changes).where(eq(transactionTypesTable.id, typeId));
    const [row] = await tx
      .select({
        id: transactionTypesTable.id,
        name: transactionTypesTable.name,
        slug: transactionTypesTable.slug,
        kind: transactionTypesTable.kind,
        status: transactionTypesTable.status,
        createdAt: transactionTypesTable.createdAt,
        updatedAt: transactionTypesTable.updatedAt,
      })
      .from(transactionTypesTable)
      .where(eq(transactionTypesTable.id, typeId))
      .limit(1);
    return row;
  }));

  if (!updated) {
    res.status(404).json({ error: "Transaction type not found." });
    return;
  }

  const counts = await countsByType();
  res.json(
    UpdateTransactionTypeResponse.parse({
      ...updated,
      expenseCount: counts.get(updated.id) ?? 0,
    }),
  );
});

export default router;