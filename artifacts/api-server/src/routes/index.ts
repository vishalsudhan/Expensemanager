import { Router, type IRouter } from "express";
import backupRouter from "./backup";
import categoriesRouter from "./categories";
import currenciesRouter from "./currencies";
import dashboardRouter from "./dashboard";
import expensesRouter from "./expenses";
import healthRouter from "./health";
import labelsRouter from "./labels";
import projectsRouter from "./projects";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(categoriesRouter);
router.use(currenciesRouter);
router.use(labelsRouter);
router.use(projectsRouter);
router.use(expensesRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
router.use(backupRouter);

export default router;
