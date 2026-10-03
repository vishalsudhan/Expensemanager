import { Router, type IRouter } from "express";
import { and, asc, eq, ilike } from "drizzle-orm";
import {
  CreateLocationBody,
  CreateLocationResponse,
  ListLocationsQueryParams,
  ListLocationsResponse,
  UpdateLocationBody,
  UpdateLocationParams,
  UpdateLocationResponse,
} from "@workspace/api-zod";
import { locationsTable, db } from "@workspace/db";
import { slugify } from "../lib/slug";

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

  const locations = await db
    .select()
    .from(locationsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(locationsTable.name));

  res.json(ListLocationsResponse.parse(locations));
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

export default router;