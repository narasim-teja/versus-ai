/**
 * Decision Logger
 *
 * Persists decision logs to the database and maintains an in-memory
 * buffer of recent decisions for real-time streaming.
 */

import { eq, desc, and } from "drizzle-orm";
import { db } from "../../db/client";
import { decisionLogs } from "../../db/schema";
import { logger } from "../../utils/logger";
import type {
  Action,
  AgentConfig,
  AgentState,
  DecisionLog,
  ThinkingStep,
} from "../types";
import type { ExecutionResult } from "./execute";

// In-memory buffer for recent decisions (for WebSocket streaming)
const RECENT_DECISIONS_BUFFER_SIZE = 50;
const recentDecisions = new Map<string, DecisionLog[]>();

// Event emitter for real-time updates
type DecisionListener = (log: DecisionLog) => void;
const listeners = new Map<string, Set<DecisionListener>>();

/**
 * Serialize bigint values in state for JSON storage
 */
function serializeState(state: AgentState): string {
  return JSON.stringify(state, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

/**
 * Serialize actions for JSON storage
 */
function serializeActions(actions: Action[]): string {
  return JSON.stringify(actions, (_, value) =>
    typeof value === "bigint" ? value.toString() : value
  );
}

/**
 * Log a decision to the database and in-memory buffer
 */
export async function logDecision(
  config: AgentConfig,
  state: AgentState,
  thinking: ThinkingStep[],
  actions: Action[]
): Promise<DecisionLog> {
  const now = Date.now();

  // Insert into database
  const inserted = await db
    .insert(decisionLogs)
    .values({
      agentId: config.id,
      cycle: state.cycle,
      timestamp: state.timestamp,
      stateSnapshot: serializeState(state),
      thinking: JSON.stringify(thinking),
      actions: serializeActions(actions),
      createdAt: now,
    })
    .returning();

  const dbRecord = inserted[0];

  // Create DecisionLog object
  const log: DecisionLog = {
    id: dbRecord.id,
    agentId: config.id,
    cycle: state.cycle,
    timestamp: state.timestamp,
    stateSnapshot: state,
    thinking,
    actions,
    createdAt: new Date(now),
  };

  // Add to in-memory buffer
  addToRecentBuffer(config.id, log);

  // Notify listeners
  notifyListeners(config.id, log);

  logger.info(
    {
      agentId: config.id,
      cycle: state.cycle,
      actionsCount: actions.length,
      thinkingSteps: thinking.length,
    },
    "Decision logged"
  );

  return log;
}

/**
 * Add decision to recent buffer
 */
function addToRecentBuffer(agentId: string, log: DecisionLog): void {
  let buffer = recentDecisions.get(agentId);
  if (!buffer) {
    buffer = [];
    recentDecisions.set(agentId, buffer);
  }

  buffer.unshift(log);

  // Trim buffer if too large
  if (buffer.length > RECENT_DECISIONS_BUFFER_SIZE) {
    buffer.pop();
  }
}

/**
 * Notify registered listeners of new decision
 */
function notifyListeners(agentId: string, log: DecisionLog): void {
  const agentListeners = listeners.get(agentId);
  if (agentListeners) {
    for (const listener of agentListeners) {
      try {
        listener(log);
      } catch (error) {
        logger.error({ agentId, error }, "Decision listener error");
      }
    }
  }
}

/**
 * Subscribe to real-time decision updates for an agent
 */
export function subscribeToDecisions(
  agentId: string,
  listener: DecisionListener
): () => void {
  let agentListeners = listeners.get(agentId);
  if (!agentListeners) {
    agentListeners = new Set();
    listeners.set(agentId, agentListeners);
  }

  agentListeners.add(listener);
  logger.debug({ agentId }, "Decision listener subscribed");

  // Return unsubscribe function
  return () => {
    agentListeners?.delete(listener);
    logger.debug({ agentId }, "Decision listener unsubscribed");
  };
}

/**
 * Get recent decisions from in-memory buffer
 */
export function getRecentDecisions(
  agentId: string,
  limit: number = 10
): DecisionLog[] {
  const buffer = recentDecisions.get(agentId);
  if (!buffer) {
    return [];
  }
  return buffer.slice(0, limit);
}

/**
 * Get decision history from database
 */
export async function getDecisionHistory(
  agentId: string,
  limit: number = 50,
  offset: number = 0
): Promise<DecisionLog[]> {
  const records = await db.query.decisionLogs.findMany({
    where: eq(decisionLogs.agentId, agentId),
    orderBy: [desc(decisionLogs.timestamp)],
    limit,
    offset,
  });

  return records.map((r) => ({
    id: r.id,
    agentId: r.agentId,
    cycle: r.cycle,
    timestamp: r.timestamp,
    stateSnapshot: JSON.parse(r.stateSnapshot) as AgentState,
    thinking: JSON.parse(r.thinking) as ThinkingStep[],
    actions: JSON.parse(r.actions) as Action[],
    createdAt: new Date(r.createdAt!),
  }));
}

/**
 * Get latest decision for an agent
 */
export async function getLatestDecision(
  agentId: string
): Promise<DecisionLog | null> {
  // Try in-memory first
  const recent = recentDecisions.get(agentId);
  if (recent && recent.length > 0) {
    return recent[0];
  }

  // Fall back to database
  const records = await db.query.decisionLogs.findMany({
    where: eq(decisionLogs.agentId, agentId),
    orderBy: [desc(decisionLogs.timestamp)],
    limit: 1,
  });

  if (records.length === 0) {
    return null;
  }

  const r = records[0];
  return {
    id: r.id,
    agentId: r.agentId,
    cycle: r.cycle,
    timestamp: r.timestamp,
    stateSnapshot: JSON.parse(r.stateSnapshot) as AgentState,
    thinking: JSON.parse(r.thinking) as ThinkingStep[],
    actions: JSON.parse(r.actions) as Action[],
    createdAt: new Date(r.createdAt!),
  };
}

/**
 * Get decision count for an agent
 */
export async function getDecisionCount(agentId: string): Promise<number> {
  const result = await db
    .select({ count: decisionLogs.id })
    .from(decisionLogs)
    .where(eq(decisionLogs.agentId, agentId));

  // Count manually since SQLite doesn't have count() aggregate in this context
  const allRecords = await db.query.decisionLogs.findMany({
    where: eq(decisionLogs.agentId, agentId),
    columns: { id: true },
  });

  return allRecords.length;
}

/**
 * Clear in-memory buffer (useful for testing)
 */
export function clearRecentBuffer(agentId?: string): void {
  if (agentId) {
    recentDecisions.delete(agentId);
  } else {
    recentDecisions.clear();
  }
}

/**
 * Serialize execution results for JSON storage
 */
function serializeExecutionResults(results: ExecutionResult[]): string {
  return JSON.stringify(
    results.map((r) => ({
      actionType: r.action.type,
      actionReason: r.action.reason,
      success: r.success,
      transactionId: r.transactionId,
      txHash: r.txHash,
      error: r.error,
      approvalTxHash: r.approvalTxHash,
    }))
  );
}

/**
 * Update a decision log with execution results
 */
export async function logExecutionResults(
  logId: number,
  results: ExecutionResult[]
): Promise<void> {
  const serialized = serializeExecutionResults(results);

  await db
    .update(decisionLogs)
    .set({ executionResults: serialized })
    .where(eq(decisionLogs.id, logId));

  // Update in-memory buffer
  for (const [agentId, buffer] of recentDecisions) {
    const logIndex = buffer.findIndex((log) => log.id === logId);
    if (logIndex !== -1) {
      // Add execution results to the log object
      (buffer[logIndex] as any).executionResults = results.map((r) => ({
        actionType: r.action.type,
        success: r.success,
        txHash: r.txHash,
        error: r.error,
      }));
      break;
    }
  }

  const successCount = results.filter((r) => r.success).length;
  const failCount = results.length - successCount;

  logger.info(
    {
      logId,
      totalActions: results.length,
      successCount,
      failCount,
    },
    "Execution results logged"
  );
}
