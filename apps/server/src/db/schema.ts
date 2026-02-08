import {
  pgTable,
  text,
  integer,
  serial,
  boolean,
  timestamp,
  doublePrecision,
  bigint,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

/**
 * Agents table - stores agent configuration
 */
export const agents = pgTable("agents", {
  id: text("id").primaryKey(), // 'alice' | 'bob'
  name: text("name").notNull(),
  circleWalletId: text("circle_wallet_id"),
  evmAddress: text("evm_address").notNull(),
  tokenAddress: text("token_address").notNull(),
  bondingCurveAddress: text("bonding_curve_address").notNull(),
  strategyType: text("strategy_type").notNull(), // 'academic' | 'degen'
  strategyConfig: text("strategy_config").notNull(), // JSON string
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

/**
 * Circle wallets - tracks wallets created via Circle API
 */
export const circleWallets = pgTable("circle_wallets", {
  id: text("id").primaryKey(), // Circle wallet ID
  agentId: text("agent_id").references(() => agents.id),
  address: text("address").notNull(),
  blockchain: text("blockchain").notNull().default("ARC-TESTNET"),
  walletSetId: text("wallet_set_id").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

/**
 * Decision logs - full history of agent decisions for UI
 */
export const decisionLogs = pgTable(
  "decision_logs",
  {
    id: serial("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    cycle: integer("cycle").notNull(),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(), // Unix ms
    stateSnapshot: text("state_snapshot").notNull(), // JSON string
    thinking: text("thinking").notNull(), // JSON string
    actions: text("actions").notNull(), // JSON string
    executionResults: text("execution_results"), // JSON string (nullable)
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    agentIdIdx: index("idx_decision_logs_agent_id").on(table.agentId),
    timestampIdx: index("idx_decision_logs_timestamp").on(table.timestamp),
  })
);

/**
 * Holdings - track token holdings and average buy price for P&L
 */
export const holdings = pgTable(
  "holdings",
  {
    id: serial("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    tokenAddress: text("token_address").notNull(),
    tokenName: text("token_name"),
    balance: text("balance").notNull(), // BigInt as string
    avgBuyPrice: text("avg_buy_price").notNull(), // BigInt as string (6 decimals)
    totalCostBasis: text("total_cost_basis").notNull(), // BigInt as string
    updatedAt: timestamp("updated_at").defaultNow(),
  },
  (table) => ({
    agentIdIdx: index("idx_holdings_agent_id").on(table.agentId),
  })
);

/**
 * Price history - cache prices for historical analysis
 */
export const priceHistory = pgTable(
  "price_history",
  {
    id: serial("id").primaryKey(),
    tokenAddress: text("token_address").notNull(),
    price: text("price").notNull(), // BigInt as string (6 decimals USDC)
    timestamp: timestamp("timestamp").notNull(),
    source: text("source").notNull().default("chain"), // 'stork' | 'chain'
  },
  (table) => ({
    tokenAddressIdx: index("idx_price_history_token").on(table.tokenAddress),
  })
);

/**
 * Market sentiment - cache Stork oracle data
 */
export const marketSentiment = pgTable(
  "market_sentiment",
  {
    id: serial("id").primaryKey(),
    asset: text("asset").notNull(), // 'ETHUSD', 'BTCUSD'
    price: text("price").notNull(), // BigInt as string (18 decimals)
    priceChange24h: doublePrecision("price_change_24h"),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(), // Unix ms
  },
  (table) => ({
    assetIdx: index("idx_market_sentiment_asset").on(table.asset),
  })
);

// Relations
export const agentsRelations = relations(agents, ({ many, one }) => ({
  decisionLogs: many(decisionLogs),
  holdings: many(holdings),
  circleWallet: one(circleWallets, {
    fields: [agents.id],
    references: [circleWallets.agentId],
  }),
  videoGenerations: many(videoGenerations),
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

/**
 * Videos table - stores video metadata and crypto material
 */
export const videos = pgTable(
  "videos",
  {
    id: text("id").primaryKey(),
    agentId: text("agent_id").references(() => agents.id),
    title: text("title").notNull(),
    description: text("description"),
    status: text("status").notNull().default("pending"),
    durationSeconds: integer("duration_seconds"),
    totalSegments: integer("total_segments"),
    quality: text("quality").default("720p"),
    masterSecret: text("master_secret"), // Encrypted at rest via AES-256-GCM
    merkleRoot: text("merkle_root"),
    merkleTreeData: text("merkle_tree_data"),
    contentUri: text("content_uri"),
    thumbnailUri: text("thumbnail_uri"),
    // Denormalized agent fields for on-chain settlement
    creatorWallet: text("creator_wallet"),
    creatorTokenAddress: text("creator_token_address"),
    creatorBondingCurveAddress: text("creator_bonding_curve_address"),
    // On-chain registration (Base Sepolia)
    registryTxHash: text("registry_tx_hash"),
    registryChainId: integer("registry_chain_id"),
    createdAt: timestamp("created_at").defaultNow(),
    processedAt: timestamp("processed_at"),
  },
  (table) => ({
    agentIdIdx: index("idx_videos_agent_id").on(table.agentId),
    statusIdx: index("idx_videos_status").on(table.status),
  })
);

/**
 * Viewer sessions - temporary auth for key access (replaced by Yellow in Phase 4.5)
 */
export const viewerSessions = pgTable(
  "viewer_sessions",
  {
    id: text("id").primaryKey(),
    videoId: text("video_id")
      .notNull()
      .references(() => videos.id),
    viewerAddress: text("viewer_address"),
    segmentsAccessed: integer("segments_accessed").default(0),
    createdAt: timestamp("created_at").defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
  },
  (table) => ({
    videoIdIdx: index("idx_viewer_sessions_video_id").on(table.videoId),
    expiresIdx: index("idx_viewer_sessions_expires").on(table.expiresAt),
  })
);

export const videosRelations = relations(videos, ({ one }) => ({
  agent: one(agents, {
    fields: [videos.agentId],
    references: [agents.id],
  }),
}));

export const viewerSessionsRelations = relations(
  viewerSessions,
  ({ one }) => ({
    video: one(videos, {
      fields: [viewerSessions.videoId],
      references: [videos.id],
    }),
  })
);

/**
 * Yellow sessions - state channel payment sessions for pay-per-second streaming
 */
export const yellowSessions = pgTable(
  "yellow_sessions",
  {
    id: text("id").primaryKey(), // app_session_id from Yellow ClearNode
    videoId: text("video_id")
      .notNull()
      .references(() => videos.id),
    viewerAddress: text("viewer_address").notNull(),
    creatorAddress: text("creator_address").notNull(),
    serverAddress: text("server_address").notNull(),
    totalDeposited: text("total_deposited").notNull(),
    viewerBalance: text("viewer_balance").notNull(),
    creatorBalance: text("creator_balance").notNull(),
    segmentsDelivered: integer("segments_delivered").default(0),
    pricePerSegment: text("price_per_segment").notNull(),
    status: text("status").notNull().default("active"), // active | closed | settled
    // Denormalized agent fields for settlement
    creatorTokenAddress: text("creator_token_address"),
    creatorBondingCurveAddress: text("creator_bonding_curve_address"),
    // Settlement tx tracking (cross-chain)
    settlementTxHash: text("settlement_tx_hash"), // legacy field
    settlementTxHashBase: text("settlement_tx_hash_base"), // Base Sepolia settlement record
    bridgeTxHash: text("bridge_tx_hash"), // Base Sepolia bridge escrow
    distributionTxHash: text("distribution_tx_hash"), // ARC testnet revenue distribution
    // Nitrolite Custody on-chain state channel tracking
    channelId: text("channel_id"), // On-chain state channel ID
    custodyDepositTxHash: text("custody_deposit_tx_hash"), // USDC deposited into Custody
    channelCloseTxHash: text("channel_close_tx_hash"), // Channel closed on-chain
    custodyWithdrawTxHash: text("custody_withdraw_tx_hash"), // Funds withdrawn from Custody
    createdAt: timestamp("created_at").defaultNow(),
    closedAt: timestamp("closed_at"),
  },
  (table) => ({
    videoIdIdx: index("idx_yellow_sessions_video").on(table.videoId),
    viewerIdx: index("idx_yellow_sessions_viewer").on(table.viewerAddress),
    statusIdx: index("idx_yellow_sessions_status").on(table.status),
  })
);

export const yellowSessionsRelations = relations(
  yellowSessions,
  ({ one }) => ({
    video: one(videos, {
      fields: [yellowSessions.videoId],
      references: [videos.id],
    }),
  })
);

/**
 * Trades - on-chain buy/sell events from bonding curves for chart data
 */
export const trades = pgTable(
  "trades",
  {
    id: serial("id").primaryKey(),
    tokenAddress: text("token_address").notNull(),
    bondingCurveAddress: text("bonding_curve_address").notNull(),
    side: text("side").notNull(), // 'buy' | 'sell'
    trader: text("trader").notNull(),
    usdcAmount: text("usdc_amount").notNull(), // BigInt string (6 decimals)
    tokenAmount: text("token_amount").notNull(), // BigInt string (18 decimals)
    price: text("price").notNull(), // newPrice from event (6 decimals)
    txHash: text("tx_hash"),
    blockNumber: integer("block_number"),
    timestamp: bigint("timestamp", { mode: "number" }).notNull(), // Unix ms
  },
  (table) => ({
    tokenAddressIdx: index("idx_trades_token").on(table.tokenAddress),
    timestampIdx: index("idx_trades_timestamp").on(table.timestamp),
  })
);

/**
 * Video Generations - tracks autonomous video generation lifecycle
 */
export const videoGenerations = pgTable(
  "video_generations",
  {
    id: serial("id").primaryKey(),
    agentId: text("agent_id")
      .notNull()
      .references(() => agents.id),
    status: text("status").notNull().default("pending"),
    // Ideation outputs
    title: text("title"),
    description: text("description"),
    videoPrompt: text("video_prompt"),
    thumbnailPrompt: text("thumbnail_prompt"),
    duration: integer("duration"),
    // Generation results
    videoId: text("video_id").references(() => videos.id),
    sizeBytes: integer("size_bytes"),
    costEstimate: text("cost_estimate"),
    error: text("error"),
    // Timestamps
    startedAt: timestamp("started_at").notNull(),
    completedAt: timestamp("completed_at"),
    updatedAt: timestamp("updated_at").defaultNow(),
    createdAt: timestamp("created_at").defaultNow(),
  },
  (table) => ({
    agentIdIdx: index("idx_video_generations_agent_id").on(table.agentId),
    statusIdx: index("idx_video_generations_status").on(table.status),
  })
);

export const videoGenerationsRelations = relations(
  videoGenerations,
  ({ one }) => ({
    agent: one(agents, {
      fields: [videoGenerations.agentId],
      references: [agents.id],
    }),
    video: one(videos, {
      fields: [videoGenerations.videoId],
      references: [videos.id],
    }),
  })
);

// Type exports
export type Agent = typeof agents.$inferSelect;
export type NewAgent = typeof agents.$inferInsert;
export type DecisionLog = typeof decisionLogs.$inferSelect;
export type NewDecisionLog = typeof decisionLogs.$inferInsert;
export type Holding = typeof holdings.$inferSelect;
export type NewHolding = typeof holdings.$inferInsert;
export type CircleWallet = typeof circleWallets.$inferSelect;
export type NewCircleWallet = typeof circleWallets.$inferInsert;
export type Video = typeof videos.$inferSelect;
export type NewVideo = typeof videos.$inferInsert;
export type ViewerSession = typeof viewerSessions.$inferSelect;
export type NewViewerSession = typeof viewerSessions.$inferInsert;
export type YellowSession = typeof yellowSessions.$inferSelect;
export type NewYellowSession = typeof yellowSessions.$inferInsert;
export type Trade = typeof trades.$inferSelect;
export type NewTrade = typeof trades.$inferInsert;
export type VideoGeneration = typeof videoGenerations.$inferSelect;
export type NewVideoGeneration = typeof videoGenerations.$inferInsert;
