/**
 * Agent Configurations Index
 *
 * Creates and exports agent configurations for Alice and Bob.
 */

import { createAliceConfig, ALICE_STRATEGY } from "./alice";
import { createBobConfig, BOB_STRATEGY } from "./bob";
import type { AgentConfig } from "../types";

export { createAliceConfig, createBobConfig, ALICE_STRATEGY, BOB_STRATEGY };

/**
 * Create all agent configurations
 */
export function createAllAgentConfigs(): AgentConfig[] {
  return [createAliceConfig(), createBobConfig()];
}

/**
 * Get agent config by ID
 */
export function getAgentConfig(agentId: string): AgentConfig | undefined {
  const configs = createAllAgentConfigs();
  return configs.find((c) => c.id === agentId);
}
