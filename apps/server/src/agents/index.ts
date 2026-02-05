/**
 * Agents Module
 *
 * Re-exports all agent-related functionality.
 */

// Types
export type {
  StrategyType,
  StrategyConfig,
  AgentConfig,
  AgentState,
  Holding,
  LoanInfo,
  OtherCreator,
  Action,
  ActionType,
  ThinkingStep,
  DecisionResult,
  DecisionLog,
  AgentRuntimeStatus,
} from "./types";

// Configs
export {
  createAliceConfig,
  createBobConfig,
  createAllAgentConfigs,
  getAgentConfig,
  ALICE_STRATEGY,
  BOB_STRATEGY,
} from "./configs";

// Runtime
export {
  readAgentState,
  decide,
  logDecision,
  subscribeToDecisions,
  getRecentDecisions,
  getDecisionHistory,
  getLatestDecision,
  startAgent,
  stopAgent,
  getAgentStatus,
  getAllAgentStatuses,
  forceAgentCycle,
  startAllAgents,
  stopAllAgents,
  isAgentRunning,
} from "./runtime";

// Strategies
export {
  getStrategy,
  createStrategy,
  getStrategyTypes,
  BaseStrategy,
  AcademicStrategy,
  DegenStrategy,
} from "./strategies";
export type { Strategy } from "./strategies";
