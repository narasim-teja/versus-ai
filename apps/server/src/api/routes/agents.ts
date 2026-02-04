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
import { logger } from "../../utils/logger";

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
