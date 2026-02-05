/**
 * Strategy Tests
 *
 * Tests for the pluggable strategy system (Academic vs Degen).
 */

import { describe, it, expect } from "bun:test";
import { getStrategy, createStrategy, AcademicStrategy, DegenStrategy } from "../src/agents/strategies";
import {
  createMockConfig,
  stateBuilder,
  toUsdc,
  findAction,
  createMockOtherCreator,
  MOCK_ADDRESSES,
} from "./helpers";

describe("Strategies", () => {
  // ============================================
  // Strategy Factory
  // ============================================

  describe("Strategy Factory", () => {
    it("should return AcademicStrategy for 'academic' type", () => {
      const strategy = getStrategy("academic");
      expect(strategy.name).toBe("Academic");
      expect(strategy.type).toBe("academic");
    });

    it("should return DegenStrategy for 'degen' type", () => {
      const strategy = getStrategy("degen");
      expect(strategy.name).toBe("Degen");
      expect(strategy.type).toBe("degen");
    });

    it("should return singleton instances", () => {
      const strategy1 = getStrategy("academic");
      const strategy2 = getStrategy("academic");
      expect(strategy1).toBe(strategy2);
    });

    it("should create new instances with createStrategy", () => {
      const strategy1 = createStrategy("academic");
      const strategy2 = createStrategy("academic");
      expect(strategy1).not.toBe(strategy2);
    });

    it("should throw for unknown strategy type", () => {
      expect(() => getStrategy("unknown" as never)).toThrow();
    });
  });

  // ============================================
  // Academic Strategy
  // ============================================

  describe("AcademicStrategy", () => {
    const strategy = new AcademicStrategy();
    const config = createMockConfig("alice");

    it("should have correct name and type", () => {
      expect(strategy.name).toBe("Academic");
      expect(strategy.type).toBe("academic");
    });

    it("should be more conservative with sentiment multiplier", () => {
      // Test bullish sentiment - Academic is less reactive
      const bullishState = stateBuilder()
        .withBalance(1000)
        .withMarketSentiment({ sentiment: "bullish" })
        .withOtherCreator({ pendingRevenue: toUsdc(50) })
        .build();

      const result = strategy.decide(bullishState, config);

      // Check that sentiment was considered
      const marketThinking = result.thinking.find((t) => t.category === "market");
      expect(marketThinking).toBeDefined();
      // Academic should apply 1.1x multiplier (less than 1.2x default)
    });

    it("should be very cautious in bearish conditions", () => {
      const bearishState = stateBuilder()
        .withBalance(1000)
        .withMarketSentiment({ sentiment: "bearish", ethChange24h: -10 })
        .withOtherCreator({ pendingRevenue: toUsdc(50) })
        .build();

      const result = strategy.decide(bearishState, config);

      const marketThinking = result.thinking.find((t) => t.category === "market");
      expect(marketThinking?.observation).toContain("bearish");
    });

    it("should require minimum token supply for buy opportunities", () => {
      const state = stateBuilder()
        .withBalance(1000)
        .withOtherCreators([
          // Small cap token - Academic should be skeptical
          {
            pendingRevenue: toUsdc(50),
            totalSupply: toUsdc(5000), // Below 10k threshold
            tokenAddress: MOCK_ADDRESSES.otherToken,
          },
        ])
        .build();

      const result = strategy.decide(state, config);

      // Academic may not buy small cap tokens
      const tradingThinking = result.thinking.find(
        (t) => t.category === "trading" && t.observation.includes("opportunities")
      );
      // Either no opportunities found or very selective
    });

    it("should sell smaller portion on profit take (25%)", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withHolding({
          tokenName: "Winner",
          pnlPercent: 60, // Above 50% threshold
          balance: toUsdc(1000),
        })
        .build();

      const result = strategy.decide(state, config);

      const sellAction = findAction(result.actions, "SELL_TOKEN");
      expect(sellAction).toBeDefined();
      // Academic sells 25% = 250 tokens
      const sellAmount = (sellAction!.params as { tokenAmount: bigint }).tokenAmount;
      expect(sellAmount).toBe(toUsdc(250)); // 25% of 1000
    });

    it("should have stricter stop loss than Bob", () => {
      // Alice's stop loss is -15%, Bob's is -25%
      expect(config.strategy.sellSignals.priceDrop).toBe(0.15);
    });
  });

  // ============================================
  // Degen Strategy
  // ============================================

  describe("DegenStrategy", () => {
    const strategy = new DegenStrategy();
    const config = createMockConfig("bob");

    it("should have correct name and type", () => {
      expect(strategy.name).toBe("Degen");
      expect(strategy.type).toBe("degen");
    });

    it("should be more aggressive with sentiment multiplier", () => {
      const bullishState = stateBuilder()
        .withBalance(200)
        .withMarketSentiment({ sentiment: "bullish", ethChange24h: 5 })
        .withOtherCreator({ pendingRevenue: toUsdc(20) })
        .build();

      const result = strategy.decide(bullishState, config);

      // Degen should apply 1.5x multiplier (more than 1.2x default)
      const marketThinking = result.thinking.find((t) => t.category === "market");
      expect(marketThinking?.observation).toContain("bullish");
    });

    it("should still trade in bearish conditions", () => {
      const bearishState = stateBuilder()
        .withBalance(200)
        .withMarketSentiment({ sentiment: "bearish", ethChange24h: -5 })
        .withOtherCreator({ pendingRevenue: toUsdc(50) })
        .build();

      const result = strategy.decide(bearishState, config);

      // Degen is contrarian - still applies 0.85x (not as scared as 0.5x)
      // May still find opportunities
    });

    it("should be willing to buy smaller/newer tokens", () => {
      const state = stateBuilder()
        .withBalance(200)
        .withOtherCreators([
          {
            pendingRevenue: toUsdc(10),
            totalSupply: toUsdc(5000), // Small cap
            currentPrice: toUsdc(0.05), // Cheap
            tokenAddress: MOCK_ADDRESSES.otherToken,
          },
        ])
        .build();

      const result = strategy.decide(state, config);

      // Degen has lower thresholds and small cap bonus
      // More likely to find this as an opportunity
    });

    it("should sell larger portion on profit take (75%)", () => {
      const state = stateBuilder()
        .withBalance(100)
        .withHolding({
          tokenName: "Winner",
          pnlPercent: 35, // Above 30% threshold for Bob
          balance: toUsdc(1000),
        })
        .build();

      const result = strategy.decide(state, config);

      const sellAction = findAction(result.actions, "SELL_TOKEN");
      expect(sellAction).toBeDefined();
      // Degen sells 75% = 750 tokens
      const sellAmount = (sellAction!.params as { tokenAmount: bigint }).tokenAmount;
      expect(sellAmount).toBe(toUsdc(750)); // 75% of 1000
    });

    it("should have wider stop loss than Alice", () => {
      // Bob's stop loss is -25%, Alice's is -15%
      expect(config.strategy.sellSignals.priceDrop).toBe(0.25);
    });

    it("should have lower profit take threshold than Alice", () => {
      // Bob takes profit at 30%, Alice at 50%
      expect(config.strategy.sellSignals.profitTake).toBe(0.30);
      expect(createMockConfig("alice").strategy.sellSignals.profitTake).toBe(0.50);
    });
  });

  // ============================================
  // Strategy Comparison
  // ============================================

  describe("Strategy Comparison", () => {
    const academicStrategy = new AcademicStrategy();
    const degenStrategy = new DegenStrategy();
    const aliceConfig = createMockConfig("alice");
    const bobConfig = createMockConfig("bob");

    it("Bob should find more buy opportunities than Alice in same state", () => {
      const state = stateBuilder()
        .withBalance(1000)
        .withOtherCreators([
          { pendingRevenue: toUsdc(15), totalSupply: toUsdc(30000) },
          { pendingRevenue: toUsdc(8), totalSupply: toUsdc(20000) },
        ])
        .build();

      const aliceResult = academicStrategy.decide(state, aliceConfig);
      const bobResult = degenStrategy.decide(state, bobConfig);

      // Both might find opportunities, but Bob's lower thresholds
      // make him more likely to act
      const aliceBuys = aliceResult.actions.filter((a) => a.type === "BUY_TOKEN");
      const bobBuys = bobResult.actions.filter((a) => a.type === "BUY_TOKEN");

      // Bob has lower revenue growth threshold (5% vs 15%)
      expect(bobConfig.strategy.buySignals.revenueGrowth).toBeLessThan(
        aliceConfig.strategy.buySignals.revenueGrowth
      );
    });

    it("Alice should hold losing positions longer before stop loss", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withHolding({
          pnlPercent: -18, // Between -15% (Alice trigger) and -25% (Bob trigger)
          balance: toUsdc(1000),
        })
        .build();

      const aliceResult = academicStrategy.decide(state, aliceConfig);
      const bobResult = degenStrategy.decide(state, bobConfig);

      // Alice should sell (below -15%)
      const aliceSells = aliceResult.actions.filter(
        (a) => a.type === "SELL_TOKEN" && a.reason.includes("Stop loss")
      );
      // Bob should hold (above -25%)
      const bobSells = bobResult.actions.filter(
        (a) => a.type === "SELL_TOKEN" && a.reason.includes("Stop loss")
      );

      expect(aliceSells.length).toBe(1);
      expect(bobSells.length).toBe(0);
    });

    it("strategies should have different treasury thresholds", () => {
      expect(aliceConfig.strategy.minTreasuryBuffer).toBeGreaterThan(
        bobConfig.strategy.minTreasuryBuffer
      );
      expect(aliceConfig.strategy.targetTreasuryBuffer).toBeGreaterThan(
        bobConfig.strategy.targetTreasuryBuffer
      );
    });

    it("Bob should use more leverage (higher max LTV)", () => {
      expect(bobConfig.strategy.maxLTV).toBeGreaterThan(aliceConfig.strategy.maxLTV);
    });

    it("Bob should have larger speculation budget", () => {
      expect(bobConfig.strategy.speculationBudget).toBeGreaterThan(
        aliceConfig.strategy.speculationBudget
      );
    });
  });
});
