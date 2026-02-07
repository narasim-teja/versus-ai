/**
 * LLM-Powered Decision Engine
 *
 * Uses OpenRouter to call an LLM for intelligent decision-making.
 * Falls back to rule-based decide() if OpenRouter is not configured or fails.
 */

import { getAddress, type Address } from "viem";
import { logger } from "../../utils/logger";
import {
  chatCompletion,
  isOpenRouterConfigured,
} from "../../integrations/openrouter/client";
import { getSystemPrompt, formatStateForLLM, getActionInstructions } from "./prompts";
import { decide } from "./decide";
import type {
  AgentConfig,
  AgentState,
  Action,
  ActionType,
  ThinkingStep,
  DecisionResult,
  BuyTokenParams,
  SellTokenParams,
  BorrowParams,
  RepayParams,
  ClaimRevenueParams,
  DepositCollateralParams,
  WithdrawCollateralParams,
} from "../types";

const VALID_ACTION_TYPES: ActionType[] = [
  "BUY_TOKEN",
  "SELL_TOKEN",
  "BORROW",
  "REPAY",
  "CLAIM_REVENUE",
  "DEPOSIT_COLLATERAL",
  "WITHDRAW_COLLATERAL",
];

const VALID_THINKING_CATEGORIES = [
  "health",
  "treasury",
  "lending",
  "revenue",
  "trading",
  "market",
] as const;

/**
 * LLM-powered decision function with automatic fallback
 *
 * Calls OpenRouter to get LLM-based decisions. If the LLM call fails
 * or OpenRouter is not configured, falls back to the rule-based decide() function.
 */
export async function llmDecide(
  state: AgentState,
  config: AgentConfig
): Promise<DecisionResult> {
  if (!isOpenRouterConfigured()) {
    logger.debug({ agentId: config.id }, "OpenRouter not configured, using rule-based decisions");
    return decide(state, config);
  }

  try {
    // Build prompts
    const systemPrompt = getSystemPrompt(config.strategyType);
    const userPrompt =
      formatStateForLLM(state, config) + "\n\n" + getActionInstructions();

    // Call LLM
    const rawResponse = await chatCompletion(systemPrompt, userPrompt);

    // Parse response
    const parsed = parseResponse(rawResponse);

    // Validate actions against current state
    const validatedActions = validateActions(parsed.actions, state, config);

    logger.info(
      {
        agentId: config.id,
        totalActions: parsed.actions.length,
        validActions: validatedActions.length,
        thinkingSteps: parsed.thinking.length,
      },
      "LLM decision complete"
    );

    return {
      actions: validatedActions,
      thinking: parsed.thinking,
      urgent: validatedActions.some((a) => a.priority >= 9),
    };
  } catch (error) {
    logger.warn(
      { agentId: config.id, error: error instanceof Error ? error.message : String(error) },
      "LLM decision failed, falling back to rule-based"
    );
    return decide(state, config);
  }
}

// ============================================
// Response Parsing
// ============================================

interface ParsedResponse {
  actions: Action[];
  thinking: ThinkingStep[];
}

/**
 * Parse the raw LLM response string into structured actions and thinking steps
 */
function parseResponse(raw: string): ParsedResponse {
  // Extract JSON from the response (handle markdown code blocks)
  const jsonStr = extractJson(raw);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    logger.warn({ rawLength: raw.length }, "Failed to parse LLM response as JSON");
    return { actions: [], thinking: [{ category: "market", observation: "LLM response was not valid JSON", conclusion: "Skipping LLM actions this cycle" }] };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { actions: [], thinking: [] };
  }

  const obj = parsed as Record<string, unknown>;

  // Parse thinking steps
  const thinking = parseThinkingSteps(obj.thinking);

  // Parse actions
  const actions = parseActions(obj.actions);

  return { actions, thinking };
}

/**
 * Extract JSON from a response that may contain markdown code blocks
 */
function extractJson(raw: string): string {
  // Try to find JSON in code blocks first
  const codeBlockMatch = raw.match(/```(?:json)?\s*\n?([\s\S]*?)\n?\s*```/);
  if (codeBlockMatch) {
    return codeBlockMatch[1].trim();
  }

  // Try to find a JSON object directly
  const jsonMatch = raw.match(/\{[\s\S]*\}/);
  if (jsonMatch) {
    return jsonMatch[0];
  }

  // Return raw as-is
  return raw.trim();
}

/**
 * Parse and validate thinking steps from LLM response
 */
function parseThinkingSteps(raw: unknown): ThinkingStep[] {
  if (!Array.isArray(raw)) return [];

  const steps: ThinkingStep[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;

    const step = item as Record<string, unknown>;
    const category = String(step.category || "market");
    const observation = String(step.observation || "");
    const conclusion = String(step.conclusion || "");

    if (!observation && !conclusion) continue;

    steps.push({
      category: VALID_THINKING_CATEGORIES.includes(category as any)
        ? (category as ThinkingStep["category"])
        : "market",
      observation,
      conclusion,
      metrics: typeof step.metrics === "object" && step.metrics !== null
        ? step.metrics as Record<string, string | number>
        : undefined,
    });
  }

  return steps;
}

/**
 * Parse raw action objects from LLM response into typed Action[]
 */
function parseActions(raw: unknown): Action[] {
  if (!Array.isArray(raw)) return [];

  const actions: Action[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;

    const actionObj = item as Record<string, unknown>;
    const type = String(actionObj.type || "");

    if (!VALID_ACTION_TYPES.includes(type as ActionType)) {
      logger.warn({ type }, "LLM returned unknown action type, skipping");
      continue;
    }

    const params = actionObj.params;
    if (typeof params !== "object" || params === null) {
      logger.warn({ type }, "LLM action missing params, skipping");
      continue;
    }

    const parsedParams = parseActionParams(
      type as ActionType,
      params as Record<string, unknown>
    );
    if (!parsedParams) continue;

    actions.push({
      type: type as ActionType,
      params: parsedParams,
      reason: String(actionObj.reason || "LLM decision"),
      confidence: Math.max(0, Math.min(1, Number(actionObj.confidence) || 0.5)),
      priority: Math.max(1, Math.min(10, Math.round(Number(actionObj.priority) || 5))),
    });
  }

  return actions;
}

/**
 * Parse and type-check action parameters based on action type
 */
function parseActionParams(
  type: ActionType,
  raw: Record<string, unknown>
): Action["params"] | null {
  try {
    switch (type) {
      case "BUY_TOKEN":
        return {
          tokenAddress: getAddress(String(raw.tokenAddress)),
          bondingCurveAddress: getAddress(String(raw.bondingCurveAddress)),
          tokenName: String(raw.tokenName || "Unknown"),
          usdcAmount: BigInt(String(raw.usdcAmount || "0")),
          minTokensOut: BigInt(String(raw.minTokensOut || "0")),
        } satisfies BuyTokenParams;

      case "SELL_TOKEN":
        return {
          tokenAddress: getAddress(String(raw.tokenAddress)),
          bondingCurveAddress: getAddress(String(raw.bondingCurveAddress)),
          tokenName: String(raw.tokenName || "Unknown"),
          tokenAmount: BigInt(String(raw.tokenAmount || "0")),
          minUsdcOut: BigInt(String(raw.minUsdcOut || "0")),
        } satisfies SellTokenParams;

      case "BORROW":
        return {
          collateralToken: getAddress(String(raw.collateralToken)),
          collateralAmount: BigInt(String(raw.collateralAmount || "0")),
          borrowAmount: BigInt(String(raw.borrowAmount || "0")),
        } satisfies BorrowParams;

      case "REPAY":
        return {
          repayAmount: BigInt(String(raw.repayAmount || "0")),
          withdrawCollateral: Boolean(raw.withdrawCollateral),
        } satisfies RepayParams;

      case "CLAIM_REVENUE":
        return {
          bondingCurveAddress: getAddress(String(raw.bondingCurveAddress)),
        } satisfies ClaimRevenueParams;

      case "DEPOSIT_COLLATERAL":
        return {
          tokenAddress: getAddress(String(raw.tokenAddress)),
          amount: BigInt(String(raw.amount || "0")),
        } satisfies DepositCollateralParams;

      case "WITHDRAW_COLLATERAL":
        return {
          amount: BigInt(String(raw.amount || "0")),
        } satisfies WithdrawCollateralParams;

      default:
        return null;
    }
  } catch (error) {
    logger.warn(
      { type, error: error instanceof Error ? error.message : String(error) },
      "Failed to parse action params"
    );
    return null;
  }
}

// ============================================
// Action Validation
// ============================================

/**
 * Validate LLM-suggested actions against the current agent state.
 * Filters out actions that are impossible or unsafe.
 */
function validateActions(
  actions: Action[],
  state: AgentState,
  config: AgentConfig
): Action[] {
  const validated: Action[] = [];

  for (const action of actions) {
    const reason = getInvalidReason(action, state, config);
    if (reason) {
      logger.warn(
        { type: action.type, reason },
        "LLM action failed validation, skipping"
      );
      continue;
    }
    validated.push(action);
  }

  // Sort by priority (highest first)
  validated.sort((a, b) => b.priority - a.priority);

  return validated;
}

/**
 * Check if an action is invalid. Returns the reason string if invalid, null if valid.
 */
function getInvalidReason(
  action: Action,
  state: AgentState,
  config: AgentConfig
): string | null {
  switch (action.type) {
    case "BUY_TOKEN": {
      const params = action.params as BuyTokenParams;
      if (params.usdcAmount <= 0n) return "Buy amount must be positive";
      if (params.usdcAmount > state.usdcBalance)
        return `Insufficient USDC: need ${params.usdcAmount}, have ${state.usdcBalance}`;
      // Don't allow spending below minimum treasury buffer
      if (state.usdcBalance - params.usdcAmount < config.strategy.minTreasuryBuffer)
        return "Would breach minimum treasury buffer";
      if (!params.tokenAddress || !params.bondingCurveAddress)
        return "Missing token or bonding curve address";
      return null;
    }

    case "SELL_TOKEN": {
      const params = action.params as SellTokenParams;
      if (params.tokenAmount <= 0n) return "Sell amount must be positive";
      const holding = state.holdings.find(
        (h) => h.tokenAddress.toLowerCase() === params.tokenAddress.toLowerCase()
      );
      if (!holding) return `No holding found for token ${params.tokenAddress}`;
      if (params.tokenAmount > holding.balance)
        return `Insufficient tokens: need ${params.tokenAmount}, have ${holding.balance}`;
      return null;
    }

    case "BORROW": {
      const params = action.params as BorrowParams;
      if (params.borrowAmount <= 0n) return "Borrow amount must be positive";
      if (state.loan && state.loan.active && state.loan.currentLTV >= config.strategy.maxLTV)
        return `Already at max LTV (${state.loan.currentLTV}% >= ${config.strategy.maxLTV}%)`;
      return null;
    }

    case "REPAY": {
      const params = action.params as RepayParams;
      if (params.repayAmount <= 0n) return "Repay amount must be positive";
      if (!state.loan || !state.loan.active) return "No active loan to repay";
      if (params.repayAmount > state.usdcBalance)
        return `Insufficient USDC for repayment: need ${params.repayAmount}, have ${state.usdcBalance}`;
      return null;
    }

    case "CLAIM_REVENUE": {
      const params = action.params as ClaimRevenueParams;
      if (!params.bondingCurveAddress) return "Missing bonding curve address";
      return null;
    }

    case "DEPOSIT_COLLATERAL": {
      const params = action.params as DepositCollateralParams;
      if (params.amount <= 0n) return "Deposit amount must be positive";
      return null;
    }

    case "WITHDRAW_COLLATERAL": {
      const params = action.params as WithdrawCollateralParams;
      if (params.amount <= 0n) return "Withdraw amount must be positive";
      if (!state.loan || !state.loan.active)
        return "No active loan with collateral to withdraw";
      return null;
    }

    default:
      return `Unknown action type: ${action.type}`;
  }
}
