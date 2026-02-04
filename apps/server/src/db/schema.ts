import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { relations } from "drizzle-orm";

/**
 * Agents table - stores agent configuration
 */
export const agents = sqliteTable("agents", {
  id: text("id").primaryKey(), // 'alice' | 'bob'
  name: text("name").notNull(),
  circleWalletId: text("circle_wallet_id"),
  evmAddress: text("evm_address").notNull(),
  tokenAddress: text("token_address").notNull(),
  bondingCurveAddress: text("bonding_curve_address").notNull(),
  strategyType: text("strategy_type").notNull(), // 'academic' | 'degen'
  strategyConfig: text("strategy_config", { mode: "json" }).notNull(), // JSON
  isActive: integer("is_active", { mode: "boolean" }).default(true),
  createdAt: integer("created_at", { mode: "timestamp" }).$defaultFn(
    () => new Date()
  ),
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date()
  ),
});

/**
 * Circle wallets - tracks wallets created via Circle API
 */
export const circleWallets = sqliteTable("circle_wallets", {
  id: text("id").primaryKey(), // Circle wallet ID
  agentId: text("agent_id").references(() => agents.id),
  address: text("address").notNull(),
  blockchain: text("blockchain").notNull().default("EVM-TESTNET"),
  walletSetId: text("wallet_set_id").notNull(),
  createdAt: integer("created_at").$defaultFn(() => Date.now()),
});

/**
 * Decision logs - full history of agent decisions for UI
 */
export const decisionLogs = sqliteTable("decision_logs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  cycle: integer("cycle").notNull(),
  timestamp: integer("timestamp").notNull(), // Unix ms
  stateSnapshot: text("state_snapshot").notNull(), // JSON string
  thinking: text("thinking").notNull(), // JSON string
  actions: text("actions").notNull(), // JSON string
  createdAt: integer("created_at").$defaultFn(() => Date.now()),
});

/**
 * Holdings - track token holdings and average buy price for P&L
 */
export const holdings = sqliteTable("holdings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: text("agent_id")
    .notNull()
    .references(() => agents.id),
  tokenAddress: text("token_address").notNull(),
  tokenName: text("token_name"),
  balance: text("balance").notNull(), // BigInt as string
  avgBuyPrice: text("avg_buy_price").notNull(), // BigInt as string (6 decimals)
  totalCostBasis: text("total_cost_basis").notNull(), // BigInt as string
  updatedAt: integer("updated_at", { mode: "timestamp" }).$defaultFn(
    () => new Date()
  ),
});

/**
 * Price history - cache prices for historical analysis
 */
export const priceHistory = sqliteTable("price_history", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  tokenAddress: text("token_address").notNull(),
  price: text("price").notNull(), // BigInt as string (6 decimals USDC)
  timestamp: integer("timestamp", { mode: "timestamp" }).notNull(),
  source: text("source").notNull().default("chain"), // 'stork' | 'chain'
});

/**
 * Market sentiment - cache Stork oracle data
 */
export const marketSentiment = sqliteTable("market_sentiment", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  asset: text("asset").notNull(), // 'ETHUSD', 'BTCUSD'
  price: text("price").notNull(), // BigInt as string (18 decimals)
  priceChange24h: real("price_change_24h"),
  timestamp: integer("timestamp").notNull(), // Unix ms
});

// Relations
export const agentsRelations = relations(agents, ({ many, one }) => ({
  decisionLogs: many(decisionLogs),
  holdings: many(holdings),
  circleWallet: one(circleWallets, {
    fields: [agents.id],
    references: [circleWallets.agentId],
  }),
}));

export const decisionLogsRelations = relations(decisionLogs, ({ one }) => ({
  agent: one(agents, {
    fields: [decisionLogs.agentId],
    references: [agents.id],
  }),
}));

export const holdingsRelations = relations(holdings, ({ one }) => ({
  agent: one(agents, {
    fields: [holdings.agentId],
    references: [agents.id],
  }),
}));

export const circleWalletsRelations = relations(circleWallets, ({ one }) => ({
  agent: one(agents, {
    fields: [circleWallets.agentId],
    references: [agents.id],
  }),
}));

// Type exports
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type DecisionLog = typeof decisionLogs.$inferSelect;
export type NewDecisionLog = typeof decisionLogs.$inferInsert;
export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;
export type CircleWallet = typeof circleWallets.$inferSelect;
export type NewCircleWallet = typeof circleWallets.$inferInsert;
