/**
 * Agent Loop
 *
 * Main runtime loop that orchestrates agent cycles:
 * 1. Read state
 * 2. Make decisions
 * 3. Log decisions
 * 4. (Phase 3: Execute actions)
 *
 * Runs both Alice and Bob in the same process.
 */

import { logger } from "../../utils/logger";
import type { AgentConfig, AgentRuntimeStatus, DecisionResult } from "../types";
import { readAgentState, resetCycleCounter } from "./state";
import { decide } from "./decide";
import { llmDecide } from "./llm-decide";
import { logDecision, logExecutionResults } from "./logger";
import { executeActions } from "./execute";

// Default cycle interval: 30 seconds
const DEFAULT_CYCLE_INTERVAL_MS = 30_000;

// Agent runtime instances
const agentRuntimes = new Map<string, AgentRuntime>();

/**
 * Agent Runtime Class
 *
 * Manages the lifecycle of a single agent's decision loop.
 */
class AgentRuntime {
  private config: AgentConfig;
  private isRunning: boolean = false;
  private isCycleRunning: boolean = false;
  private currentCycle: number = 0;
  private lastDecisionTime: Date | null = null;
  private lastError: string | null = null;
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private cycleIntervalMs: number;
  private pendingActions: number = 0;
  private recentTxHashes: string[] = [];

  constructor(config: AgentConfig, cycleIntervalMs?: number) {
    this.config = config;
    this.cycleIntervalMs = cycleIntervalMs || DEFAULT_CYCLE_INTERVAL_MS;
  }

  /**
   * Start the agent loop
   */
  start(): void {
    if (this.isRunning) {
      logger.warn({ agentId: this.config.id }, "Agent already running");
      return;
    }

    this.isRunning = true;
    logger.info(
      {
        agentId: this.config.id,
        cycleIntervalMs: this.cycleIntervalMs,
      },
      "Starting agent loop"
    );

    // Run first cycle immediately
    this.runCycle().catch((error) => {
      logger.error({ agentId: this.config.id, error }, "First cycle failed");
    });

    // Schedule subsequent cycles
    this.intervalId = setInterval(() => {
      this.runCycle().catch((error) => {
        logger.error({ agentId: this.config.id, error }, "Cycle failed");
      });
    }, this.cycleIntervalMs);
  }

  /**
   * Stop the agent loop
   */
  stop(): void {
    if (!this.isRunning) {
      logger.warn({ agentId: this.config.id }, "Agent not running");
      return;
    }

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.isRunning = false;
    logger.info({ agentId: this.config.id }, "Agent loop stopped");
  }

  /**
   * Run a single decision cycle
   */
  async runCycle(): Promise<DecisionResult | null> {
    // Guard against overlapping cycles (e.g., if Circle confirmation takes >30s)
    if (this.isCycleRunning) {
      logger.warn(
        { agentId: this.config.id, cycle: this.currentCycle },
        "Skipping cycle - previous cycle still running"
      );
      return null;
    }

    this.isCycleRunning = true;
    const cycleStart = Date.now();
    this.currentCycle++;

    logger.info(
      { agentId: this.config.id, cycle: this.currentCycle },
      "Starting decision cycle"
    );

    try {
      // Step 1: Read state (pass recent tx hashes from last cycle)
      const state = await readAgentState(this.config, this.recentTxHashes);

      // Step 2: Make decisions (LLM-powered with rule-based fallback)
      const decision = await llmDecide(state, this.config);

      // Step 3: Log decision
      const decisionLog = await logDecision(
        this.config,
        state,
        decision.thinking,
        decision.actions
      );

      // Step 4: Execute actions (if any)
      if (decision.actions.length > 0) {
        logger.info(
          {
            agentId: this.config.id,
            actionsCount: decision.actions.length,
            actions: decision.actions.map((a) => ({
              type: a.type,
              reason: a.reason,
              priority: a.priority,
            })),
          },
          "Executing actions"
        );

        const executionResults = await executeActions(
          decision.actions,
          this.config
        );

        // Step 5: Log execution results
        await logExecutionResults(decisionLog.id, executionResults);

        // Track recent tx hashes for next cycle's state
        this.recentTxHashes = executionResults
          .filter((r) => r.txHash)
          .map((r) => r.txHash!);

        // Update pending actions count
        this.pendingActions = executionResults.filter(
          (r) => !r.success && !r.error
        ).length;

        const successCount = executionResults.filter((r) => r.success).length;
        const failCount = executionResults.length - successCount;

        logger.info(
          {
            agentId: this.config.id,
            totalActions: executionResults.length,
            successCount,
            failCount,
          },
          "Actions execution complete"
        );
      }

      // Update status
      this.lastDecisionTime = new Date();
      this.lastError = null;

      const cycleDuration = Date.now() - cycleStart;
      logger.info(
        {
          agentId: this.config.id,
          cycle: this.currentCycle,
          actionsCount: decision.actions.length,
          urgent: decision.urgent,
          durationMs: cycleDuration,
        },
        "Decision cycle complete"
      );

      return decision;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.lastError = errorMessage;

      logger.error(
        {
          agentId: this.config.id,
          cycle: this.currentCycle,
          error: errorMessage,
        },
        "Decision cycle error"
      );

      return null;
    } finally {
      this.isCycleRunning = false;
    }
  }

  /**
   * Force run a cycle (for testing or manual triggers)
   */
  async forceCycle(): Promise<DecisionResult | null> {
    return this.runCycle();
  }

  /**
   * Get current runtime status
   */
  getStatus(): AgentRuntimeStatus {
    return {
      agentId: this.config.id,
      isRunning: this.isRunning,
      currentCycle: this.currentCycle,
      lastDecisionTime: this.lastDecisionTime,
      lastError: this.lastError,
      pendingActions: this.pendingActions,
    };
  }

  /**
   * Get agent config
   */
  getConfig(): AgentConfig {
    return this.config;
  }
}

/**
 * Start an agent runtime
 */
export function startAgent(
  config: AgentConfig,
  cycleIntervalMs?: number
): AgentRuntime {
  // Check if already running
  const existing = agentRuntimes.get(config.id);
  if (existing) {
    logger.warn({ agentId: config.id }, "Agent runtime already exists");
    return existing;
  }

  // Create and start new runtime
  const runtime = new AgentRuntime(config, cycleIntervalMs);
  agentRuntimes.set(config.id, runtime);
  runtime.start();

  return runtime;
}

/**
 * Stop an agent runtime
 */
export function stopAgent(agentId: string): boolean {
  const runtime = agentRuntimes.get(agentId);
  if (!runtime) {
    logger.warn({ agentId }, "Agent runtime not found");
    return false;
  }

  runtime.stop();
  agentRuntimes.delete(agentId);
  return true;
}

/**
 * Get agent runtime status
 */
export function getAgentStatus(agentId: string): AgentRuntimeStatus | null {
  const runtime = agentRuntimes.get(agentId);
  return runtime ? runtime.getStatus() : null;
}

/**
 * Get all agent statuses
 */
export function getAllAgentStatuses(): AgentRuntimeStatus[] {
  return Array.from(agentRuntimes.values()).map((r) => r.getStatus());
}

/**
 * Force run a cycle for an agent
 */
export async function forceAgentCycle(
  agentId: string
): Promise<DecisionResult | null> {
  const runtime = agentRuntimes.get(agentId);
  if (!runtime) {
    logger.warn({ agentId }, "Agent runtime not found for force cycle");
    return null;
  }

  return runtime.forceCycle();
}

/**
 * Start all agents
 */
export function startAllAgents(
  configs: AgentConfig[],
  cycleIntervalMs?: number
): void {
  logger.info({ count: configs.length }, "Starting all agents");

  for (const config of configs) {
    startAgent(config, cycleIntervalMs);
  }
}

/**
 * Stop all agents
 */
export function stopAllAgents(): void {
  logger.info({ count: agentRuntimes.size }, "Stopping all agents");

  for (const [agentId] of agentRuntimes) {
    stopAgent(agentId);
  }
}

/**
 * Check if an agent is running
 */
export function isAgentRunning(agentId: string): boolean {
  const runtime = agentRuntimes.get(agentId);
  return runtime ? runtime.getStatus().isRunning : false;
}

/**
 * Get agent runtime instance
 */
export function getAgentRuntime(agentId: string): AgentRuntime | undefined {
  return agentRuntimes.get(agentId);
}
