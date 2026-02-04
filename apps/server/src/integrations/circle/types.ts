/**
 * Circle Developer-Controlled Wallets Types
 *
 * Type definitions for Circle wallet operations
 */

export interface CircleWallet {
  id: string;
  address: string;
  blockchain: string;
  state: "LIVE" | "FROZEN";
  walletSetId: string;
  createDate: string;
  updateDate: string;
}

export interface TokenBalance {
  token: {
    id: string;
    name: string;
    symbol: string;
    decimals: number;
    blockchain: string;
    tokenAddress?: string;
    isNative: boolean;
  };
  amount: string;
  updateDate: string;
}

export interface CreateWalletRequest {
  walletSetId: string;
  blockchains: string[];
  count: number;
  accountType: "EOA" | "SCA";
  metadata?: Array<{
    name: string;
    refId: string;
  }>;
}

export interface CreateWalletResponse {
  wallets: CircleWallet[];
}

export interface ListWalletsResponse {
  wallets: CircleWallet[];
}

export interface GetBalanceResponse {
  tokenBalances: TokenBalance[];
}

export interface WalletInfo {
  id: string;
  address: string;
  blockchain: string;
  walletSetId: string;
}

export interface AgentWalletInfo extends WalletInfo {
  agentId: string;
  createdAt: Date;
}
