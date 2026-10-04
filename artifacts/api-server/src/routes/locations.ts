import { Router, type IRouter } from "express";
import { and, asc, eq, ilike, ne, sql } from "drizzle-orm";
import {
  CreateLocationBody,
  CreateLocationResponse,
  DeleteLocationParams,
  DeleteLocationResponse,
  ListLocationsQueryParams,
  ListLocationsResponse,
  UpdateLocationBody,
  UpdateLocationParams,
  UpdateLocationResponse,
} from "@workspace/api-zod";
import { locationsTable, db, expensesTable } from "@workspace/db";
import { slugify } from "../lib/slug";
import { deleteOutcome } from "../lib/record-delete";

const router: IRouter = Router();

function isUniqueConstraintError(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 4) return false;

  const wrappedError = error as { code?: unknown; cause?: unknown };
  if (wrappedError.code === "23505") return true;
  return isUniqueConstraintError(wrappedError.cause, depth + 1);
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

/** Appends -2, -3, ... until the slug is free. */
async function uniqueSlug(base: string): Promise<string> {
  const taken = new Set(
    (await db.select({ slug: locationsTable.slug }).from(locationsTable)).map(
      (row) => row.slug,
    ),
  );
  if (!taken.has(base)) return base;
  let suffix = 2;
  while (taken.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

router.get("/locations", async (req, res): Promise<void> => {
  const parsed = ListLocationsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid location search or status filter." });
    return;
  }

  const { search } = parsed.data;
  const status = parsed.data.status ?? "active";
  const conditions = [];
  if (status !== "all") {
    conditions.push(eq(locationsTable.status, status));
  }
  const trimmed = search?.trim();
  if (trimmed) {
    conditions.push(ilike(locationsTable.name, `%${escapeLikePattern(trimmed)}%`));
  }

  const usageRows = await db
    .select({ locationId: expensesTable.locationId, usageCount: sql<number>`count(*)::int` })
    .from(expensesTable)
    .groupBy(expensesTable.locationId);
  const usageByLocation = new Map(usageRows.map((row) => [row.locationId, Number(row.usageCount)]));

  const locations = await db
    .select()
    .from(locationsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(locationsTable.name));

  res.json(
    ListLocationsResponse.parse(
      locations.map((location) => ({
        ...location,
        usageCount: usageByLocation.get(location.id) ?? 0,
      })),
    ),
  );
});

router.post("/locations", async (req, res): Promise<void> => {
  const parsed = CreateLocationBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid location name." });
    return;
  }

  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Location name cannot be blank." });
    return;
  }

  const slug = parsed.data.slug?.trim() || slugify(name);

  try {
    const [location] = await db
      .insert(locationsTable)
      .values({
        name,
        slug: await uniqueSlug(slug),
        countryCode: parsed.data.countryCode ?? null,
      })
      .returning();

    res.status(201).json(CreateLocationResponse.parse(location));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A location with this name already exists." });
      return;
    }
    throw error;
  }
});

router.patch("/locations/:locationId", async (req, res): Promise<void> => {
  const params = UpdateLocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid location ID." });
    return;
  }

  const parsed = UpdateLocationBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Provide at least one valid location field." });
    return;
  }

  const changes = { ...parsed.data };
  if (changes.name !== undefined) {
    changes.name = changes.name.trim();
    if (!changes.name) {
      res.status(400).json({ error: "Location name cannot be blank." });
      return;
    }
    // Renaming without an explicit slug keeps the slug in sync.
    if (changes.slug === undefined) changes.slug = slugify(changes.name);
  }
  if (changes.slug !== undefined) {
    changes.slug = slugify(changes.slug.trim());
  }

  if (changes.name !== undefined) {
    const [clash] = await db
      .select({ id: locationsTable.id })
      .from(locationsTable)
      .where(
        and(
          sql`lower(${locationsTable.name}) = lower(${changes.name})`,
          ne(locationsTable.id, params.data.locationId),
        ),
      )
      .limit(1);
    if (clash) {
      res.status(409).json({ error: "A location with this name already exists." });
      return;
    }
  }

  try {
    const [location] = await db
      .update(locationsTable)
      .set(changes)
      .where(eq(locationsTable.id, params.data.locationId))
      .returning();

    if (!location) {
      res.status(404).json({ error: "Location not found." });
      return;
    }

    res.json(UpdateLocationResponse.parse(location));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A location with this name already exists." });
      return;
    }
    throw error;
  }
});

router.delete("/locations/:locationId", async (req, res): Promise<void> => {
  const params = DeleteLocationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid location ID." });
    return;
  }

  const locationId = params.data.locationId;
  const [{ usageCount } = { usageCount: 0 }] = await db
    .select({ usageCount: sql<number>`count(*)::int` })
    .from(expensesTable)
    .where(eq(expensesTable.locationId, locationId));

  if (usageCount > 0) {
    const [archived] = await db
      .update(locationsTable)
      .set({ status: "archived" })
      .where(eq(locationsTable.id, locationId))
      .returning();

    if (!archived) {
      res.status(404).json({ error: "Location not found." });
      return;
    }

    res.json(
      DeleteLocationResponse.parse(deleteOutcome(archived.id, archived.name, usageCount)),
    );
    return;
  }

  const [deleted] = await db.delete(locationsTable).where(eq(locationsTable.id, locationId)).returning();

  if (!deleted) {
    res.status(404).json({ error: "Location not found." });
    return;
  }

  res.json(DeleteLocationResponse.parse(deleteOutcome(deleted.id, deleted.name, 0)));
});

export default router;