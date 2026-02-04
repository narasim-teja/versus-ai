/**
 * Decision Engine
 *
 * Pure function that takes agent state and config, returns actions and thinking.
 * No side effects - all state reading happens before, execution happens after.
 *
 * Priority Order:
 * 1. Health Check (P10) - Repay if healthFactor < 1.2
 * 2. Treasury Low (P9) - Borrow or sell if below minBuffer
 * 3. Repay Loan (P6) - If treasury > repayTrigger
 * 4. Claim Revenue (P5) - If earned > 1 USDC
 * 5. Buy Opportunities (P4) - If treasury > target
 * 6. Sell Underperformers (P3) - Stop loss / profit take
 */

import type {
  Action,
  AgentConfig,
  AgentState,
  BuyTokenParams,
  ClaimRevenueParams,
  DecisionResult,
  Holding,
  OtherCreator,
  RepayParams,
  SellTokenParams,
  ThinkingStep,
} from "../types";

// Constants
const USDC_DECIMALS = 6;
const ONE_USDC = BigInt(10 ** USDC_DECIMALS);
const MIN_CLAIM_THRESHOLD = ONE_USDC; // 1 USDC minimum to claim
const HEALTH_FACTOR_CRITICAL = 1.2;
const HEALTH_FACTOR_COMFORTABLE = 1.5;

/**
 * Format bigint as USDC string for logging
 */
function formatUsdc(amount: bigint): string {
  const whole = amount / ONE_USDC;
  const decimal = amount % ONE_USDC;
  return `${whole}.${decimal.toString().padStart(6, "0").slice(0, 2)} USDC`;
}

/**
 * Check loan health and generate repay action if critical
 */
function checkLoanHealth(
  state: AgentState,
  config: AgentConfig,
  thinking: ThinkingStep[],
  actions: Action[]
): boolean {
  if (!state.loan || !state.loan.active) {
    thinking.push({
      category: "health",
      observation: "No active loan",
      conclusion: "No health check needed",
    });
    return false;
  }

  const { healthFactor, borrowedAmount, currentLTV } = state.loan;
  const { maxLTV } = config.strategy;

  thinking.push({
    category: "health",
    observation: `Active loan: ${formatUsdc(borrowedAmount)} borrowed, health factor: ${healthFactor.toFixed(2)}, LTV: ${currentLTV}%`,
    conclusion:
      healthFactor < HEALTH_FACTOR_CRITICAL
        ? "CRITICAL: Health factor too low, must repay"
        : healthFactor < HEALTH_FACTOR_COMFORTABLE
          ? "Warning: Health factor getting low"
          : "Health factor acceptable",
    metrics: {
      healthFactor,
      currentLTV,
      maxLTV,
      borrowedAmount: borrowedAmount.toString(),
    },
  });

  // Critical: Must repay immediately
  if (healthFactor < HEALTH_FACTOR_CRITICAL) {
    // Calculate amount to repay to get back to comfortable level
    // Simplification: repay 30% of borrowed amount
    const repayAmount = (borrowedAmount * BigInt(30)) / BigInt(100);
    const canRepay =
      state.usdcBalance >= repayAmount ? repayAmount : state.usdcBalance;

    if (canRepay > BigInt(0)) {
      actions.push({
        type: "REPAY",
        params: {
          repayAmount: canRepay,
          withdrawCollateral: false,
        } as RepayParams,
        reason: `Critical health factor (${healthFactor.toFixed(2)}), repaying ${formatUsdc(canRepay)}`,
        confidence: 0.95,
        priority: 10,
      });
      return true;
    }
  }

  return false;
}

/**
 * Check treasury level and generate actions if too low
 */
function checkTreasuryLow(
  state: AgentState,
  config: AgentConfig,
  thinking: ThinkingStep[],
  actions: Action[]
): boolean {
  const { usdcBalance } = state;
  const { minTreasuryBuffer, borrowTrigger } = config.strategy;

  if (usdcBalance >= minTreasuryBuffer) {
    thinking.push({
      category: "treasury",
      observation: `Treasury balance: ${formatUsdc(usdcBalance)}`,
      conclusion: `Above minimum buffer (${formatUsdc(minTreasuryBuffer)})`,
      metrics: {
        balance: usdcBalance.toString(),
        minBuffer: minTreasuryBuffer.toString(),
      },
    });
    return false;
  }

  thinking.push({
    category: "treasury",
    observation: `Treasury LOW: ${formatUsdc(usdcBalance)} < minimum ${formatUsdc(minTreasuryBuffer)}`,
    conclusion: "Need to raise funds via selling or borrowing",
    metrics: {
      balance: usdcBalance.toString(),
      minBuffer: minTreasuryBuffer.toString(),
      deficit: (minTreasuryBuffer - usdcBalance).toString(),
    },
  });

  // Option 1: Sell holdings at a loss if necessary
  const profitableHoldings = state.holdings.filter((h) => h.pnlPercent > 0);
  const anyHoldings = state.holdings.filter((h) => h.balance > BigInt(0));

  if (profitableHoldings.length > 0) {
    // Sell most profitable holding first
    const toSell = profitableHoldings.sort(
      (a, b) => b.pnlPercent - a.pnlPercent
    )[0];
    const sellAmount = toSell.balance; // Sell all

    actions.push({
      type: "SELL_TOKEN",
      params: {
        tokenAddress: toSell.tokenAddress,
        bondingCurveAddress: toSell.tokenAddress, // Need to look up
        tokenName: toSell.tokenName,
        tokenAmount: sellAmount,
        minUsdcOut: BigInt(0), // Accept any price in emergency
      } as SellTokenParams,
      reason: `Treasury low, selling ${toSell.tokenName} (${toSell.pnlPercent.toFixed(1)}% profit)`,
      confidence: 0.85,
      priority: 9,
    });
    return true;
  }

  // Option 2: If below borrow trigger and has collateral, consider borrowing
  // This would be implemented in Phase 3 with execution

  return false;
}

/**
 * Check if should repay existing loan
 */
function checkRepayLoan(
  state: AgentState,
  config: AgentConfig,
  thinking: ThinkingStep[],
  actions: Action[]
): boolean {
  if (!state.loan || !state.loan.active) {
    return false;
  }

  const { usdcBalance } = state;
  const { repayTrigger, targetTreasuryBuffer } = config.strategy;
  const { borrowedAmount } = state.loan;

  // Only repay if we have excess treasury
  if (usdcBalance <= repayTrigger) {
    thinking.push({
      category: "lending",
      observation: `Treasury ${formatUsdc(usdcBalance)} below repay trigger ${formatUsdc(repayTrigger)}`,
      conclusion: "Not repaying loan yet",
    });
    return false;
  }

  // Calculate how much to repay while keeping target buffer
  const excessFunds = usdcBalance - targetTreasuryBuffer;
  const repayAmount =
    excessFunds > borrowedAmount ? borrowedAmount : excessFunds;

  if (repayAmount <= BigInt(0)) {
    return false;
  }

  thinking.push({
    category: "lending",
    observation: `Treasury ${formatUsdc(usdcBalance)} > repay trigger ${formatUsdc(repayTrigger)}`,
    conclusion: `Repaying ${formatUsdc(repayAmount)} of ${formatUsdc(borrowedAmount)} loan`,
    metrics: {
      excessFunds: excessFunds.toString(),
      repayAmount: repayAmount.toString(),
      remainingDebt: (borrowedAmount - repayAmount).toString(),
    },
  });

  actions.push({
    type: "REPAY",
    params: {
      repayAmount,
      withdrawCollateral: repayAmount >= borrowedAmount, // Withdraw if fully repaying
    } as RepayParams,
    reason: `Excess treasury, repaying ${formatUsdc(repayAmount)}`,
    confidence: 0.8,
    priority: 6,
  });

  return true;
}

/**
 * Check if should claim revenue
 */
function checkClaimRevenue(
  state: AgentState,
  config: AgentConfig,
  thinking: ThinkingStep[],
  actions: Action[]
): boolean {
  const { ownTokenRevenue } = state;

  if (ownTokenRevenue < MIN_CLAIM_THRESHOLD) {
    thinking.push({
      category: "revenue",
      observation: `Pending revenue: ${formatUsdc(ownTokenRevenue)}`,
      conclusion: `Below claim threshold (${formatUsdc(MIN_CLAIM_THRESHOLD)})`,
    });
    return false;
  }

  thinking.push({
    category: "revenue",
    observation: `Pending revenue: ${formatUsdc(ownTokenRevenue)}`,
    conclusion: "Claiming revenue",
    metrics: {
      pendingRevenue: ownTokenRevenue.toString(),
    },
  });

  actions.push({
    type: "CLAIM_REVENUE",
    params: {
      bondingCurveAddress: config.bondingCurveAddress,
    } as ClaimRevenueParams,
    reason: `Claiming ${formatUsdc(ownTokenRevenue)} in revenue`,
    confidence: 0.9,
    priority: 5,
  });

  return true;
}

/**
 * Evaluate buy opportunities
 */
function evaluateBuyOpportunities(
  state: AgentState,
  config: AgentConfig,
  thinking: ThinkingStep[],
  actions: Action[]
): boolean {
  const { usdcBalance, otherCreators, marketSentiment } = state;
  const { targetTreasuryBuffer, speculationBudget, buySignals } =
    config.strategy;

  // Only buy if we have excess treasury
  if (usdcBalance <= targetTreasuryBuffer) {
    thinking.push({
      category: "trading",
      observation: `Treasury ${formatUsdc(usdcBalance)} <= target ${formatUsdc(targetTreasuryBuffer)}`,
      conclusion: "No excess funds for speculation",
    });
    return false;
  }

  // Calculate speculation budget
  const excessFunds = usdcBalance - targetTreasuryBuffer;
  const maxBuyAmount =
    (excessFunds * BigInt(Math.floor(speculationBudget * 100))) / BigInt(100);

  if (maxBuyAmount < ONE_USDC) {
    thinking.push({
      category: "trading",
      observation: `Speculation budget: ${formatUsdc(maxBuyAmount)}`,
      conclusion: "Budget too small for meaningful trades",
    });
    return false;
  }

  // Evaluate market sentiment
  const sentimentMultiplier =
    marketSentiment?.sentiment === "bullish"
      ? 1.2
      : marketSentiment?.sentiment === "bearish"
        ? 0.7
        : 1.0;

  thinking.push({
    category: "market",
    observation: `Market sentiment: ${marketSentiment?.sentiment || "unknown"}`,
    conclusion: `Applying ${sentimentMultiplier}x multiplier to buy signals`,
    metrics: {
      ethChange24h: marketSentiment?.ethChange24h || 0,
      btcChange24h: marketSentiment?.btcChange24h || 0,
    },
  });

  // Evaluate each creator for buying
  const buyOpportunities: Array<{ creator: OtherCreator; score: number }> = [];

  for (const creator of otherCreators) {
    // Skip if no revenue (probably inactive)
    if (creator.pendingRevenue === BigInt(0) && creator.totalSupply === BigInt(0)) {
      continue;
    }

    // Simple scoring based on pending revenue (indicates activity)
    const revenueScore =
      Number(creator.pendingRevenue) / Number(ONE_USDC) / 100; // Normalize

    // Apply sentiment multiplier
    const finalScore = revenueScore * sentimentMultiplier;

    if (finalScore > buySignals.revenueGrowth) {
      buyOpportunities.push({ creator, score: finalScore });
    }
  }

  if (buyOpportunities.length === 0) {
    thinking.push({
      category: "trading",
      observation: `Evaluated ${otherCreators.length} tokens`,
      conclusion: "No buy opportunities meeting criteria",
    });
    return false;
  }

  // Sort by score and pick best opportunity
  buyOpportunities.sort((a, b) => b.score - a.score);
  const bestOpportunity = buyOpportunities[0];

  // Calculate buy amount (split budget if multiple opportunities)
  const buyAmount =
    buyOpportunities.length > 1
      ? maxBuyAmount / BigInt(2) // Split if multiple
      : maxBuyAmount;

  thinking.push({
    category: "trading",
    observation: `Found ${buyOpportunities.length} buy opportunities`,
    conclusion: `Best: creator ${bestOpportunity.creator.creatorAddress.slice(0, 10)}... (score: ${bestOpportunity.score.toFixed(3)})`,
    metrics: {
      opportunities: buyOpportunities.length,
      buyAmount: buyAmount.toString(),
      bestScore: bestOpportunity.score,
    },
  });

  actions.push({
    type: "BUY_TOKEN",
    params: {
      tokenAddress: bestOpportunity.creator.tokenAddress,
      bondingCurveAddress: bestOpportunity.creator.bondingCurveAddress,
      tokenName: `Token-${bestOpportunity.creator.tokenAddress.slice(0, 8)}`,
      usdcAmount: buyAmount,
      minTokensOut: BigInt(0), // Will be calculated in execution
    } as BuyTokenParams,
    reason: `Buy opportunity: score ${bestOpportunity.score.toFixed(3)}, investing ${formatUsdc(buyAmount)}`,
    confidence: Math.min(0.7 + bestOpportunity.score, 0.9),
    priority: 4,
  });

  return true;
}

/**
 * Evaluate sell opportunities (stop loss / profit take)
 */
function evaluateSellOpportunities(
  state: AgentState,
  config: AgentConfig,
  thinking: ThinkingStep[],
  actions: Action[]
): boolean {
  const { holdings } = state;
  const { sellSignals } = config.strategy;

  if (holdings.length === 0) {
    thinking.push({
      category: "trading",
      observation: "No holdings to evaluate",
      conclusion: "No sell actions needed",
    });
    return false;
  }

  let soldAny = false;

  for (const holding of holdings) {
    const { pnlPercent, tokenName, balance, tokenAddress } = holding;

    // Skip if no balance
    if (balance === BigInt(0)) {
      continue;
    }

    // Check stop loss
    if (pnlPercent < -sellSignals.priceDrop * 100) {
      thinking.push({
        category: "trading",
        observation: `${tokenName}: ${pnlPercent.toFixed(1)}% loss`,
        conclusion: `Stop loss triggered (threshold: -${(sellSignals.priceDrop * 100).toFixed(0)}%)`,
        metrics: {
          pnlPercent,
          threshold: -sellSignals.priceDrop * 100,
        },
      });

      actions.push({
        type: "SELL_TOKEN",
        params: {
          tokenAddress,
          bondingCurveAddress: tokenAddress, // Need lookup in execution
          tokenName,
          tokenAmount: balance,
          minUsdcOut: BigInt(0),
        } as SellTokenParams,
        reason: `Stop loss: ${tokenName} at ${pnlPercent.toFixed(1)}% loss`,
        confidence: 0.85,
        priority: 3,
      });
      soldAny = true;
      continue;
    }

    // Check profit take
    if (pnlPercent > sellSignals.profitTake * 100) {
      thinking.push({
        category: "trading",
        observation: `${tokenName}: +${pnlPercent.toFixed(1)}% profit`,
        conclusion: `Profit take triggered (threshold: +${(sellSignals.profitTake * 100).toFixed(0)}%)`,
        metrics: {
          pnlPercent,
          threshold: sellSignals.profitTake * 100,
        },
      });

      // Sell half to lock in profits
      const sellAmount = balance / BigInt(2);

      actions.push({
        type: "SELL_TOKEN",
        params: {
          tokenAddress,
          bondingCurveAddress: tokenAddress, // Need lookup in execution
          tokenName,
          tokenAmount: sellAmount,
          minUsdcOut: BigInt(0),
        } as SellTokenParams,
        reason: `Profit take: ${tokenName} at +${pnlPercent.toFixed(1)}%, selling 50%`,
        confidence: 0.8,
        priority: 3,
      });
      soldAny = true;
    }
  }

  if (!soldAny) {
    thinking.push({
      category: "trading",
      observation: `Evaluated ${holdings.length} holdings`,
      conclusion: "No sell signals triggered",
      metrics: {
        holdings: holdings.length,
        stopLossThreshold: -sellSignals.priceDrop * 100,
        profitTakeThreshold: sellSignals.profitTake * 100,
      },
    });
  }

  return soldAny;
}

/**
 * Main decision function
 *
 * Pure function: state + config -> actions + thinking
 */
export function decide(
  state: AgentState,
  config: AgentConfig
): DecisionResult {
  const thinking: ThinkingStep[] = [];
  const actions: Action[] = [];
  let urgent = false;

  // Priority 10: Health check
  if (checkLoanHealth(state, config, thinking, actions)) {
    urgent = true;
  }

  // Priority 9: Treasury low
  if (checkTreasuryLow(state, config, thinking, actions)) {
    urgent = true;
  }

  // Priority 6: Repay loan if excess funds
  checkRepayLoan(state, config, thinking, actions);

  // Priority 5: Claim revenue
  checkClaimRevenue(state, config, thinking, actions);

  // Priority 4: Buy opportunities
  evaluateBuyOpportunities(state, config, thinking, actions);

  // Priority 3: Sell underperformers
  evaluateSellOpportunities(state, config, thinking, actions);

  // Sort actions by priority (highest first)
  actions.sort((a, b) => b.priority - a.priority);

  return {
    actions,
    thinking,
    urgent,
  };
}
