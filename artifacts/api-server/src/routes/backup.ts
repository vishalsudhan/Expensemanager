import { Router, type IRouter, type Response } from "express";
import { asc, eq, inArray } from "drizzle-orm";
import {
  categoriesTable,
  currenciesTable,
  db,
  expenseLabelsTable,
  expensesTable,
  labelsTable,
  projectsTable,
} from "@workspace/db";
import { ImportBackupBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

type ParsedBackup = ReturnType<typeof ImportBackupBody.parse>;
type BackupCount = { created: number; updated: number; skipped: number };
type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type WireProject = {
  id: string;
  name: string;
  description: string | null;
  color: string;
  icon: string | null;
  status: "active" | "archived";
  defaultCurrency: string;
  createdAt: string;
  updatedAt: string;
};
type WireCategory = {
  id: string;
  name: string;
  icon: string | null;
  color: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};
type WireLabel = {
  id: string;
  name: string;
  color: string;
  status: "active" | "archived";
  createdAt: string;
  updatedAt: string;
};
type WireExpense = {
  id: string;
  amount: string;
  date: string;
  projectId: string | null;
  categoryId: string;
  description: string | null;
  paymentMethod: ParsedBackup["expenses"][number]["paymentMethod"];
  notes: string | null;
  currency: string;
  createdAt: string;
  updatedAt: string;
};
type WireBackup = {
  format: "pocketful-backup";
  version: number;
  exportedAt: string;
  counts: {
    projects: number;
    categories: number;
    labels: number;
    expenses: number;
    expenseLabels: number;
  };
  projects: WireProject[];
  categories: WireCategory[];
  labels: WireLabel[];
  expenses: WireExpense[];
  expenseLabels: Array<{ expenseId: string; labelId: string }>;
};

const SUPPORTED_BACKUP_VERSION = 1;

class BackupValidationError extends Error {
  readonly details: string[];

  constructor(details: string[]) {
    super(details[0] ?? "The backup failed validation.");
    this.name = "BackupValidationError";
    this.details = details;
  }
}

function databaseErrorCode(error: unknown, depth = 0): string | null {
  if (typeof error !== "object" || error === null || depth > 4) return null;
  const wrappedError = error as { code?: unknown; cause?: unknown };
  if (typeof wrappedError.code === "string") return wrappedError.code;
  return databaseErrorCode(wrappedError.cause, depth + 1);
}

function isoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function csvCell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvDocument(rows: ReadonlyArray<ReadonlyArray<unknown>>): string {
  return rows.map((row) => row.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

function sendCsv(res: Response, filename: string, content: string): void {
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(`\uFEFF${content}`);
}

function today(): string {
  return isoDate(new Date());
}

export async function loadBackup(): Promise<WireBackup> {
  const [projects, categories, labels, expenses, links] = await Promise.all([
    db
      .select({
        project: projectsTable,
        currencyCode: currenciesTable.code,
      })
      .from(projectsTable)
      .innerJoin(currenciesTable, eq(projectsTable.defaultCurrencyId, currenciesTable.id))
      .orderBy(asc(projectsTable.createdAt)),
    db.select().from(categoriesTable).orderBy(asc(categoriesTable.createdAt)),
    db.select().from(labelsTable).orderBy(asc(labelsTable.createdAt)),
    db
      .select({
        expense: expensesTable,
        currencyCode: currenciesTable.code,
      })
      .from(expensesTable)
      .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
      .orderBy(asc(expensesTable.date), asc(expensesTable.createdAt)),
    db
      .select()
      .from(expenseLabelsTable)
      .orderBy(asc(expenseLabelsTable.expenseId), asc(expenseLabelsTable.labelId)),
  ]);

  const projectRecords = projects.map(({ project, currencyCode }) => ({
    id: project.id,
    name: project.name,
    description: project.description,
    color: project.color,
    icon: project.icon,
    status: project.status,
    defaultCurrency: currencyCode,
    createdAt: project.createdAt.toISOString(),
    updatedAt: project.updatedAt.toISOString(),
  }));

  const categoryRecords = categories.map((category) => ({
    id: category.id,
    name: category.name,
    icon: category.icon,
    color: category.color,
    status: category.status,
    createdAt: category.createdAt.toISOString(),
    updatedAt: category.updatedAt.toISOString(),
  }));

  const labelRecords = labels.map((label) => ({
    id: label.id,
    name: label.name,
    color: label.color,
    status: label.status,
    createdAt: label.createdAt.toISOString(),
    updatedAt: label.updatedAt.toISOString(),
  }));

  const expenseRecords = expenses.map(({ expense, currencyCode }) => ({
    id: expense.id,
    amount: String(expense.amount),
    date: expense.date,
    projectId: expense.projectId,
    categoryId: expense.categoryId,
    description: expense.description,
    paymentMethod: expense.paymentMethod,
    notes: expense.notes,
    currency: currencyCode,
    createdAt: expense.createdAt.toISOString(),
    updatedAt: expense.updatedAt.toISOString(),
  }));

  const linkRecords = links.map((link) => ({
    expenseId: link.expenseId,
    labelId: link.labelId,
  }));

  return {
    format: "pocketful-backup",
    version: SUPPORTED_BACKUP_VERSION,
    exportedAt: new Date().toISOString(),
    counts: {
      projects: projectRecords.length,
      categories: categoryRecords.length,
      labels: labelRecords.length,
      expenses: expenseRecords.length,
      expenseLabels: linkRecords.length,
    },
    projects: projectRecords,
    categories: categoryRecords,
    labels: labelRecords,
    expenses: expenseRecords,
    expenseLabels: linkRecords,
  };
}

function findDuplicateIds(records: ReadonlyArray<{ id: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    if (seen.has(record.id)) duplicates.add(record.id);
    seen.add(record.id);
  }
  return [...duplicates];
}

function findDuplicateNames(records: ReadonlyArray<{ name: string }>): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const record of records) {
    const key = record.name.trim().toLowerCase();
    if (seen.has(key)) duplicates.add(record.name);
    seen.add(key);
  }
  return [...duplicates];
}

export function validateBackup(doc: ParsedBackup, known: {
  projectIds: Set<string>;
  categoryIds: Set<string>;
  labelIds: Set<string>;
  expenseIds: Set<string>;
  currencyCodes: Set<string>;
}): string[] {
  const errors: string[] = [];

  if (doc.version !== SUPPORTED_BACKUP_VERSION) {
    errors.push(
      `Unsupported backup version ${doc.version}. This app can import version ${SUPPORTED_BACKUP_VERSION} backups.`,
    );
  }

  const idCollections: Array<[string, ReadonlyArray<{ id: string }>]> = [
    ["project", doc.projects],
    ["category", doc.categories],
    ["label", doc.labels],
    ["expense", doc.expenses],
  ];
  for (const [label, records] of idCollections) {
    for (const id of findDuplicateIds(records)) {
      errors.push(`The backup contains more than one ${label} with the id ${id}.`);
    }
  }

  const nameCollections: Array<[string, ReadonlyArray<{ name: string }>]> = [
    ["project", doc.projects],
    ["category", doc.categories],
    ["label", doc.labels],
  ];
  for (const [label, records] of nameCollections) {
    for (const name of findDuplicateNames(records)) {
      errors.push(`The backup contains more than one ${label} named "${name}".`);
    }
  }

  const backupProjectIds = new Set(doc.projects.map((project) => project.id));
  const backupCategoryIds = new Set(doc.categories.map((category) => category.id));
  const backupLabelIds = new Set(doc.labels.map((label) => label.id));
  const backupExpenseIds = new Set(doc.expenses.map((expense) => expense.id));

  doc.expenses.forEach((expense, index) => {
    if (!(Number(expense.amount) > 0)) {
      errors.push(`Expense ${index + 1} has an amount that must be greater than zero.`);
    }
    if (!known.currencyCodes.has(expense.currency)) {
      errors.push(
        `Expense ${index + 1} uses the currency ${expense.currency}, which is not an available currency.`,
      );
    }
    if (!backupCategoryIds.has(expense.categoryId) && !known.categoryIds.has(expense.categoryId)) {
      errors.push(`Expense ${index + 1} references a category that is missing from the backup.`);
    }
    if (
      expense.projectId &&
      !backupProjectIds.has(expense.projectId) &&
      !known.projectIds.has(expense.projectId)
    ) {
      errors.push(`Expense ${index + 1} references a project that is missing from the backup.`);
    }
  });

  doc.projects.forEach((project, index) => {
    if (!known.currencyCodes.has(project.defaultCurrency)) {
      errors.push(
        `Project ${index + 1} uses the default currency ${project.defaultCurrency}, which is not an available currency.`,
      );
    }
  });

  doc.expenseLabels.forEach((link, index) => {
    if (!backupExpenseIds.has(link.expenseId) && !known.expenseIds.has(link.expenseId)) {
      errors.push(`Label link ${index + 1} references an expense that is missing from the backup.`);
    }
    if (!backupLabelIds.has(link.labelId) && !known.labelIds.has(link.labelId)) {
      errors.push(`Label link ${index + 1} references a label that is missing from the backup.`);
    }
  });

  return errors;
}

async function loadKnownIds(tx: Transaction) {
  const [projects, categories, labels, expenses, currencies] = await Promise.all([
    tx.select({ id: projectsTable.id }).from(projectsTable),
    tx.select({ id: categoriesTable.id }).from(categoriesTable),
    tx.select({ id: labelsTable.id }).from(labelsTable),
    tx.select({ id: expensesTable.id }).from(expensesTable),
    tx.select({ code: currenciesTable.code }).from(currenciesTable),
  ]);

  return {
    projectIds: new Set(projects.map((project) => project.id)),
    categoryIds: new Set(categories.map((category) => category.id)),
    labelIds: new Set(labels.map((label) => label.id)),
    expenseIds: new Set(expenses.map((expense) => expense.id)),
    currencyCodes: new Set(currencies.map((currency) => currency.code)),
  };
}

async function currencyIdsByCode(tx: Transaction): Promise<Map<string, string>> {
  const currencies = await tx.select({ id: currenciesTable.id, code: currenciesTable.code }).from(currenciesTable);
  return new Map(currencies.map((currency) => [currency.code, currency.id]));
}

function emptyCount(): BackupCount {
  return { created: 0, updated: 0, skipped: 0 };
}

async function importProjects(
  tx: Transaction,
  doc: ParsedBackup,
  warnings: string[],
  currencyIds: Map<string, string>,
): Promise<{ counts: BackupCount; idMap: Map<string, string> }> {
  const counts = emptyCount();
  const idMap = new Map<string, string>();

  const existing = await tx.select().from(projectsTable);
  const byId = new Map(existing.map((project) => [project.id, project]));
  const byName = new Map(existing.map((project) => [project.name.trim().toLowerCase(), project]));

  for (const project of doc.projects) {
    const matchById = byId.get(project.id);
    const matchByName = byName.get(project.name.trim().toLowerCase());
    const target = matchById ?? matchByName;
    const defaultCurrencyId = currencyIds.get(project.defaultCurrency);

    if (!defaultCurrencyId) {
      warnings.push(
        `Project "${project.name}" was skipped because ${project.defaultCurrency} is not an available currency.`,
      );
      counts.skipped += 1;
      continue;
    }

    if (target) {
      idMap.set(project.id, target.id);
      await tx
        .update(projectsTable)
        .set({
          name: project.name,
          description: project.description ?? null,
          color: project.color,
          icon: project.icon ?? null,
          status: project.status,
          defaultCurrencyId,
        })
        .where(eq(projectsTable.id, target.id));
      if (matchById) {
        counts.updated += 1;
      } else {
        counts.skipped += 1;
        warnings.push(`Project "${project.name}" matched an existing project by name.`);
      }
    } else {
      idMap.set(project.id, project.id);
      await tx.insert(projectsTable).values({
        id: project.id,
        name: project.name,
        description: project.description ?? null,
        color: project.color,
        icon: project.icon ?? null,
        status: project.status,
        defaultCurrencyId,
        ...(project.createdAt ? { createdAt: project.createdAt } : {}),
        ...(project.updatedAt ? { updatedAt: project.updatedAt } : {}),
      });
      counts.created += 1;
    }
  }

  return { counts, idMap };
}

async function importCategories(
  tx: Transaction,
  doc: ParsedBackup,
  warnings: string[],
): Promise<{ counts: BackupCount; idMap: Map<string, string> }> {
  const counts = emptyCount();
  const idMap = new Map<string, string>();

  const existing = await tx.select().from(categoriesTable);
  const byId = new Map(existing.map((category) => [category.id, category]));
  const byName = new Map(existing.map((category) => [category.name.trim().toLowerCase(), category]));

  for (const category of doc.categories) {
    const matchById = byId.get(category.id);
    const matchByName = byName.get(category.name.trim().toLowerCase());
    const target = matchById ?? matchByName;

    if (target) {
      idMap.set(category.id, target.id);
      await tx
        .update(categoriesTable)
        .set({
          name: category.name,
          icon: category.icon ?? null,
          color: category.color,
          status: category.status,
        })
        .where(eq(categoriesTable.id, target.id));
      if (matchById) {
        counts.updated += 1;
      } else {
        counts.skipped += 1;
        warnings.push(`Category "${category.name}" matched an existing category by name.`);
      }
    } else {
      idMap.set(category.id, category.id);
      await tx.insert(categoriesTable).values({
        id: category.id,
        name: category.name,
        icon: category.icon ?? null,
        color: category.color,
        status: category.status,
        ...(category.createdAt ? { createdAt: category.createdAt } : {}),
        ...(category.updatedAt ? { updatedAt: category.updatedAt } : {}),
      });
      counts.created += 1;
    }
  }

  return { counts, idMap };
}

async function importLabels(
  tx: Transaction,
  doc: ParsedBackup,
  warnings: string[],
): Promise<{ counts: BackupCount; idMap: Map<string, string> }> {
  const counts = emptyCount();
  const idMap = new Map<string, string>();

  const existing = await tx.select().from(labelsTable);
  const byId = new Map(existing.map((label) => [label.id, label]));
  const byName = new Map(existing.map((label) => [label.name.trim().toLowerCase(), label]));

  for (const label of doc.labels) {
    const matchById = byId.get(label.id);
    const matchByName = byName.get(label.name.trim().toLowerCase());
    const target = matchById ?? matchByName;

    if (target) {
      idMap.set(label.id, target.id);
      await tx
        .update(labelsTable)
        .set({
          name: label.name,
          color: label.color,
          status: label.status,
        })
        .where(eq(labelsTable.id, target.id));
      if (matchById) {
        counts.updated += 1;
      } else {
        counts.skipped += 1;
        warnings.push(`Label "${label.name}" matched an existing label by name.`);
      }
    } else {
      idMap.set(label.id, label.id);
      await tx.insert(labelsTable).values({
        id: label.id,
        name: label.name,
        color: label.color,
        status: label.status,
        ...(label.createdAt ? { createdAt: label.createdAt } : {}),
        ...(label.updatedAt ? { updatedAt: label.updatedAt } : {}),
      });
      counts.created += 1;
    }
  }

  return { counts, idMap };
}

async function importExpenses(
  tx: Transaction,
  doc: ParsedBackup,
  known: { expenseIds: Set<string> },
  projectMap: Map<string, string>,
  categoryMap: Map<string, string>,
  currencyIds: Map<string, string>,
): Promise<{ counts: BackupCount; importedIds: string[] }> {
  const counts = emptyCount();
  const existing = new Set(known.expenseIds);
  const importedIds: string[] = [];

  for (const expense of doc.expenses) {
    const categoryId = categoryMap.get(expense.categoryId) ?? expense.categoryId;
    const projectId = expense.projectId
      ? projectMap.get(expense.projectId) ?? expense.projectId
      : null;
    const currencyId = currencyIds.get(expense.currency);

    if (!currencyId) {
      counts.skipped += 1;
      continue;
    }

    const values = {
      amount: expense.amount,
      date: isoDate(expense.date),
      projectId,
      categoryId,
      currencyId,
      description: expense.description ?? null,
      paymentMethod: expense.paymentMethod ?? null,
      notes: expense.notes ?? null,
    };

    if (existing.has(expense.id)) {
      await tx.update(expensesTable).set(values).where(eq(expensesTable.id, expense.id));
      counts.updated += 1;
    } else {
      await tx.insert(expensesTable).values({
        id: expense.id,
        ...values,
        ...(expense.createdAt ? { createdAt: expense.createdAt } : {}),
        ...(expense.updatedAt ? { updatedAt: expense.updatedAt } : {}),
      });
      existing.add(expense.id);
      counts.created += 1;
    }

    importedIds.push(expense.id);
  }

  return { counts, importedIds };
}

async function applyBackup(tx: Transaction, doc: ParsedBackup) {
  const warnings: string[] = [];

  const currencyIds = await currencyIdsByCode(tx);
  const projects = await importProjects(tx, doc, warnings, currencyIds);
  const categories = await importCategories(tx, doc, warnings);
  const labels = await importLabels(tx, doc, warnings);

  const known = await loadKnownIds(tx);
  const expenses = await importExpenses(
    tx,
    doc,
    known,
    projects.idMap,
    categories.idMap,
    currencyIds,
  );

  const affectedExpenseIds = [
    ...new Set([...expenses.importedIds, ...doc.expenseLabels.map((link) => link.expenseId)]),
  ];

  if (affectedExpenseIds.length) {
    await tx
      .delete(expenseLabelsTable)
      .where(inArray(expenseLabelsTable.expenseId, affectedExpenseIds));
  }

  const pairs = new Map<string, { expenseId: string; labelId: string }>();
  for (const link of doc.expenseLabels) {
    const labelId = labels.idMap.get(link.labelId) ?? link.labelId;
    pairs.set(`${link.expenseId}::${labelId}`, { expenseId: link.expenseId, labelId });
  }

  if (pairs.size) {
    await tx.insert(expenseLabelsTable).values([...pairs.values()]);
  }

  return {
    projects: projects.counts,
    categories: categories.counts,
    labels: labels.counts,
    expenses: expenses.counts,
    expenseLabels: pairs.size,
    warnings: [...new Set(warnings)],
  };
}

const router: IRouter = Router();

router.get("/export/expenses", async (_req, res): Promise<void> => {
  const [expenses, labelRows] = await Promise.all([
    db
      .select({
        id: expensesTable.id,
        date: expensesTable.date,
        amount: expensesTable.amount,
        description: expensesTable.description,
        paymentMethod: expensesTable.paymentMethod,
        notes: expensesTable.notes,
        categoryName: categoriesTable.name,
        projectName: projectsTable.name,
        currencyCode: currenciesTable.code,
      })
      .from(expensesTable)
      .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
      .leftJoin(projectsTable, eq(expensesTable.projectId, projectsTable.id))
      .innerJoin(currenciesTable, eq(expensesTable.currencyId, currenciesTable.id))
      .orderBy(asc(expensesTable.date), asc(expensesTable.createdAt)),
    db
      .select({ expenseId: expenseLabelsTable.expenseId, name: labelsTable.name })
      .from(expenseLabelsTable)
      .innerJoin(labelsTable, eq(expenseLabelsTable.labelId, labelsTable.id))
      .orderBy(asc(labelsTable.name)),
  ]);

  const labelsByExpense = new Map<string, string[]>();
  for (const label of labelRows) {
    const current = labelsByExpense.get(label.expenseId) ?? [];
    current.push(label.name);
    labelsByExpense.set(label.expenseId, current);
  }

  const rows: unknown[][] = [
    ["Date", "Amount", "Currency", "Category", "Project", "Description", "Payment Method", "Labels", "Notes"],
    ...expenses.map((expense) => [
      expense.date,
      String(expense.amount),
      expense.currencyCode,
      expense.categoryName,
      expense.projectName,
      expense.description,
      expense.paymentMethod,
      (labelsByExpense.get(expense.id) ?? []).join(" | "),
      expense.notes,
    ]),
  ];

  sendCsv(res, `pocketful-expenses-${today()}.csv`, csvDocument(rows));
});

router.get("/export/projects", async (_req, res): Promise<void> => {
  const projects = await db
    .select({
      name: projectsTable.name,
      description: projectsTable.description,
      color: projectsTable.color,
      icon: projectsTable.icon,
      status: projectsTable.status,
      createdAt: projectsTable.createdAt,
      currencyCode: currenciesTable.code,
    })
    .from(projectsTable)
    .innerJoin(currenciesTable, eq(projectsTable.defaultCurrencyId, currenciesTable.id))
    .orderBy(asc(projectsTable.createdAt));
  const rows: unknown[][] = [
    ["Name", "Description", "Color", "Icon", "Status", "Default Currency", "Created"],
    ...projects.map((project) => [
      project.name,
      project.description,
      project.color,
      project.icon,
      project.status,
      project.currencyCode,
      project.createdAt.toISOString(),
    ]),
  ];
  sendCsv(res, `pocketful-projects-${today()}.csv`, csvDocument(rows));
});

router.get("/export/categories", async (_req, res): Promise<void> => {
  const categories = await db.select().from(categoriesTable).orderBy(asc(categoriesTable.createdAt));
  const rows: unknown[][] = [
    ["Name", "Icon", "Color", "Status", "Created"],
    ...categories.map((category) => [
      category.name,
      category.icon,
      category.color,
      category.status,
      category.createdAt.toISOString(),
    ]),
  ];
  sendCsv(res, `pocketful-categories-${today()}.csv`, csvDocument(rows));
});

router.get("/export/labels", async (_req, res): Promise<void> => {
  const labels = await db.select().from(labelsTable).orderBy(asc(labelsTable.createdAt));
  const rows: unknown[][] = [
    ["Name", "Color", "Status", "Created"],
    ...labels.map((label) => [
      label.name,
      label.color,
      label.status,
      label.createdAt.toISOString(),
    ]),
  ];
  sendCsv(res, `pocketful-labels-${today()}.csv`, csvDocument(rows));
});

router.get("/backup", async (_req, res): Promise<void> => {
  const backup = await loadBackup();
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="pocketful-backup-${today()}.json"`);
  res.send(JSON.stringify(backup));
});

router.post("/backup/import", async (req, res): Promise<void> => {
  const parsed = ImportBackupBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: "This file is not a valid Pocketful backup.",
      details: parsed.error.issues.slice(0, 10).map((issue) => {
        const path = issue.path.join(".");
        return path ? `${path}: ${issue.message}` : issue.message;
      }),
    });
    return;
  }

  try {
    const result = await db.transaction(async (tx) => {
      const known = await loadKnownIds(tx);
      const errors = validateBackup(parsed.data, known);
      if (errors.length) throw new BackupValidationError(errors);
      return applyBackup(tx, parsed.data);
    });
    res.json(result);
  } catch (error) {
    if (error instanceof BackupValidationError) {
      res.status(400).json({ error: error.message, details: error.details });
      return;
    }

    const code = databaseErrorCode(error);
    if (code === "23505") {
      res.status(409).json({ error: "The backup conflicts with data that already exists." });
      return;
    }
    if (code === "23503" || code === "23514") {
      res.status(409).json({ error: "The backup references data that no longer exists." });
      return;
    }

    logger.error({ err: error }, "Failed to import backup");
    res.status(500).json({ error: "Could not import the backup. Please try again." });
  }
});

export default router;
