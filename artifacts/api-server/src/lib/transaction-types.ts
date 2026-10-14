import { sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { expensesTable, transactionTypesTable } from "@workspace/db";

/**
 * The column to test.
 *
 * The default is the table's own column, but a query that joins expenses under
 * another name has to pass that name's column instead: a fully qualified
 * "expenses"."transaction_type_id" is not a valid reference once the table has
 * been aliased, and Postgres rejects the whole query.
 */
type TypeColumn = SQL | PgColumn;

/**
 * Matches every expense whose transaction type belongs to the given kind.
 *
 * A subquery rather than a fixed list of ids, so a type added later is counted
 * without any code change. Status is deliberately not considered: archiving a
 * type retires it from the pickers but must not rewrite history, so its expenses
 * keep counting towards the same totals they always did.
 */
export const ofKind = (kind: "expense" | "payment", column: TypeColumn = expensesTable.transactionTypeId) =>
  sql`${column} in (
    select ${transactionTypesTable.id}
      from ${transactionTypesTable}
     where ${transactionTypesTable.kind} = ${kind}
  )`;

/** Shorthand for the common case: real spending only, bill payments excluded. */
export const isSpending = (column?: TypeColumn) => ofKind("expense", column);

/**
 * Resolves a slug to the columns a write must set.
 *
 * Both the enum and the foreign key are returned so they can be written
 * together. They only disagree if something updates one without the other,
 * which is why they are resolved in a single place.
 */
export async function transactionTypeRef(slug: string) {
  const { eq } = await import("drizzle-orm");
  const { db } = await import("@workspace/db");
  const [row] = await db
    .select({ id: transactionTypesTable.id, slug: transactionTypesTable.slug })
    .from(transactionTypesTable)
    .where(eq(transactionTypesTable.slug, slug))
    .limit(1);
  if (!row) return null;
  return {
    id: row.id,
    slug: row.slug,
    // The legacy enum holds exactly two values, so a type added after this
    // release has no honest value to write there. It is written only for the
    // two original slugs, which keeps a rollback to the previous release
    // correct for existing data. New code never reads this column.
    legacy: row.slug === "expense" || row.slug === "payment" ? (row.slug as "expense" | "payment") : null,
  };
}
