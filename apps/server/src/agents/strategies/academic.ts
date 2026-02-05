/**
 * Academic Strategy (Alice)
 *
 * Conservative approach:
 * - Higher confidence requirements for all actions
 * - More selective about buy opportunities
 * - Stricter stop loss, higher profit targets
 * - Prefers quality over quantity
 */

import type { Holding, OtherCreator, StrategyConfig, AgentState } from "../types";
import { BaseStrategy } from "./base";

const ONE_USDC = BigInt(10 ** 6);

export class AcademicStrategy extends BaseStrategy {
  readonly name = "Academic";
  readonly type = "academic" as const;

  /**
   * Higher confidence multiplier means Alice requires stronger signals
   * before taking action
   */
  protected readonly confidenceMultiplier = 1.0;

  /**
   * More conservative sentiment multiplier
   * - Less reactive to bullish sentiment
   * - More cautious in bearish conditions
   */
  protected override getSentimentMultiplier(
    sentiment: AgentState["marketSentiment"]
  ): number {
    if (!sentiment) return 1.0;
    switch (sentiment.sentiment) {
      case "bullish":
        // Only slightly increase exposure in bullish market
        return 1.1;
      case "bearish":
        // Very cautious in bearish market
        return 0.5;
      default:
        return 1.0;
    }
  }

  /**
   * More selective buy opportunity scoring
   * - Requires higher revenue thresholds
   * - Applies additional quality filters
   */
  protected override scoreBuyOpportunities(
    otherCreators: OtherCreator[],
    buySignals: StrategyConfig["buySignals"],
    sentimentMultiplier: number
  ): Array<{ creator: OtherCreator; score: number }> {
    const opportunities: Array<{ creator: OtherCreator; score: number }> = [];

    for (const creator of otherCreators) {
      // Skip if no revenue or very low supply (unproven)
      if (creator.pendingRevenue === BigInt(0)) {
        continue;
      }

      // Academic strategy requires minimum supply to consider
      // (shows the token is established, not brand new)
      const minSupply = BigInt(10000) * ONE_USDC; // 10k tokens minimum
      if (creator.totalSupply < minSupply) {
        continue;
      }

      // Score based on revenue relative to supply (efficiency metric)
      const revenuePerToken =
        creator.totalSupply > BigInt(0)
          ? Number(creator.pendingRevenue) / Number(creator.totalSupply)
          : 0;

      // Base score from revenue
      const revenueScore = Number(creator.pendingRevenue) / Number(ONE_USDC) / 100;

      // Bonus for revenue efficiency
      const efficiencyBonus = revenuePerToken * 10;

      // Combined score with higher threshold requirement
      const finalScore = (revenueScore + efficiencyBonus) * sentimentMultiplier;

      // Academic strategy has higher bar for entry
      const adjustedThreshold = buySignals.revenueGrowth * 1.25; // 25% higher threshold

      if (finalScore > adjustedThreshold) {
        opportunities.push({ creator, score: finalScore });
      }
    }

    return opportunities;
  }

  /**
   * Conservative profit taking - sell smaller portions
   */
  protected override getProfitTakeSellAmount(holding: Holding): bigint {
    // Academic: only sell 25% on profit take to maintain exposure
    return holding.balance / BigInt(4);
  }
}
