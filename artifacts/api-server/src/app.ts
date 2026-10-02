import express, {
  type ErrorRequestHandler,
  type Express,
  type RequestHandler,
} from "express";
import cors, { type CorsOptions } from "cors";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import {
  apiRateLimit,
  importRateLimit,
  securityHeaders,
} from "./middlewares/security";

const app: Express = express();

const allowedOrigins = (process.env.CORS_ORIGINS ?? "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

const corsOptions: CorsOptions =
  allowedOrigins.length > 0
    ? { origin: allowedOrigins }
    : process.env.NODE_ENV === "production"
      ? // The web app and API are served from the same origin in production,
        // so no cross-origin access is needed.
        { origin: false }
      : {};

app.disable("x-powered-by");
app.set("trust proxy", 1);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(securityHeaders());
app.use(cors(corsOptions));
app.use(express.json({ limit: "25mb" }));
app.use(express.urlencoded({ extended: true, limit: "25mb" }));

app.use("/api/backup/import", importRateLimit);
app.use("/api", apiRateLimit);
app.use("/api", router);

const apiNotFound: RequestHandler = (_req, res) => {
  res.status(404).json({ error: "Not found." });
};
app.use("/api", apiNotFound);

const errorHandler: ErrorRequestHandler = (error, req, res, next) => {
  if (res.headersSent) {
    next(error);
    return;
  }

  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    type?: unknown;
    message?: unknown;
  };

  const status =
    typeof candidate.status === "number"
      ? candidate.status
      : typeof candidate.statusCode === "number"
        ? candidate.statusCode
        : 500;

  req.log?.error({ err: error }, "request failed");

  if (candidate.type === "entity.too.large") {
    res.status(413).json({ error: "The request payload is too large." });
    return;
  }

  if (error instanceof SyntaxError && status < 500) {
    res.status(400).json({ error: "The request body is not valid JSON." });
    return;
  }

  if (status >= 500) {
    res.status(500).json({ error: "Something went wrong on the server." });
    return;
  }

  const message =
    typeof candidate.message === "string" && candidate.message.length > 0
      ? candidate.message
      : "Request could not be completed.";
  res.status(status).json({ error: message });
};

app.use(errorHandler);

export default app;
