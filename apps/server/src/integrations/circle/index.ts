/**
 * Circle Integration Module
 *
 * Re-exports all Circle wallet and transaction functionality
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
export {
  executeContractCall,
  getTransactionStatus,
  waitForConfirmation,
  executeAndConfirm,
  listWalletTransactions,
} from "./transactions";
export type {
  CircleWallet,
  TokenBalance,
  WalletInfo,
  AgentWalletInfo,
  ContractExecutionParams,
  TransactionResult,
  TransactionDetails,
  TransactionState,
  FeeLevel,
} from "./types";
