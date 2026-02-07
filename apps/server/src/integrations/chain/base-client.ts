import {
  createPublicClient,
  createWalletClient,
  http,
  type Chain,
  type PublicClient,
  type WalletClient,
  type Transport,
  type Account,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { env } from "../../utils/env";
import { logger } from "../../utils/logger";

// Base Sepolia chain definition
export const baseSepolia: Chain = {
  id: 84532,
  name: "Base Sepolia",
  nativeCurrency: {
    decimals: 18,
    name: "ETH",
    symbol: "ETH",
  },
  rpcUrls: {
    default: {
      http: [process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"],
    },
  },
  blockExplorers: {
    default: {
      name: "Basescan",
      url: "https://sepolia.basescan.org",
    },
  },
  testnet: true,
};

// Singleton public client
let _basePublicClient: PublicClient | null = null;

export function getBasePublicClient(): PublicClient {
  if (!_basePublicClient) {
    _basePublicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
    });
    logger.info({ chainId: baseSepolia.id }, "Base Sepolia public client initialized");
  }
  return _basePublicClient;
}

// Singleton wallet client (reuses YELLOW_SERVER_PRIVATE_KEY)
let _baseWalletClient: WalletClient<Transport, Chain, Account> | null = null;

export function getBaseWalletClient(): WalletClient<Transport, Chain, Account> | null {
  if (!_baseWalletClient) {
    const privateKey = env.YELLOW_SERVER_PRIVATE_KEY;
    if (!privateKey) {
      logger.warn("No YELLOW_SERVER_PRIVATE_KEY set — Base Sepolia wallet client unavailable");
      return null;
    }
    const account = privateKeyToAccount(privateKey as `0x${string}`);
    _baseWalletClient = createWalletClient({
      account,
      chain: baseSepolia,
      transport: http(process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org"),
    });
    logger.info(
      { address: account.address, chainId: baseSepolia.id },
      "Base Sepolia wallet client initialized",
    );
  }
  return _baseWalletClient;
}
