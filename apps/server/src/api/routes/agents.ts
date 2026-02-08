/**
 * Agent API Routes
 *
 * REST and WebSocket endpoints for agent management and monitoring.
 */

import { Hono } from "hono";
import { createBunWebSocket } from "hono/bun";
import type { ServerWebSocket } from "bun";
import {
  getAgentStatus,
  getAllAgentStatuses,
  getAgentConfig,
  createAllAgentConfigs,
  getRecentDecisions,
  getDecisionHistory,
  getLatestDecision,
  forceAgentCycle,
  subscribeToDecisions,
} from "../../agents";
import type { DecisionLog } from "../../agents";
import { db } from "../../db/client";
import { videos, yellowSessions } from "../../db/schema";
import { eq, desc, inArray } from "drizzle-orm";
import { logger } from "../../utils/logger";
import { getBondingCurve, getUSDC, getLendingPool, getERC20 } from "../../integrations/chain/contracts";
import { getMarketSentiment } from "../../integrations/stork";
import type { Address } from "viem";

const agents = new Hono();

// WebSocket setup for Bun
const { upgradeWebSocket, websocket } = createBunWebSocket();

// Track active WebSocket connections per agent
const wsConnections = new Map<string, Set<ServerWebSocket>>();

/**
 * Serialize BigInt values in decision logs for JSON response
 */
function serializeDecisionLog(log: DecisionLog): object {
  return JSON.parse(
    JSON.stringify(log, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}

/**
 * GET /api/agents
 *
 * List all agents with their current status
 */
agents.get("/", (c) => {
  const configs = createAllAgentConfigs();
  const statuses = getAllAgentStatuses();

  const result = configs.map((config) => {
    const status = statuses.find((s) => s.agentId === config.id);
    return {
      id: config.id,
      name: config.name,
      strategyType: config.strategyType,
      evmAddress: config.evmAddress,
      tokenAddress: config.tokenAddress,
      bondingCurveAddress: config.bondingCurveAddress,
      status: status || {
        agentId: config.id,
        isRunning: false,
        currentCycle: 0,
        lastDecisionTime: null,
        lastError: null,
        pendingActions: 0,
      },
    };
  });

  return c.json({ agents: result });
});

/**
 * GET /api/agents/:id
 *
 * Get detailed info about a specific agent
 */
agents.get("/:id", async (c) => {
  const agentId = c.req.param("id");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const status = getAgentStatus(agentId);
  const latestDecision = await getLatestDecision(agentId);

  return c.json({
    id: config.id,
    name: config.name,
    strategyType: config.strategyType,
    evmAddress: config.evmAddress,
    tokenAddress: config.tokenAddress,
    bondingCurveAddress: config.bondingCurveAddress,
    strategy: {
      minTreasuryBuffer: config.strategy.minTreasuryBuffer.toString(),
      targetTreasuryBuffer: config.strategy.targetTreasuryBuffer.toString(),
      maxLTV: config.strategy.maxLTV,
      speculationBudget: config.strategy.speculationBudget,
    },
    status: status || {
      agentId: config.id,
      isRunning: false,
      currentCycle: 0,
      lastDecisionTime: null,
      lastError: null,
      pendingActions: 0,
    },
    latestDecision: latestDecision
      ? serializeDecisionLog(latestDecision)
      : null,
  });
});

/**
 * GET /api/agents/:id/state
 *
 * Live on-chain state queried directly from ARC testnet RPC.
 * No cache — always fresh data for dashboard display.
 */
agents.get("/:id/state", async (c) => {
  const agentId = c.req.param("id");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const evmAddress = config.evmAddress as Address;
  const bondingCurve = getBondingCurve(config.bondingCurveAddress as Address);
  const token = getERC20(config.tokenAddress as Address);
  const usdc = getUSDC();

  try {
    // Query all on-chain data in parallel
    const [price, supply, earned, usdcBalance] = await Promise.all([
      bondingCurve.read.getPrice(),
      token.read.totalSupply(),
      bondingCurve.read.earned([evmAddress]),
      usdc.read.balanceOf([evmAddress]),
    ]);

    // Loan info (separate try-catch so it doesn't block the rest)
    let loan = null;
    try {
      const lendingPool = getLendingPool();
      const loanData = await lendingPool.read.loans([evmAddress]);
      const borrowedAmount = loanData[2] as bigint;
      if (borrowedAmount > 0n) {
        const healthFactor = await lendingPool.read.getHealthFactor([evmAddress]);
        const collateralValue = await lendingPool.read.getCollateralValue([evmAddress]);
        const currentLTV = collateralValue > 0n
          ? Number((borrowedAmount * 100n) / (collateralValue as bigint))
          : 0;
        loan = {
          active: true,
          collateralAmount: (loanData[1] as bigint).toString(),
          borrowedAmount: borrowedAmount.toString(),
          healthFactor: Number(healthFactor as bigint) / 1e18,
          currentLTV,
        };
      }
    } catch {
      // No loan or lending pool error — fine
    }

    const status = getAgentStatus(agentId);

    // Fetch market sentiment from Stork (non-blocking)
    let sentiment = null;
    try {
      const sentimentData = await getMarketSentiment();
      if (sentimentData) {
        sentiment = {
          overall: sentimentData.sentiment,
          ethPrice: sentimentData.ethPrice?.priceFloat ?? null,
          btcPrice: sentimentData.btcPrice?.priceFloat ?? null,
          ethChange24h: sentimentData.ethChange24h ?? 0,
          btcChange24h: sentimentData.btcChange24h ?? 0,
        };
      }
    } catch {
      // Stork unavailable — fine, sentiment stays null
    }

    return c.json({
      agentId,
      usdcBalance: (usdcBalance as bigint).toString(),
      ownTokenPrice: (price as bigint).toString(),
      ownTokenSupply: (supply as bigint).toString(),
      ownTokenRevenue: (earned as bigint).toString(),
      loan,
      marketSentiment: sentiment,
      currentCycle: status?.currentCycle ?? 0,
      lastDecisionTime: status?.lastDecisionTime ?? null,
      isRunning: status?.isRunning ?? false,
    });
  } catch (err) {
    logger.error({ agentId, err: (err as Error).message }, "Failed to query on-chain state");
    return c.json({ error: "Failed to query on-chain state" }, 500);
  }
});

/**
 * GET /api/agents/:id/decisions
 *
 * Get decision history for an agent (paginated)
 */
agents.get("/:id/decisions", async (c) => {
  const agentId = c.req.param("id");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "20"), 100);
  const offset = parseInt(c.req.query("offset") || "0");

  const decisions = await getDecisionHistory(agentId, limit, offset);

  return c.json({
    agentId,
    decisions: decisions.map(serializeDecisionLog),
    pagination: {
      limit,
      offset,
      count: decisions.length,
    },
  });
});

/**
 * GET /api/agents/:id/decisions/recent
 *
 * Get recent decisions from in-memory buffer (faster)
 */
agents.get("/:id/decisions/recent", (c) => {
  const agentId = c.req.param("id");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const limit = Math.min(parseInt(c.req.query("limit") || "10"), 50);
  const decisions = getRecentDecisions(agentId, limit);

  return c.json({
    agentId,
    decisions: decisions.map(serializeDecisionLog),
    fromMemory: true,
  });
});

/**
 * POST /api/agents/:id/cycle
 *
 * Force run a decision cycle for an agent
 */
agents.post("/:id/cycle", async (c) => {
  const agentId = c.req.param("id");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const status = getAgentStatus(agentId);
  if (!status?.isRunning) {
    return c.json({ error: "Agent is not running" }, 400);
  }

  logger.info({ agentId }, "Force cycle requested via API");

  const decision = await forceAgentCycle(agentId);

  if (!decision) {
    return c.json({ error: "Cycle failed" }, 500);
  }

  return c.json({
    success: true,
    decision: JSON.parse(
      JSON.stringify(decision, (_, value) =>
        typeof value === "bigint" ? value.toString() : value
      )
    ),
  });
});

/**
 * GET /api/agents/:id/videos
 *
 * Get videos created by this agent
 */
agents.get("/:id/videos", async (c) => {
  const agentId = c.req.param("id");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json({ error: "Agent not found" }, 404);
  }

  const agentVideos = await db
    .select({
      id: videos.id,
      agentId: videos.agentId,
      title: videos.title,
      description: videos.description,
      status: videos.status,
      durationSeconds: videos.durationSeconds,
      totalSegments: videos.totalSegments,
      quality: videos.quality,
      contentUri: videos.contentUri,
      thumbnailUri: videos.thumbnailUri,
      createdAt: videos.createdAt,
      processedAt: videos.processedAt,
    })
    .from(videos)
    .where(eq(videos.agentId, agentId))
    .orderBy(desc(videos.createdAt));

  return c.json({ videos: agentVideos });
});

/**
 * GET /api/agents/:id/earnings
 *
 * Query on-chain earnings from ARC testnet (bonding curve) + DB session stats
 */
agents.get("/:id/earnings", async (c) => {
  const agentId = c.req.param("id");
  const config = getAgentConfig(agentId);

  if (!config) {
    return c.json({ error: "Agent not found" }, 404);
  }

  // Query on-chain earnings from bonding curve on ARC testnet
  let onChainEarnings = "0";
  try {
    const bondingCurve = getBondingCurve(config.bondingCurveAddress as Address);
    const earned = await bondingCurve.read.earned([config.evmAddress as Address]);
    onChainEarnings = (earned as bigint).toString();
  } catch (err) {
    logger.warn({ agentId, err: (err as Error).message }, "Failed to query on-chain earnings");
  }

  // Get session stats from DB
  const agentVideos = await db
    .select({ id: videos.id })
    .from(videos)
    .where(eq(videos.agentId, agentId));

  const videoIds = agentVideos.map((v) => v.id);

  let totalStreamingEarnings = BigInt(0);
  let totalSessions = 0;
  let closedSessions = 0;
  let totalSegmentsDelivered = 0;

  if (videoIds.length > 0) {
    const sessions = await db
      .select({
        creatorBalance: yellowSessions.creatorBalance,
        segmentsDelivered: yellowSessions.segmentsDelivered,
        status: yellowSessions.status,
      })
      .from(yellowSessions)
      .where(inArray(yellowSessions.videoId, videoIds));

    totalSessions = sessions.length;

    for (const s of sessions) {
      if (s.status === "closed" || s.status === "settled") {
        const raw = s.creatorBalance || "0";
        const parsed = Math.round(parseFloat(raw) * 1e6);
        if (!isNaN(parsed)) totalStreamingEarnings += BigInt(parsed);
        closedSessions++;
      }
      totalSegmentsDelivered += s.segmentsDelivered || 0;
    }
  }

  return c.json({
    agentId,
    onChainEarnings,
    totalStreamingEarnings: totalStreamingEarnings.toString(),
    totalSessions,
    closedSessions,
    totalSegmentsDelivered,
  });
});

/**
 * WebSocket /api/agents/:id/ws
 *
 * Real-time decision stream for an agent
 */
agents.get(
  "/:id/ws",
  upgradeWebSocket((c) => {
    const agentId = c.req.param("id");

    return {
      onOpen(event, ws) {
        const config = getAgentConfig(agentId);
        if (!config) {
          ws.send(JSON.stringify({ error: "Agent not found" }));
          ws.close();
          return;
        }

        logger.info({ agentId }, "WebSocket connected");

        // Track this connection
        let connections = wsConnections.get(agentId);
        if (!connections) {
          connections = new Set();
          wsConnections.set(agentId, connections);
        }
        connections.add(ws.raw as ServerWebSocket);

        // Subscribe to decisions
        const unsubscribe = subscribeToDecisions(agentId, (log) => {
          try {
            ws.send(
              JSON.stringify({
                type: "decision",
                data: serializeDecisionLog(log),
              })
            );
          } catch (error) {
            logger.error({ agentId, error }, "Failed to send decision via WebSocket");
          }
        });

        // Store unsubscribe function on the ws object for cleanup
        (ws as any).__unsubscribe = unsubscribe;

        // Send initial status
        const status = getAgentStatus(agentId);
        ws.send(
          JSON.stringify({
            type: "connected",
            agentId,
            status,
          })
        );
      },

      onMessage(event, ws) {
        // Handle ping/pong
        try {
          const data = JSON.parse(event.data.toString());
          if (data.type === "ping") {
            ws.send(JSON.stringify({ type: "pong" }));
          }
        } catch {
          // Ignore invalid messages
        }
      },

      onClose(event, ws) {
        logger.info({ agentId }, "WebSocket disconnected");

        // Unsubscribe from decisions
        const unsubscribe = (ws as any).__unsubscribe;
        if (unsubscribe) {
          unsubscribe();
        }

        // Remove from tracked connections
        const connections = wsConnections.get(agentId);
        if (connections) {
          connections.delete(ws.raw as ServerWebSocket);
        }
      },

      onError(event, ws) {
        logger.error({ agentId, error: event }, "WebSocket error");
      },
    };
  })
);

// Export the WebSocket handler for Bun
export const agentsWebsocket = websocket;

export default agents;
