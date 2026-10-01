import { Router, type IRouter } from "express";
import {
  asc,
  count,
  desc,
  eq,
  sql,
} from "drizzle-orm";
import {
  ArchiveProjectParams,
  ArchiveProjectResponse,
  CreateProjectBody,
  CreateProjectResponse,
  GetProjectParams,
  GetProjectResponse,
  ListProjectsQueryParams,
  ListProjectsResponse,
  UpdateProjectBody,
  UpdateProjectParams,
  UpdateProjectResponse,
} from "@workspace/api-zod";
import {
  categoriesTable,
  db,
  expensesTable,
  projectsTable,
} from "@workspace/db";

const router: IRouter = Router();

const totalSpent = sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`.mapWith(String);
const expenseCount = count(expensesTable.id);

function isUniqueConstraintError(error: unknown, depth = 0): boolean {
  if (typeof error !== "object" || error === null || depth > 4) return false;

  const wrappedError = error as { code?: unknown; cause?: unknown };
  if (wrappedError.code === "23505") return true;
  return isUniqueConstraintError(wrappedError.cause, depth + 1);
}

router.get("/projects", async (req, res): Promise<void> => {
  const parsed = ListProjectsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid project status filter." });
    return;
  }

  const status = parsed.data.status ?? "active";
  const statusCondition =
    status === "all" ? undefined : eq(projectsTable.status, status);

  const projects = await db
    .select({
      id: projectsTable.id,
      name: projectsTable.name,
      description: projectsTable.description,
      color: projectsTable.color,
      icon: projectsTable.icon,
      status: projectsTable.status,
      createdAt: projectsTable.createdAt,
      updatedAt: projectsTable.updatedAt,
      totalSpent,
      expenseCount,
    })
    .from(projectsTable)
    .leftJoin(expensesTable, eq(expensesTable.projectId, projectsTable.id))
    .where(statusCondition)
    .groupBy(projectsTable.id)
    .orderBy(desc(projectsTable.updatedAt), asc(projectsTable.name));

  res.json(ListProjectsResponse.parse(projects));
});

router.post("/projects", async (req, res): Promise<void> => {
  const parsed = CreateProjectBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Enter a valid project name and details." });
    return;
  }

  const name = parsed.data.name.trim();
  if (!name) {
    res.status(400).json({ error: "Project name cannot be blank." });
    return;
  }

  try {
    const [project] = await db
      .insert(projectsTable)
      .values({ ...parsed.data, name })
      .returning();

    res.status(201).json(CreateProjectResponse.parse(project));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A project with this name already exists." });
      return;
    }
    throw error;
  }
});

router.get("/projects/:projectId", async (req, res): Promise<void> => {
  const params = GetProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }

  const [project] = await db
    .select()
    .from(projectsTable)
    .where(eq(projectsTable.id, params.data.projectId))
    .limit(1);

  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  const [totals] = await db
    .select({
      totalSpent: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`.mapWith(String),
      expenseCount: count(expensesTable.id),
    })
    .from(expensesTable)
    .where(eq(expensesTable.projectId, project.id));

  const categoryBreakdown = await db
    .select({
      categoryId: categoriesTable.id,
      categoryName: categoriesTable.name,
      categoryColor: categoriesTable.color,
      categoryIcon: categoriesTable.icon,
      totalSpent: sql<string>`coalesce(sum(${expensesTable.amount}), 0)::text`.mapWith(String),
      expenseCount: count(expensesTable.id),
    })
    .from(expensesTable)
    .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
    .where(eq(expensesTable.projectId, project.id))
    .groupBy(categoriesTable.id)
    .orderBy(desc(sql`sum(${expensesTable.amount})`), asc(categoriesTable.name));

  const recentExpenses = await db
    .select({
      id: expensesTable.id,
      amount: expensesTable.amount,
      date: expensesTable.date,
      description: expensesTable.description,
      categoryId: categoriesTable.id,
      categoryName: categoriesTable.name,
      categoryColor: categoriesTable.color,
      categoryIcon: categoriesTable.icon,
      paymentMethod: expensesTable.paymentMethod,
    })
    .from(expensesTable)
    .innerJoin(categoriesTable, eq(expensesTable.categoryId, categoriesTable.id))
    .where(eq(expensesTable.projectId, project.id))
    .orderBy(desc(expensesTable.date), desc(expensesTable.createdAt))
    .limit(5);

  res.json(
    GetProjectResponse.parse({
      project,
      totalSpent: totals?.totalSpent ?? "0",
      expenseCount: totals?.expenseCount ?? 0,
      categoryBreakdown,
      recentExpenses,
    }),
  );
});

router.patch("/projects/:projectId", async (req, res): Promise<void> => {
  const params = UpdateProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }

  const parsed = UpdateProjectBody.safeParse(req.body);
  if (!parsed.success || Object.keys(parsed.data ?? {}).length === 0) {
    res.status(400).json({ error: "Provide at least one valid project field." });
    return;
  }

  const changes = { ...parsed.data };
  if (changes.name !== undefined) {
    changes.name = changes.name.trim();
    if (!changes.name) {
      res.status(400).json({ error: "Project name cannot be blank." });
      return;
    }
  }

  try {
    const [project] = await db
      .update(projectsTable)
      .set(changes)
      .where(eq(projectsTable.id, params.data.projectId))
      .returning();

    if (!project) {
      res.status(404).json({ error: "Project not found." });
      return;
    }

    res.json(UpdateProjectResponse.parse(project));
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      res.status(409).json({ error: "A project with this name already exists." });
      return;
    }
    throw error;
  }
});

router.patch("/projects/:projectId/archive", async (req, res): Promise<void> => {
  const params = ArchiveProjectParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Invalid project ID." });
    return;
  }

  const [project] = await db
    .update(projectsTable)
    .set({ status: "archived" })
    .where(eq(projectsTable.id, params.data.projectId))
    .returning();

  if (!project) {
    res.status(404).json({ error: "Project not found." });
    return;
  }

  res.json(ArchiveProjectResponse.parse(project));
});

export default router;