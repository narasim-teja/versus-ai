/**
 * Stork Oracle Integration Module
 *
 * Re-exports all Stork price functionality.
 *
 * Usage:
 * - Use getMarketSentiment() in agent decisions for market context
 * - Use getEthPrice()/getBtcPrice() for individual asset prices (REST API)
 * - Use getOnChainEthPrice()/getOnChainBtcPrice() for on-chain oracle reads
 * - Do NOT use for token prices - use direct contract reads instead
 */

// REST API integration
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

// On-chain integration
export {
  getStorkContract,
  getAssetId,
  readStorkPrice,
  readStorkPriceUnsafe,
  getOnChainBtcPrice,
  getOnChainEthPrice,
  getOnChainUsdcPrice,
  getOnChainPrices,
  getStorkVersion,
  checkStorkContractHealth,
  STORK_CONTRACT_ADDRESS,
  ASSET_IDS,
} from "./onchain";

export type {
  StorkPriceData,
  StorkLatestPricesResponse,
  StorkHistoryResponse,
  MarketPrice,
  MarketSentiment,
  MarketSentimentData,
} from "./types";

export type { TemporalNumericValue, OnChainPrice } from "./onchain";
