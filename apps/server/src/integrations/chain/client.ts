import {
  createPublicClient,
  createWalletClient,
  http,
  nonceManager,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { logger } from "../../utils/logger";

// Arc Testnet chain definition
export const arcTestnet: Chain = {
  id: 5042002,
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "ETH",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: [process.env.ARC_TESTNET_RPC_URL || "https://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "Arc Explorer",
      url: "https://explorer-testnet.arc.dev",
    },
  },
  testnet: true,
};

// Singleton public client for read operations
let _publicClient: PublicClient | null = null;

/**
 * Get the public client for read operations
 */
export function getPublicClient(): PublicClient {
  if (!_publicClient) {
    _publicClient = createPublicClient({
      chain: arcTestnet,
      transport: http(process.env.ARC_TESTNET_RPC_URL),
    });
    logger.info({ chainId: arcTestnet.id }, "Public client initialized");
  }
  return _publicClient;
}

/**
 * Create a wallet client for a specific agent (for signing transactions)
 */
export function createAgentWalletClient(
  privateKey: `0x${string}`
): WalletClient<Transport, Chain, Account> {
  const account = privateKeyToAccount(privateKey);
  account.nonceManager = nonceManager;
  return createWalletClient({
    account,
    chain: arcTestnet,
    transport: http(process.env.ARC_TESTNET_RPC_URL),
  });
}

/**
 * Get block number for health checks
 */
export async function getBlockNumber(): Promise<bigint> {
  const client = getPublicClient();
  return client.getBlockNumber();
}

/**
 * Get ETH balance for an address
 */
export async function getEthBalance(address: `0x${string}`): Promise<bigint> {
  const client = getPublicClient();
  return client.getBalance({ address });
}

export type { PublicClient, WalletClient };
