import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX ?? 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
  application_name: "expense-manager",
});

pool.on("error", (error) => {
  console.error("[db] idle client error", error);
});

// pg-pool only attaches its own error listener while a client is idle, so a
// connection dropped mid-query would otherwise surface as an unhandled "error"
// event and crash the process. Keep a listener on every client for its lifetime.
pool.on("connect", (client) => {
  client.on("error", (error) => {
    console.error("[db] client error", error);
  });
});

export const db = drizzle(pool, { schema });

export * from "./schema";
