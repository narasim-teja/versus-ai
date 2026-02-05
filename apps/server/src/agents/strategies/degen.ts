/**
 * Degen Strategy (Bob)
 *
 * Aggressive approach:
 * - Lower confidence requirements, willing to act fast
 * - Less selective about buy opportunities
 * - Wider stop loss to ride volatility
 * - Earlier profit taking to lock in gains
 * - Prefers quantity and speed over careful analysis
 */

import type { Holding, OtherCreator, StrategyConfig, AgentState } from "../types";
import { BaseStrategy } from "./base";

const ONE_USDC = BigInt(10 ** 6);

export class DegenStrategy extends BaseStrategy {
  readonly name = "Degen";
  readonly type = "degen" as const;

  /**
   * Lower confidence multiplier means Bob takes action on weaker signals
   */
  protected readonly confidenceMultiplier = 0.85;

  /**
   * Aggressive sentiment multiplier
   * - More reactive to bullish sentiment (FOMO in)
   * - Less scared of bearish conditions (buy the dip mentality)
   */
  protected override getSentimentMultiplier(
    sentiment: AgentState["marketSentiment"]
  ): number {
    if (!sentiment) return 1.0;
    switch (sentiment.sentiment) {
      case "bullish":
        // Aggressively increase exposure in bull market
        return 1.5;
      case "bearish":
        // Still willing to trade in bear market (contrarian)
        return 0.85;
      default:
        return 1.0;
    }
  }

  /**
   * Aggressive buy opportunity scoring
   * - Lower thresholds for entry
   * - Willing to buy newer/riskier tokens
   * - Also considers price dip as opportunity
   */
  protected override scoreBuyOpportunities(
    otherCreators: OtherCreator[],
    buySignals: StrategyConfig["buySignals"],
    sentimentMultiplier: number
  ): Array<{ creator: OtherCreator; score: number }> {
    const opportunities: Array<{ creator: OtherCreator; score: number }> = [];

    for (const creator of otherCreators) {
      // Degen is willing to look at tokens with any activity
      if (
        creator.pendingRevenue === BigInt(0) &&
        creator.totalSupply === BigInt(0)
      ) {
        continue;
      }

      // Base score from revenue
      const revenueScore = Number(creator.pendingRevenue) / Number(ONE_USDC) / 100;

      // Degen bonus: smaller market cap = more upside potential
      const smallCapBonus =
        creator.totalSupply < BigInt(50000) * ONE_USDC
          ? 0.1 // 10% bonus for smaller tokens
          : 0;

      // Degen bonus: cheap price (might 10x?)
      const cheapBonus =
        creator.currentPrice < ONE_USDC / BigInt(10) // < 0.10 USDC
          ? 0.05
          : 0;

      // Combined score with lower threshold
      const finalScore =
        (revenueScore + smallCapBonus + cheapBonus) * sentimentMultiplier;

      // Degen has lower bar for entry
      const adjustedThreshold = buySignals.revenueGrowth * 0.75; // 25% lower threshold

      if (finalScore > adjustedThreshold) {
        opportunities.push({ creator, score: finalScore });
      }
    }

    // Degen might buy multiple opportunities at once
    return opportunities;
  }

  /**
   * Aggressive profit taking - lock in gains quickly
   */
  protected override getProfitTakeSellAmount(holding: Holding): bigint {
    // Degen: sell 75% on profit take, take the gains while they're there
    return (holding.balance * BigInt(75)) / BigInt(100);
  }
}
