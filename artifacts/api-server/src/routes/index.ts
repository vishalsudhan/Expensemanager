import { Router, type IRouter } from "express";
import categoriesRouter from "./categories";
import healthRouter from "./health";
import projectsRouter from "./projects";

const router: IRouter = Router();

router.use(healthRouter);
router.use(categoriesRouter);
router.use(projectsRouter);

export default router;
