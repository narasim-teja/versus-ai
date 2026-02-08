/**
 * LLM Prompts for Agent Decision Making
 *
 * Provides strategy-specific system prompts and state formatting
 * for the OpenRouter-powered decision engine.
 */

import type { AgentConfig, AgentState, StrategyType } from "../types";

// ============================================
// System Prompts (Agent Personality)
// ============================================

const ACADEMIC_SYSTEM_PROMPT = `You are Alice, a conservative AI financial agent managing a treasury on the Versus platform.

## Your Personality
- Academic and analytical: you reason carefully before acting
- Risk-averse: you prioritize capital preservation over aggressive gains
- Patient but opportunistic: you take calculated positions when you have excess capital
- Methodical: you explain your reasoning clearly

## Your Strategy Parameters
- Minimum treasury buffer: 2 USDC (never go below this)
- Target treasury: 5 USDC (buy only when above this)
- Maximum LTV: 50% (very cautious with leverage)
- Speculation budget: 50% of excess treasury
- Stop loss: -10% (cut losses early)
- Profit take: +25% (take gains at moderate profit)

## Buy Signals (any ONE is enough)
- Revenue growth ≥ 2% on a token
- Token price near floor with supply growing (accumulation zone)
- You have excess treasury above target AND no current position in a token (diversification)
- Market sentiment is bullish AND you have excess capital
- You want to build a small research position (1-3 USDC) in any available token to monitor it

## Your Decision Priorities (highest to lowest)
1. Avoid liquidation (repay if health factor < 1.2)
2. Maintain treasury buffer (sell holdings if below minimum)
3. Repay loans when treasury is flush
4. Claim pending revenue
5. Buy promising tokens (only with excess treasury)
6. Sell underperformers (stop loss / profit take)`;

const DEGEN_SYSTEM_PROMPT = `You are Bob, an aggressive AI financial agent managing a treasury on the Versus platform.

## Your Personality
- Degen and momentum-driven: you act fast on opportunities
- High risk tolerance: you're comfortable with leverage and volatility
- FOMO-driven: you don't want to miss the next big move
- Bold: you make strong bets with conviction
- ALWAYS looking for a trade: idle capital is wasted capital

## Your Strategy Parameters
- Minimum treasury buffer: 1 USDC (keep it lean)
- Target treasury: 3 USDC (deploy capital aggressively)
- Maximum LTV: 65% (willing to use leverage)
- Speculation budget: 80% of excess treasury
- Stop loss: -20% (hold through volatility)
- Profit take: +15% (take profits earlier, rotate into new plays)

## Buy Signals (any ONE is enough to buy)
- Revenue growth ≥ 1% on a token
- Token is near floor price — early accumulation opportunity before others notice
- You have excess treasury above 3 USDC and capital is sitting idle (deploy it!)
- Market sentiment is bullish or neutral with strong ETH/BTC prices
- You don't hold a position in an available token yet (FOMO — get in before it moves)
- You want to increase an existing position that hasn't hit stop loss

## Sell Signals
- Position down ≥ 20% (stop loss)
- Position up ≥ 15% (take profit, rotate)
- Need capital for a better opportunity

## Your Decision Priorities (highest to lowest)
1. Avoid liquidation (repay if health factor < 1.2)
2. Maintain treasury buffer (sell holdings if below minimum)
3. Deploy excess capital into tokens (ALWAYS be invested)
4. Claim pending revenue
5. Sell underperformers (wider stop loss, earlier profit take)
6. Rotate: sell winners, buy new positions`;

/**
 * Get the system prompt for a given strategy type
 */
export function getSystemPrompt(strategyType: StrategyType): string {
  return strategyType === "academic"
    ? ACADEMIC_SYSTEM_PROMPT
    : DEGEN_SYSTEM_PROMPT;
}

// ============================================
// State Formatting
// ============================================

/**
 * Format USDC amounts from 6-decimal bigint to human-readable string
 */
function formatUsdc(amount: bigint): string {
  const whole = amount / BigInt(1e6);
  const fraction = Number(amount % BigInt(1e6)) / 1e6;
  return `${Number(whole) + fraction} USDC`;
}

/**
 * Format token amounts from 18-decimal bigint to human-readable string
 */
function formatTokens(amount: bigint, decimals: number = 18): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = Number(amount % divisor) / Number(divisor);
  return `${(Number(whole) + fraction).toFixed(4)}`;
}

/**
 * Format the full agent state into a structured prompt for the LLM
 */
export function formatStateForLLM(
  state: AgentState,
  config: AgentConfig
): string {
  const sections: string[] = [];

  // Header
  sections.push(`# Current State for ${config.name} (Cycle ${state.cycle})`);
  sections.push(`Timestamp: ${new Date(state.timestamp).toISOString()}`);

  // Treasury
  sections.push(`\n## Treasury`);
  sections.push(`- USDC Balance: ${formatUsdc(state.usdcBalance)}`);
  sections.push(`- Min Buffer: ${formatUsdc(config.strategy.minTreasuryBuffer)}`);
  sections.push(`- Target Buffer: ${formatUsdc(config.strategy.targetTreasuryBuffer)}`);

  // Own Token
  sections.push(`\n## Your Token`);
  sections.push(`- Token Address: ${config.tokenAddress}`);
  sections.push(`- Current Price: ${formatUsdc(state.ownTokenPrice)}`);
  sections.push(`- Total Supply: ${formatTokens(state.ownTokenSupply)}`);
  sections.push(`- Pending Revenue: ${formatUsdc(state.ownTokenRevenue)}`);

  // Holdings
  sections.push(`\n## Portfolio Holdings (${state.holdings.length} positions)`);
  if (state.holdings.length === 0) {
    sections.push("- No holdings");
  } else {
    for (const h of state.holdings) {
      sections.push(
        `- ${h.tokenName}: ${formatTokens(h.balance, h.tokenDecimals)} tokens @ ${formatUsdc(h.currentPrice)} | ` +
          `Cost: ${formatUsdc(h.totalCostBasis)} | P&L: ${h.pnlPercent >= 0 ? "+" : ""}${h.pnlPercent.toFixed(1)}% (${formatUsdc(h.unrealizedPnl)})`
      );
    }
  }

  // Loan
  sections.push(`\n## Lending Position`);
  if (state.loan && state.loan.active) {
    sections.push(`- Collateral: ${formatTokens(state.loan.collateralAmount)} tokens of ${state.loan.collateralToken}`);
    sections.push(`- Borrowed: ${formatUsdc(state.loan.borrowedAmount)}`);
    sections.push(`- Health Factor: ${state.loan.healthFactor.toFixed(2)} (>1.0 = safe, <1.0 = liquidatable)`);
    sections.push(`- Current LTV: ${state.loan.currentLTV.toFixed(1)}%`);
  } else {
    sections.push("- No active loan");
  }

  // Market Sentiment
  sections.push(`\n## Market Sentiment`);
  if (state.marketSentiment) {
    sections.push(`- ETH Price: $${state.marketSentiment.ethPrice?.priceFloat?.toFixed(2) || "N/A"}`);
    sections.push(`- BTC Price: $${state.marketSentiment.btcPrice?.priceFloat?.toFixed(2) || "N/A"}`);
    sections.push(`- Overall Sentiment: ${state.marketSentiment.sentiment || "neutral"}`);
  } else {
    sections.push("- Market data unavailable");
  }

  // Other Creators (trading opportunities)
  sections.push(`\n## Trading Opportunities (${state.otherCreators.length} other creators)`);
  if (state.otherCreators.length === 0) {
    sections.push("- No other creators available");
  } else {
    for (const c of state.otherCreators) {
      sections.push(
        `- Creator: ${c.creatorAddress}\n` +
          `  tokenAddress: ${c.tokenAddress}\n` +
          `  bondingCurveAddress: ${c.bondingCurveAddress}\n` +
          `  Price: ${formatUsdc(c.currentPrice)} | Supply: ${formatTokens(c.totalSupply)} | Revenue: ${formatUsdc(c.pendingRevenue)}`
      );
    }
  }

  return sections.join("\n");
}

// ============================================
// Action Instructions
// ============================================

/**
 * Get instructions for the LLM on how to format its response
 */
export function getActionInstructions(): string {
  return `## Instructions

Analyze the state above and decide what actions to take. Respond with a JSON object containing:
1. \`thinking\` - Your analysis steps (array of objects)
2. \`actions\` - Actions to execute (array of objects, can be empty)

### Available Action Types

| Type | Required Params | Description |
|------|----------------|-------------|
| BUY_TOKEN | tokenAddress, bondingCurveAddress, tokenName, usdcAmount, minTokensOut | Buy creator tokens with USDC |
| SELL_TOKEN | tokenAddress, bondingCurveAddress, tokenName, tokenAmount, minUsdcOut | Sell creator tokens for USDC |
| BORROW | collateralToken, collateralAmount, borrowAmount | Borrow USDC against token collateral |
| REPAY | repayAmount, withdrawCollateral | Repay outstanding loan |
| CLAIM_REVENUE | bondingCurveAddress | Claim pending revenue from bonding curve |
| DEPOSIT_COLLATERAL | tokenAddress, amount | Deposit additional collateral |
| WITHDRAW_COLLATERAL | amount | Withdraw excess collateral |

### Response Format

Respond ONLY with valid JSON (no markdown, no explanation outside the JSON):

\`\`\`json
{
  "thinking": [
    {
      "category": "treasury|health|lending|revenue|trading|market",
      "observation": "What you observed about the current state",
      "conclusion": "What you decided to do and why"
    }
  ],
  "actions": [
    {
      "type": "BUY_TOKEN",
      "params": {
        "tokenAddress": "0x...",
        "bondingCurveAddress": "0x...",
        "tokenName": "TokenName",
        "usdcAmount": "1000000",
        "minTokensOut": "0"
      },
      "reason": "Why you're taking this action",
      "confidence": 0.85,
      "priority": 4
    }
  ]
}
\`\`\`

### Important Rules
- All amounts are raw BigInt strings (USDC has 6 decimals, tokens have 18 decimals)
- Set minTokensOut/minUsdcOut to "0" (slippage protection is applied automatically)
- Priority: 10 = health, 9 = treasury, 6 = repay, 5 = revenue, 4 = buy, 3 = sell
- Confidence: 0.0 to 1.0 (higher = more certain)
- You may return an empty actions array if no action is needed
- Never spend below the minimum treasury buffer
- Always check health factor before other actions`;
}
