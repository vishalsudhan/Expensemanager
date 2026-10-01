import { Router, type IRouter } from "express";
import categoriesRouter from "./categories";
import healthRouter from "./health";
import labelsRouter from "./labels";
import projectsRouter from "./projects";

const router: IRouter = Router();

router.use(healthRouter);
router.use(categoriesRouter);
router.use(labelsRouter);
router.use(projectsRouter);

export default router;
