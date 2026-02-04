/**
 * Circle Integration Module
 *
 * Re-exports all Circle wallet functionality
 */

export { getCircleClient, isCircleConfigured, getWalletSetId } from "./client";
export {
  getOrCreateWallet,
  getWallet,
  getWalletBalances,
  getUsdcBalance,
  listWallets,
  getWalletByAgentId,
} from "./wallet";
export type {
  CircleWallet,
  TokenBalance,
  WalletInfo,
  AgentWalletInfo,
} from "./types";
