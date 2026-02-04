/**
 * Stork Oracle Integration Module
 *
 * Re-exports all Stork price functionality.
 *
 * Usage:
 * - Use getMarketSentiment() in agent decisions for market context
 * - Use getEthPrice()/getBtcPrice() for individual asset prices
 * - Do NOT use for token prices - use direct contract reads instead
 */

export {
  getAvailableAssets,
  getLatestPrices,
  getHistoricalPrices,
  checkStorkHealth,
} from "./client";

export {
  getEthPrice,
  getBtcPrice,
  getMarketSentiment,
  getMarketPrices,
  clearPriceCache,
} from "./prices";

export type {
  StorkPriceData,
  StorkLatestPricesResponse,
  StorkHistoryResponse,
  MarketPrice,
  MarketSentiment,
  MarketSentimentData,
} from "./types";
