/**
 * Strategy Module
 *
 * Exports strategy classes and factory function for creating strategies.
 */

import type { StrategyType } from "../types";
import type { Strategy } from "./base";
import { BaseStrategy } from "./base";
import { AcademicStrategy } from "./academic";
import { DegenStrategy } from "./degen";

// Strategy singletons (no state, so safe to reuse)
const strategies: Record<StrategyType, Strategy> = {
  academic: new AcademicStrategy(),
  degen: new DegenStrategy(),
};

/**
 * Get a strategy instance by type
 *
 * @param type - Strategy type ("academic" or "degen")
 * @returns Strategy instance
 */
export function getStrategy(type: StrategyType): Strategy {
  const strategy = strategies[type];
  if (!strategy) {
    throw new Error(`Unknown strategy type: ${type}`);
  }
  return strategy;
}

/**
 * Create a new strategy instance (if you need isolated instances)
 *
 * @param type - Strategy type ("academic" or "degen")
 * @returns New strategy instance
 */
export function createStrategy(type: StrategyType): Strategy {
  switch (type) {
    case "academic":
      return new AcademicStrategy();
    case "degen":
      return new DegenStrategy();
    default:
      throw new Error(`Unknown strategy type: ${type}`);
  }
}

/**
 * Get all available strategy types
 */
export function getStrategyTypes(): StrategyType[] {
  return ["academic", "degen"];
}

// Re-export types and classes
export { BaseStrategy, AcademicStrategy, DegenStrategy };
export type { Strategy };
