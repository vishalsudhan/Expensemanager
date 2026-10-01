import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const router: IRouter = Router();

router.get("/healthz", async (req, res) => {
  try {
    await db.execute(sql`select 1`);
    const data = HealthCheckResponse.parse({ status: "ok" });
    res.json(data);
  } catch (err) {
    req.log.error({ err }, "Database health check failed");
    const data = HealthCheckResponse.parse({ status: "error" });
    res.status(503).json(data);
  }
});

export default router;
