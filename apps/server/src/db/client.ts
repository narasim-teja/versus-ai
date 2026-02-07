import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";
import { logger } from "../utils/logger";
import { env } from "../utils/env";

// Create postgres-js connection with Supabase pooler settings
const sql = postgres(env.DATABASE_URL, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  prepare: false, // Required for Supabase Transaction Pooler (PgBouncer)
});

// Create Drizzle ORM instance
export const db = drizzle(sql, { schema });

logger.info("Database connection pool initialized (PostgreSQL)");

export type DB = typeof db;

/**
 * Verify database connectivity.
 * Table creation is handled by drizzle-kit push/migrate.
 */
export async function initializeDatabase() {
  logger.info("Verifying database connection...");
  try {
    await sql`SELECT 1`;
    logger.info("Database connection verified (PostgreSQL/Supabase)");
  } catch (error) {
    logger.error({ error }, "Failed to connect to database");
    throw error;
  }
}

/**
 * Gracefully close the database connection pool.
 */
export async function closeDatabase() {
  await sql.end();
  logger.info("Database connection pool closed");
}
