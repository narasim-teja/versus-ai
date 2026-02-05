/**
 * State Reader Tests
 *
 * Tests for state reading and P&L calculations.
 * Note: These are unit tests that don't require actual API connections.
 */

import { describe, it, expect } from "bun:test";
import {
  createMockState,
  createMockHolding,
  createMockLoan,
  createMockMarketSentiment,
  stateBuilder,
  toUsdc,
  fromUsdc,
} from "./helpers";

describe("State Reader", () => {
  // ============================================
  // P&L Calculations
  // ============================================

  describe("P&L Calculations", () => {
    it("should calculate unrealized P&L correctly for profit", () => {
      const holding = createMockHolding({
        balance: toUsdc(1000), // 1000 tokens
        avgBuyPrice: toUsdc(0.1), // Bought at 0.10
        currentPrice: toUsdc(0.15), // Now worth 0.15
      });

      // Cost basis = 1000 * 0.10 = 100 USDC
      // Current value = 1000 * 0.15 = 150 USDC
      // P&L = 150 - 100 = 50 USDC (50% profit)
      expect(fromUsdc(holding.totalCostBasis)).toBeCloseTo(100, 2);
      expect(holding.pnlPercent).toBeCloseTo(50, 1);
      expect(fromUsdc(holding.unrealizedPnl)).toBeCloseTo(50, 2);
    });

    it("should calculate unrealized P&L correctly for loss", () => {
      const holding = createMockHolding({
        balance: toUsdc(1000),
        avgBuyPrice: toUsdc(0.2),
        currentPrice: toUsdc(0.1),
      });

      // Cost basis = 1000 * 0.20 = 200 USDC
      // Current value = 1000 * 0.10 = 100 USDC
      // P&L = 100 - 200 = -100 USDC (50% loss)
      expect(fromUsdc(holding.totalCostBasis)).toBeCloseTo(200, 2);
      expect(holding.pnlPercent).toBeCloseTo(-50, 1);
      expect(fromUsdc(holding.unrealizedPnl)).toBeCloseTo(-100, 2);
    });

    it("should handle zero balance correctly", () => {
      const holding = createMockHolding({
        balance: BigInt(0),
        totalCostBasis: BigInt(0),
      });

      // With zero balance, P&L should be 0
      expect(holding.pnlPercent).toBe(0);
    });

    it("should handle zero cost basis correctly", () => {
      const holding = createMockHolding({
        balance: toUsdc(100),
        totalCostBasis: BigInt(0),
        currentPrice: toUsdc(0.1),
      });

      // Free tokens have 0% P&L (can't calculate percentage)
      expect(holding.pnlPercent).toBe(0);
    });
  });

  // ============================================
  // Loan Health Calculations
  // ============================================

  describe("Loan Health Calculations", () => {
    it("should correctly represent healthy loan", () => {
      const loan = createMockLoan({
        collateralAmount: toUsdc(1000),
        borrowedAmount: toUsdc(300),
        healthFactor: 2.0,
        currentLTV: 30,
      });

      expect(loan.healthFactor).toBeGreaterThan(1.5);
      expect(loan.currentLTV).toBeLessThan(70); // Below typical max
    });

    it("should correctly represent critical loan", () => {
      const loan = createMockLoan({
        collateralAmount: toUsdc(1000),
        borrowedAmount: toUsdc(800),
        healthFactor: 1.1,
        currentLTV: 80,
      });

      expect(loan.healthFactor).toBeLessThan(1.2);
      expect(loan.currentLTV).toBeGreaterThan(70);
    });

    it("should correctly represent liquidatable loan", () => {
      const loan = createMockLoan({
        collateralAmount: toUsdc(1000),
        borrowedAmount: toUsdc(900),
        healthFactor: 0.9,
        currentLTV: 90,
      });

      expect(loan.healthFactor).toBeLessThan(1.0);
      expect(loan.currentLTV).toBeGreaterThan(85); // Above liquidation threshold
    });
  });

  // ============================================
  // Market Sentiment
  // ============================================

  describe("Market Sentiment", () => {
    it("should correctly categorize bullish sentiment", () => {
      const sentiment = createMockMarketSentiment({
        sentiment: "bullish",
        ethChange24h: 5,
        btcChange24h: 3,
      });

      expect(sentiment.sentiment).toBe("bullish");
      expect(sentiment.ethChange24h).toBeGreaterThan(0);
    });

    it("should correctly categorize bearish sentiment", () => {
      const sentiment = createMockMarketSentiment({
        sentiment: "bearish",
        ethChange24h: -8,
        btcChange24h: -5,
      });

      expect(sentiment.sentiment).toBe("bearish");
      expect(sentiment.ethChange24h).toBeLessThan(0);
    });

    it("should correctly categorize neutral sentiment", () => {
      const sentiment = createMockMarketSentiment({
        sentiment: "neutral",
        ethChange24h: 0.5,
        btcChange24h: -0.3,
      });

      expect(sentiment.sentiment).toBe("neutral");
    });
  });

  // ============================================
  // State Builder
  // ============================================

  describe("State Builder", () => {
    it("should create default state with all fields", () => {
      const state = stateBuilder().build();

      expect(state.timestamp).toBeDefined();
      expect(state.cycle).toBe(1);
      expect(state.usdcBalance).toBeDefined();
      expect(state.ownTokenPrice).toBeDefined();
      expect(state.holdings).toEqual([]);
      expect(state.loan).toBeNull();
      expect(state.marketSentiment).toBeDefined();
      expect(state.otherCreators).toEqual([]);
      expect(state.pendingTxs).toEqual([]);
    });

    it("should support fluent API for building states", () => {
      const state = stateBuilder()
        .withBalance(500)
        .withCycle(5)
        .withLoan({ healthFactor: 1.5 })
        .withHolding({ tokenName: "Test" })
        .withOtherCreator({ pendingRevenue: toUsdc(10) })
        .withMarketSentiment({ sentiment: "bullish" })
        .build();

      expect(fromUsdc(state.usdcBalance)).toBe(500);
      expect(state.cycle).toBe(5);
      expect(state.loan).not.toBeNull();
      expect(state.loan!.healthFactor).toBe(1.5);
      expect(state.holdings.length).toBe(1);
      expect(state.holdings[0].tokenName).toBe("Test");
      expect(state.otherCreators.length).toBe(1);
      expect(state.marketSentiment!.sentiment).toBe("bullish");
    });

    it("should support multiple holdings", () => {
      const state = stateBuilder()
        .withHoldings([
          { tokenName: "Token1" },
          { tokenName: "Token2" },
          { tokenName: "Token3" },
        ])
        .build();

      expect(state.holdings.length).toBe(3);
      expect(state.holdings[0].tokenName).toBe("Token1");
      expect(state.holdings[2].tokenName).toBe("Token3");
    });

    it("should support multiple other creators", () => {
      const state = stateBuilder()
        .withOtherCreators([
          { pendingRevenue: toUsdc(10) },
          { pendingRevenue: toUsdc(20) },
        ])
        .build();

      expect(state.otherCreators.length).toBe(2);
    });

    it("should allow removing loan", () => {
      const state = stateBuilder()
        .withLoan({ healthFactor: 1.5 })
        .withNoLoan()
        .build();

      expect(state.loan).toBeNull();
    });
  });

  // ============================================
  // Edge Cases
  // ============================================

  describe("Edge Cases", () => {
    it("should handle very large numbers", () => {
      const holding = createMockHolding({
        balance: toUsdc(1000000000), // 1 billion tokens
        avgBuyPrice: toUsdc(0.001),
        currentPrice: toUsdc(0.002),
      });

      // Should not overflow
      expect(holding.unrealizedPnl).toBeDefined();
      expect(holding.pnlPercent).toBeCloseTo(100, 0); // 100% gain
    });

    it("should handle very small numbers", () => {
      const holding = createMockHolding({
        balance: BigInt(1), // 0.000001 tokens (1 wei)
        avgBuyPrice: toUsdc(0.000001),
        currentPrice: toUsdc(0.000002),
      });

      expect(holding.balance).toBe(BigInt(1));
    });

    it("should handle null market sentiment in state", () => {
      const state = createMockState({
        marketSentiment: null,
      });

      expect(state.marketSentiment).toBeNull();
    });

    it("should handle empty other creators array", () => {
      const state = stateBuilder().withOtherCreators([]).build();

      expect(state.otherCreators).toEqual([]);
    });
  });
});
