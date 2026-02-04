import { drizzle } from "drizzle-orm/bun-sqlite";
import { Database } from "bun:sqlite";
import * as schema from "./schema";
import { logger } from "../utils/logger";

// Get database path from env, removing 'file:' prefix if present
const dbPath = (process.env.DATABASE_URL || "file:./data/versus.db").replace(
  "file:",
  ""
);

// Create SQLite database
const sqlite = new Database(dbPath);

// Enable WAL mode for better concurrent performance
sqlite.exec("PRAGMA journal_mode = WAL;");

// Create Drizzle ORM instance
export const db = drizzle(sqlite, { schema });

logger.info({ dbPath }, "Database initialized");

export type DB = typeof db;

// Initialize tables (simple migration for development)
export function initializeDatabase() {
  logger.info("Initializing database tables...");

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      circle_wallet_id TEXT,
      evm_address TEXT NOT NULL,
      token_address TEXT NOT NULL,
      bonding_curve_address TEXT NOT NULL,
      strategy_type TEXT NOT NULL,
      strategy_config TEXT NOT NULL,
      is_active INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS circle_wallets (
      id TEXT PRIMARY KEY,
      agent_id TEXT REFERENCES agents(id),
      address TEXT NOT NULL,
      blockchain TEXT NOT NULL DEFAULT 'EVM-TESTNET',
      wallet_set_id TEXT NOT NULL,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS decision_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      cycle INTEGER NOT NULL,
      timestamp INTEGER NOT NULL,
      state_snapshot TEXT NOT NULL,
      thinking TEXT NOT NULL,
      actions TEXT NOT NULL,
      created_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      agent_id TEXT NOT NULL REFERENCES agents(id),
      token_address TEXT NOT NULL,
      token_name TEXT,
      balance TEXT NOT NULL,
      avg_buy_price TEXT NOT NULL,
      total_cost_basis TEXT NOT NULL,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS price_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      token_address TEXT NOT NULL,
      price TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      source TEXT NOT NULL DEFAULT 'chain'
    );

    CREATE TABLE IF NOT EXISTS market_sentiment (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset TEXT NOT NULL,
      price TEXT NOT NULL,
      price_change_24h REAL,
      timestamp INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_decision_logs_agent_id ON decision_logs(agent_id);
    CREATE INDEX IF NOT EXISTS idx_decision_logs_timestamp ON decision_logs(timestamp);
    CREATE INDEX IF NOT EXISTS idx_holdings_agent_id ON holdings(agent_id);
    CREATE INDEX IF NOT EXISTS idx_price_history_token ON price_history(token_address);
    CREATE INDEX IF NOT EXISTS idx_market_sentiment_asset ON market_sentiment(asset);
  `);

  logger.info("Database tables initialized");
}
