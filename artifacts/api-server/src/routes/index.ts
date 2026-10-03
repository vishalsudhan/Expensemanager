import { Router, type IRouter } from "express";
import authRouter from "./auth";
import backupRouter from "./backup";
import categoriesRouter from "./categories";
import currenciesRouter from "./currencies";
import dashboardRouter from "./dashboard";
import expensesRouter from "./expenses";
import healthRouter from "./health";
import labelsRouter from "./labels";
import locationsRouter from "./locations";
import projectsRouter from "./projects";
import reportsRouter from "./reports";
import { requireAuth } from "../middlewares/auth";

const router: IRouter = Router();

// Health stays reachable without a session so a deploy can be probed.
router.use(healthRouter);

// Sign-in, one-time setup and password reset. These decide whether a session
// exists, so they must run before the gate below.
router.use(authRouter);

// Everything past this point is financial data and requires a live session.
router.use(requireAuth);
router.use(categoriesRouter);
router.use(currenciesRouter);
router.use(locationsRouter);
router.use(labelsRouter);
router.use(projectsRouter);
router.use(expensesRouter);
router.use(dashboardRouter);
router.use(reportsRouter);
router.use(backupRouter);

export default router;
