/**
 * Quick DB query script - uses the project's Drizzle ORM setup
 * Usage: bun run scripts/query-sessions.ts
 */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { desc } from "drizzle-orm";
import * as schema from "../src/db/schema";
const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
const db = drizzle(sql, { schema });

const sessions = await db
  .select({
    id: schema.yellowSessions.id,
    videoId: schema.yellowSessions.videoId,
    status: schema.yellowSessions.status,
    creatorBalance: schema.yellowSessions.creatorBalance,
    viewerBalance: schema.yellowSessions.viewerBalance,
    segmentsDelivered: schema.yellowSessions.segmentsDelivered,
    createdAt: schema.yellowSessions.createdAt,
  })
  .from(schema.yellowSessions)
  .orderBy(desc(schema.yellowSessions.createdAt))
  .limit(5);

console.log("\n=== Yellow Sessions ===");
console.table(sessions);

await sql.end();
