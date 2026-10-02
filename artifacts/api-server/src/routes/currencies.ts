import { Router, type IRouter } from "express";
import { and, desc, eq } from "drizzle-orm";
import {
  CreateCurrencyBody,
  CreateCurrencyResponse,
  ListCurrenciesQueryParams,
  ListCurrenciesResponse,
  UpdateCurrencyBody,
  UpdateCurrencyParams,
  UpdateCurrencyResponse,
} from "@workspace/api-zod";
import { currenciesTable, db } from "@workspace/db";

const router: IRouter = Router();

function isUniqueConstraintError(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 4) return false;

  const wrappedError = error as { code?: unknown; cause?: unknown };
  if (wrappedError.code === "23505") return true;
  return isUniqueConstraintError(wrappedError.cause, depth + 1);
}

router.get("/currencies", async (req, res): Promise<void> => {
  const parsed = ListCurrenciesQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid currency filter." });
    return;
  }

  const { isActive } = parsed.data;
  const conditions = isActive !== undefined ? [eq(currenciesTable.isActive, isActive)] : [];

  const currencies = await db
    .select()
    .from(currenciesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(currenciesTable.isActive), currenciesTable.code);

  res.json(ListCurrenciesResponse.parse(currencies));
});

router.post("/currencies", async (req, res): Promise<void> => {
  const parsed = CreateCurrencyBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid currency code, name, and symbol." });
    return;
  }

  const { code, ...rest } = parsed.data;
  const upperCode = code.toUpperCase();

  try {
    const [currency] = await db
      .insert(currenciesTable)
      .values({ ...rest, code: upperCode })
      .returning();

    res.status(201).json(CreateCurrencyResponse.parse(currency));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A currency with this code already exists." });
      return;
    }
    throw error;
  }
});

router.patch("/currencies/:currencyId", async (req, res): Promise<void> => {
  const params = UpdateCurrencyParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid currency ID." });
    return;
  }

  const parsed = UpdateCurrencyBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Provide at least one valid currency field." });
    return;
  }

  try {
    const [currency] = await db
      .update(currenciesTable)
      .set(parsed.data)
      .where(eq(currenciesTable.id, params.data.currencyId))
      .returning();

    if (!currency) {
      res.status(404).json({ error: "Currency not found." });
      return;
    }

    res.json(UpdateCurrencyResponse.parse(currency));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A currency with this code already exists." });
      return;
    }
    throw error;
  }
});

export default router;