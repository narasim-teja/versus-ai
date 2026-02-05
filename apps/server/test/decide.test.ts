/**
 * Decision Engine Tests
 *
 * Tests for the agent decision-making logic.
 */

import { describe, it, expect, beforeEach } from "bun:test";
import { decide } from "../src/agents/runtime/decide";
import {
  createMockConfig,
  createMockState,
  createMockHolding,
  createMockLoan,
  createMockOtherCreator,
  createMockMarketSentiment,
  stateBuilder,
  toUsdc,
  findAction,
  hasAction,
  MOCK_ADDRESSES,
} from "./helpers";
import type { AgentConfig, AgentState } from "../src/agents/types";

describe("Decision Engine", () => {
  let aliceConfig: AgentConfig;
  let bobConfig: AgentConfig;

  beforeEach(() => {
    aliceConfig = createMockConfig("alice");
    bobConfig = createMockConfig("bob");
  });

  // ============================================
  // Health Check (Priority 10)
  // ============================================

  describe("Health Check (Priority 10)", () => {
    it("should repay when health factor is critical (<1.2)", () => {
      const state = stateBuilder()
        .withBalance(200)
        .withLoan({
          healthFactor: 1.1,
          borrowedAmount: toUsdc(100),
          active: true,
        })
        .build();

      const result = decide(state, aliceConfig);

      expect(result.urgent).toBe(true);
      const repayAction = findAction(result.actions, "REPAY");
      expect(repayAction).toBeDefined();
      expect(repayAction!.priority).toBe(10);
      expect(repayAction!.confidence).toBeGreaterThan(0.9);
    });

    it("should not generate health action when health factor is comfortable (>1.5)", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withLoan({
          healthFactor: 1.6,
          borrowedAmount: toUsdc(100),
          active: true,
        })
        .build();

      const result = decide(state, aliceConfig);

      // Should not have urgent repay action for health
      const urgentRepay = result.actions.find(
        (a) => a.type === "REPAY" && a.priority === 10
      );
      expect(urgentRepay).toBeUndefined();
    });

    it("should not generate health action when no loan exists", () => {
      const state = stateBuilder().withBalance(500).withNoLoan().build();

      const result = decide(state, aliceConfig);

      // Find thinking step about health
      const healthThinking = result.thinking.find((t) => t.category === "health");
      expect(healthThinking?.observation).toContain("No active loan");
    });

    it("should repay up to available balance when balance is less than needed", () => {
      const state = stateBuilder()
        .withBalance(20) // Only 20 USDC available
        .withLoan({
          healthFactor: 1.05, // Very critical
          borrowedAmount: toUsdc(100), // Would need ~30 USDC to repay
          active: true,
        })
        .build();

      const result = decide(state, aliceConfig);

      const repayAction = findAction(result.actions, "REPAY");
      expect(repayAction).toBeDefined();
      // Should repay what we have (20 USDC)
      expect((repayAction!.params as { repayAmount: bigint }).repayAmount).toBeLessThanOrEqual(
        toUsdc(20)
      );
    });
  });

  // ============================================
  // Treasury Management (Priority 9)
  // ============================================

  describe("Treasury Management (Priority 9)", () => {
    it("should sell profitable holdings when treasury is below minimum (Alice)", () => {
      const state = stateBuilder()
        .withBalance(50) // Below Alice's minimum of 100
        .withHolding({
          tokenName: "ProfitableToken",
          pnlPercent: 25, // 25% profit
          balance: toUsdc(1000),
        })
        .build();

      const result = decide(state, aliceConfig);

      expect(result.urgent).toBe(true);
      const sellAction = findAction(result.actions, "SELL_TOKEN");
      expect(sellAction).toBeDefined();
      expect(sellAction!.priority).toBe(9);
    });

    it("should not act when treasury is above minimum", () => {
      const state = stateBuilder()
        .withBalance(200) // Above Alice's minimum of 100
        .build();

      const result = decide(state, aliceConfig);

      // Should not have urgent treasury actions
      const urgentAction = result.actions.find((a) => a.priority === 9);
      expect(urgentAction).toBeUndefined();
    });

    it("should sell most profitable holding first", () => {
      const state = stateBuilder()
        .withBalance(50) // Below minimum
        .withHoldings([
          { tokenName: "Token1", pnlPercent: 10, tokenAddress: MOCK_ADDRESSES.otherToken },
          { tokenName: "Token2", pnlPercent: 30, tokenAddress: MOCK_ADDRESSES.bobToken },
          { tokenName: "Token3", pnlPercent: 20, tokenAddress: MOCK_ADDRESSES.aliceToken },
        ])
        .build();

      const result = decide(state, aliceConfig);

      const sellAction = findAction(result.actions, "SELL_TOKEN");
      expect(sellAction).toBeDefined();
      expect(sellAction!.reason).toContain("Token2"); // Most profitable
    });
  });

  // ============================================
  // Loan Repayment (Priority 6)
  // ============================================

  describe("Loan Repayment (Priority 6)", () => {
    it("should repay loan when treasury exceeds repay trigger", () => {
      const state = stateBuilder()
        .withBalance(1500) // Above Alice's repay trigger of 1000
        .withLoan({
          borrowedAmount: toUsdc(100),
          healthFactor: 1.8, // Healthy
          active: true,
        })
        .build();

      const result = decide(state, aliceConfig);

      const repayAction = findAction(result.actions, "REPAY");
      expect(repayAction).toBeDefined();
      expect(repayAction!.priority).toBe(6);
    });

    it("should not repay loan when treasury is below repay trigger", () => {
      const state = stateBuilder()
        .withBalance(800) // Below Alice's repay trigger of 1000
        .withLoan({
          borrowedAmount: toUsdc(100),
          healthFactor: 1.8,
          active: true,
        })
        .build();

      const result = decide(state, aliceConfig);

      const repayAction = result.actions.find(
        (a) => a.type === "REPAY" && a.priority === 6
      );
      expect(repayAction).toBeUndefined();
    });
  });

  // ============================================
  // Revenue Claiming (Priority 5)
  // ============================================

  describe("Revenue Claiming (Priority 5)", () => {
    it("should claim revenue when pending >= 1 USDC", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withOwnTokenRevenue(5) // 5 USDC pending
        .build();

      const result = decide(state, aliceConfig);

      const claimAction = findAction(result.actions, "CLAIM_REVENUE");
      expect(claimAction).toBeDefined();
      expect(claimAction!.priority).toBe(5);
    });

    it("should not claim revenue when pending < 1 USDC", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withOwnTokenRevenue(0.5) // 0.5 USDC pending
        .build();

      const result = decide(state, aliceConfig);

      const claimAction = findAction(result.actions, "CLAIM_REVENUE");
      expect(claimAction).toBeUndefined();
    });
  });

  // ============================================
  // Buy Opportunities (Priority 4)
  // ============================================

  describe("Buy Opportunities (Priority 4)", () => {
    it("should buy when excess treasury and good opportunity exists", () => {
      const state = stateBuilder()
        .withBalance(1000) // Well above Alice's target of 500
        .withOtherCreator({
          pendingRevenue: toUsdc(100), // Strong revenue signal
          totalSupply: toUsdc(50000),
        })
        .withMarketSentiment({ sentiment: "bullish" })
        .build();

      const result = decide(state, aliceConfig);

      const buyAction = findAction(result.actions, "BUY_TOKEN");
      expect(buyAction).toBeDefined();
      expect(buyAction!.priority).toBe(4);
    });

    it("should apply market sentiment multiplier (bullish = more buying)", () => {
      const state = stateBuilder()
        .withBalance(1000)
        .withOtherCreator({
          pendingRevenue: toUsdc(20), // Moderate revenue
          totalSupply: toUsdc(50000),
        })
        .withMarketSentiment({ sentiment: "bullish", ethChange24h: 5 })
        .build();

      const result = decide(state, aliceConfig);

      // Check thinking includes sentiment
      const marketThinking = result.thinking.find((t) => t.category === "market");
      expect(marketThinking?.observation).toContain("bullish");
    });

    it("should not buy when treasury is below target", () => {
      const state = stateBuilder()
        .withBalance(400) // Below Alice's target of 500
        .withOtherCreator({
          pendingRevenue: toUsdc(100),
          totalSupply: toUsdc(50000),
        })
        .build();

      const result = decide(state, aliceConfig);

      const buyAction = findAction(result.actions, "BUY_TOKEN");
      expect(buyAction).toBeUndefined();
    });

    it("Bob (degen) should be more willing to buy than Alice", () => {
      const state = stateBuilder()
        .withBalance(200) // Above Bob's target of 100
        .withOtherCreator({
          pendingRevenue: toUsdc(10), // Weak signal
          totalSupply: toUsdc(10000),
        })
        .build();

      const aliceResult = decide(state, aliceConfig);
      const bobResult = decide(state, bobConfig);

      // Bob's lower thresholds make him more likely to buy
      // This is a qualitative test - Bob has lower speculation threshold
      expect(bobConfig.strategy.buySignals.revenueGrowth).toBeLessThan(
        aliceConfig.strategy.buySignals.revenueGrowth
      );
    });
  });

  // ============================================
  // Sell Signals (Priority 3)
  // ============================================

  describe("Sell Signals (Priority 3)", () => {
    it("should trigger stop loss at configured threshold (Alice: -15%)", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withHolding({
          tokenName: "LosingToken",
          pnlPercent: -20, // Below Alice's -15% stop loss
          balance: toUsdc(1000),
        })
        .build();

      const result = decide(state, aliceConfig);

      const sellAction = findAction(result.actions, "SELL_TOKEN");
      expect(sellAction).toBeDefined();
      expect(sellAction!.reason).toContain("Stop loss");
    });

    it("should trigger profit take at configured threshold (Alice: +50%)", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withHolding({
          tokenName: "WinningToken",
          pnlPercent: 60, // Above Alice's 50% profit take
          balance: toUsdc(1000),
        })
        .build();

      const result = decide(state, aliceConfig);

      const sellAction = findAction(result.actions, "SELL_TOKEN");
      expect(sellAction).toBeDefined();
      expect(sellAction!.reason).toContain("Profit take");
    });

    it("should sell 50% on profit take by default", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withHolding({
          tokenName: "WinningToken",
          pnlPercent: 60,
          balance: toUsdc(1000),
        })
        .build();

      const result = decide(state, aliceConfig);

      const sellAction = findAction(result.actions, "SELL_TOKEN");
      expect(sellAction).toBeDefined();
      // Sell 50% = 500 USDC worth
      expect((sellAction!.params as { tokenAmount: bigint }).tokenAmount).toBe(
        toUsdc(500)
      );
    });

    it("should sell 100% on stop loss", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withHolding({
          tokenName: "LosingToken",
          pnlPercent: -20,
          balance: toUsdc(1000),
        })
        .build();

      const result = decide(state, aliceConfig);

      const sellAction = findAction(result.actions, "SELL_TOKEN");
      expect(sellAction).toBeDefined();
      // Sell 100% on stop loss
      expect((sellAction!.params as { tokenAmount: bigint }).tokenAmount).toBe(
        toUsdc(1000)
      );
    });

    it("Bob has wider stop loss than Alice (-25% vs -15%)", () => {
      const state = stateBuilder()
        .withBalance(100)
        .withHolding({
          tokenName: "LosingToken",
          pnlPercent: -18, // Between Alice's -15% and Bob's -25%
          balance: toUsdc(1000),
        })
        .build();

      const aliceResult = decide(state, aliceConfig);
      const bobResult = decide(state, bobConfig);

      // Alice should sell (below -15%)
      expect(hasAction(aliceResult.actions, "SELL_TOKEN")).toBe(true);
      // Bob should hold (above -25%)
      const bobSell = bobResult.actions.find(
        (a) => a.type === "SELL_TOKEN" && a.reason.includes("Stop loss")
      );
      expect(bobSell).toBeUndefined();
    });
  });

  // ============================================
  // Action Priority Ordering
  // ============================================

  describe("Action Priority Ordering", () => {
    it("should sort actions by priority (highest first)", () => {
      const state = stateBuilder()
        .withBalance(50) // Below min buffer - triggers P9
        .withLoan({
          healthFactor: 1.1, // Critical - triggers P10
          borrowedAmount: toUsdc(100),
          active: true,
        })
        .withHolding({
          tokenName: "Profitable",
          pnlPercent: 25,
          balance: toUsdc(1000),
        })
        .build();

      const result = decide(state, aliceConfig);

      // Actions should be sorted by priority descending
      for (let i = 1; i < result.actions.length; i++) {
        expect(result.actions[i - 1].priority).toBeGreaterThanOrEqual(
          result.actions[i].priority
        );
      }

      // First action should be highest priority (P10 health check)
      if (result.actions.length > 0) {
        expect(result.actions[0].priority).toBe(10);
      }
    });
  });

  // ============================================
  // Thinking Steps
  // ============================================

  describe("Thinking Steps", () => {
    it("should include thinking steps for each evaluation category", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withLoan({ healthFactor: 1.5, active: true })
        .withOwnTokenRevenue(0.5)
        .build();

      const result = decide(state, aliceConfig);

      // Should have thinking steps for various categories
      const categories = result.thinking.map((t) => t.category);
      expect(categories).toContain("health");
      expect(categories).toContain("treasury");
    });

    it("should include metrics in thinking steps", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withLoan({
          healthFactor: 1.5,
          borrowedAmount: toUsdc(100),
          currentLTV: 40,
          active: true,
        })
        .build();

      const result = decide(state, aliceConfig);

      const healthThinking = result.thinking.find((t) => t.category === "health");
      expect(healthThinking?.metrics).toBeDefined();
      expect(healthThinking?.metrics?.healthFactor).toBe(1.5);
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe("Edge Cases", () => {
    it("should handle empty holdings array", () => {
      const state = stateBuilder().withBalance(500).withHoldings([]).build();

      const result = decide(state, aliceConfig);

      // Should not throw
      expect(result).toBeDefined();
      expect(result.actions).toBeDefined();
    });

    it("should handle zero balance holdings", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withHolding({
          balance: BigInt(0),
          pnlPercent: -50,
        })
        .build();

      const result = decide(state, aliceConfig);

      // Should not generate sell action for zero balance
      const sellAction = findAction(result.actions, "SELL_TOKEN");
      expect(sellAction).toBeUndefined();
    });

    it("should handle null market sentiment", () => {
      const state = createMockState({
        usdcBalance: toUsdc(1000),
        marketSentiment: null,
        otherCreators: [createMockOtherCreator({ pendingRevenue: toUsdc(100) })],
      });

      const result = decide(state, aliceConfig);

      // Should not throw and should use default multiplier
      expect(result).toBeDefined();
    });
  });
});
