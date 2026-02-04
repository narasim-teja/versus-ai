/**
 * Stork Oracle Types
 *
 * Type definitions for Stork REST API responses
 * Used for market sentiment data (ETH/USD, BTC/USD)
 */

/**
 * Stork price is a QuantizedPrice = price * 10^18 as string
 */
export interface StorkPriceData {
  timestamp: number; // Unix timestamp in nanoseconds
  asset_id: string;
  signature_type: string;
  trigger: string;
  price: string; // QuantizedPrice (18 decimals)
  stork_signed_price?: {
    public_key: string;
    encoded_asset_id: string;
    price: string;
    timestamped_signature: {
      signature: {
        r: string;
        s: string;
        v: string;
      };
      timestamp: number;
    };
    publisher_merkle_root: string;
    calculation_alg: {
      type: string;
      version: string;
      checksum: string;
    };
  };
  signed_prices?: Array<{
    publisher_key: string;
    external_asset_id: string;
    signature_type: string;
    price: string;
    timestamped_signature: {
      signature: {
        r: string;
        s: string;
        v: string;
      };
      timestamp: number;
    };
  }>;
}

export interface StorkLatestPricesResponse {
  data: Record<string, StorkPriceData>;
}

export interface StorkAsset {
  asset_id: string;
  name?: string;
  description?: string;
}

export interface StorkAssetsResponse {
  data: string[]; // Array of asset IDs
}

export interface StorkOHLCBar {
  time: number; // Unix timestamp in seconds
  open: string;
  high: string;
  low: string;
  close: string;
  volume?: string;
}

export interface StorkHistoryResponse {
  s: "ok" | "error";
  t: number[]; // timestamps
  o: number[]; // opens
  h: number[]; // highs
  l: number[]; // lows
  c: number[]; // closes
  v?: number[]; // volumes
}

/**
 * Normalized price data for agent consumption
 */
export interface MarketPrice {
  asset: string;
  price: bigint; // In 6 decimals (USDC compatible)
  priceFloat: number;
  timestamp: Date;
  priceChange24h?: number;
}

/**
 * Market sentiment derived from price data
 */
export type MarketSentiment = "bullish" | "bearish" | "neutral";

export interface MarketSentimentData {
  sentiment: MarketSentiment;
  ethPrice: MarketPrice;
  btcPrice: MarketPrice;
  ethChange24h: number;
  btcChange24h: number;
  timestamp: Date;
}
