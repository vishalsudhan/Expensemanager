import { Router, type IRouter } from "express";
import { and, asc, eq, ilike } from "drizzle-orm";
import {
  ArchiveLabelParams,
  ArchiveLabelResponse,
  CreateLabelBody,
  CreateLabelResponse,
  ListLabelsQueryParams,
  ListLabelsResponse,
  UpdateLabelBody,
  UpdateLabelParams,
  UpdateLabelResponse,
} from "@workspace/api-zod";
import { db, labelsTable } from "@workspace/db";

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

router.get("/labels", async (req, res): Promise<void> => {
  const parsed = ListLabelsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid label search or status filter." });
    return;
  }

  const status = parsed.data.status ?? "active";
  const conditions = [];
  if (status !== "all") {
    conditions.push(eq(labelsTable.status, status));
  }

  const search = parsed.data.search?.trim();
  if (search) {
    conditions.push(ilike(labelsTable.name, `%${escapeLikePattern(search)}%`));
  }

  const labels = await db
    .select()
    .from(labelsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(asc(labelsTable.name));

  res.json(ListLabelsResponse.parse(labels));
});

router.post("/labels", async (req, res): Promise<void> => {
  const parsed = CreateLabelBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid label name and color." });
    return;
  }

  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Label name cannot be blank." });
    return;
  }

  try {
    const [label] = await db
      .insert(labelsTable)
      .values({ ...parsed.data, name })
      .returning();

    res.status(201).json(CreateLabelResponse.parse(label));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A label with this name already exists." });
      return;
    }
    throw error;
  }
});

router.patch("/labels/:labelId", async (req, res): Promise<void> => {
  const params = UpdateLabelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid label ID." });
    return;
  }

  const parsed = UpdateLabelBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Provide at least one valid label field." });
    return;
  }

  const changes = { ...parsed.data };
  if (changes.name !== undefined) {
    changes.name = changes.name.trim();
    if (!changes.name) {
      res.status(400).json({ error: "Label name cannot be blank." });
      return;
    }
  }

  try {
    const [label] = await db
      .update(labelsTable)
      .set(changes)
      .where(eq(labelsTable.id, params.data.labelId))
      .returning();

    if (!label) {
      res.status(404).json({ error: "Label not found." });
      return;
    }

    res.json(UpdateLabelResponse.parse(label));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A label with this name already exists." });
      return;
    }
    throw error;
  }
});

router.patch("/labels/:labelId/archive", async (req, res): Promise<void> => {
  const params = ArchiveLabelParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid label ID." });
    return;
  }

  const [label] = await db
    .update(labelsTable)
    .set({ status: "archived" })
    .where(eq(labelsTable.id, params.data.labelId))
    .returning();

  if (!label) {
    res.status(404).json({ error: "Label not found." });
    return;
  }

  res.json(ArchiveLabelResponse.parse(label));
});

export default router;