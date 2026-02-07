/**
 * Versus Agent Server
 *
 * Main entry point for the agent runtime server.
 *
 * Starts:
 * - Hono HTTP server with REST API
 * - WebSocket support for real-time updates
 * - Alice and Bob agent loops
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import { env } from "./utils/env";
import { logger } from "./utils/logger";
import { initializeDatabase } from "./db/client";
import { healthRoutes, agentRoutes, agentsWebsocket, videoRoutes, streamingRoutes, authRoutes } from "./api/routes";
import { createAllAgentConfigs, startAllAgents, stopAllAgents } from "./agents";
import { initializeAgentWallets } from "./agents/init";
import {
  watchBondingCurveEvents,
  watchCreatorFactory,
} from "./integrations/chain/events";
import {
  isYellowConfigured,
  getYellowClient,
  disconnectYellow,
} from "./integrations/yellow";
import type { Address } from "viem";

// Create Hono app
const app = new Hono();

// Middleware
app.use("*", cors({
  origin: env.FRONTEND_URL || "*",
  allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowHeaders: ["Content-Type", "Authorization", "X-Yellow-Session"],
}));

app.use("*", honoLogger());

// Routes
app.route("/health", healthRoutes);
app.route("/api/agents", agentRoutes);
app.route("/api/videos", videoRoutes);
app.route("/api/videos", streamingRoutes);
app.route("/api/auth", authRoutes);

// Root endpoint
app.get("/", (c) => {
  return c.json({
    name: "Versus Agent Server",
    version: "0.1.0",
    status: "running",
    endpoints: {
      health: "/health",
      agents: "/api/agents",
      agentDetail: "/api/agents/:id",
      decisions: "/api/agents/:id/decisions",
      recentDecisions: "/api/agents/:id/decisions/recent",
      websocket: "/api/agents/:id/ws",
      videos: "/api/videos",
      videoUpload: "/api/videos/upload",
      videoStream: "/api/videos/:videoId/master.m3u8",
      videoKey: "/api/videos/:videoId/key/:segment",
      videoSession: "/api/videos/:videoId/session",
      sessionClose: "/api/videos/:videoId/session/:sessionId/close",
      sessionStatus: "/api/videos/:videoId/session/:sessionId/status",
    },
  });
});

// 404 handler
app.notFound((c) => {
  return c.json({ error: "Not found" }, 404);
});

// Error handler
app.onError((err, c) => {
  logger.error({ error: err.message, stack: err.stack }, "Unhandled error");
  return c.json({ error: "Internal server error" }, 500);
});

// Event watcher cleanup functions
const eventUnwatchers: Array<() => void> = [];

// Graceful shutdown handler
function setupShutdownHandler() {
  const shutdown = () => {
    logger.info("Shutdown signal received, stopping agents...");
    stopAllAgents();
    // Stop event watchers
    for (const unwatch of eventUnwatchers) {
      unwatch();
    }
    // Disconnect Yellow Network
    disconnectYellow();
    logger.info("Agents, event watchers, and Yellow stopped, exiting...");
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Start server
async function main() {
  logger.info({ nodeEnv: env.NODE_ENV }, "Starting Versus Agent Server");

  // Initialize database
  initializeDatabase();

  // Set up shutdown handler
  setupShutdownHandler();

  // Create and start agents
  const agentConfigs = createAllAgentConfigs();
  logger.info(
    { agents: agentConfigs.map((a) => a.id) },
    "Agent configurations loaded"
  );

  // Initialize Circle wallets for agents
  const agentWallets = await initializeAgentWallets(agentConfigs);
  logger.info(
    { walletCount: agentWallets.size },
    "Circle wallets initialized"
  );

  // Apply Circle wallet IDs to agent configs
  for (const [agentId, walletInfo] of agentWallets) {
    const config = agentConfigs.find((c) => c.id === agentId);
    if (config) {
      config.circleWalletId = walletInfo.circleWalletId;
      config.evmAddress = walletInfo.circleWalletAddress as `0x${string}`;
      logger.info(
        {
          agentId,
          circleWalletId: walletInfo.circleWalletId,
          evmAddress: walletInfo.circleWalletAddress,
        },
        "Applied Circle wallet to agent config"
      );
    }
  }

  // Initialize Yellow Network if configured
  if (isYellowConfigured()) {
    try {
      await getYellowClient();
      logger.info("Yellow Network ClearNode connected and authenticated");
    } catch (err) {
      logger.warn({ err }, "Yellow Network initialization failed (non-fatal, will retry on first use)");
    }
  } else {
    logger.info("Yellow Network not configured, using legacy bearer auth for streaming");
  }

  // Start agents (30 second cycle interval)
  startAllAgents(agentConfigs, 30_000);
  logger.info("Agent loops started");

  // Start on-chain event watchers for each agent's bonding curve
  for (const config of agentConfigs) {
    const unwatch = watchBondingCurveEvents(
      config.bondingCurveAddress as Address,
      {
        onPurchase: (event) => {
          logger.info(
            { agentId: config.id, buyer: event.buyer, usdcIn: event.usdcIn.toString() },
            "Token purchase detected on agent's bonding curve"
          );
        },
        onSale: (event) => {
          logger.info(
            { agentId: config.id, seller: event.seller, usdcOut: event.usdcOut.toString() },
            "Token sale detected on agent's bonding curve"
          );
        },
        onRevenueClaimed: (event) => {
          logger.info(
            { agentId: config.id, user: event.user, amount: event.amount.toString() },
            "Revenue claimed on agent's bonding curve"
          );
        },
      }
    );
    eventUnwatchers.push(unwatch);
  }

  // Watch for new creator deployments
  const unwatchFactory = watchCreatorFactory((event) => {
    logger.info(
      { wallet: event.wallet, token: event.token, name: event.name },
      "New creator deployed"
    );
  });
  eventUnwatchers.push(unwatchFactory);

  // Start HTTP server
  const port = env.PORT;

  logger.info({ port }, "Starting HTTP server");

  // Use Bun.serve for WebSocket support
  const server = Bun.serve({
    port,
    fetch: app.fetch,
    websocket: agentsWebsocket,
  });

  logger.info(
    {
      port: server.port,
      url: `http://localhost:${server.port}`,
    },
    "Server started"
  );

  // Log agent status
  for (const config of agentConfigs) {
    logger.info(
      {
        agentId: config.id,
        name: config.name,
        strategy: config.strategyType,
        evmAddress: config.evmAddress,
        tokenAddress: config.tokenAddress,
      },
      "Agent initialized"
    );
  }

  logger.info("Versus Agent Server is ready");
}

// Run
main().catch((error) => {
  logger.error({ error }, "Failed to start server");
  process.exit(1);
});
