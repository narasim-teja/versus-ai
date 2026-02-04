import { z } from "zod";

const envSchema = z.object({
  // Chain
  ARC_TESTNET_RPC_URL: z.string().url().default("https://rpc.arc.testnet"),
  ARC_CHAIN_ID: z.coerce.number().default(5042002),

  // Contracts
  LENDING_POOL_ADDRESS: z.string().startsWith("0x"),
  REVENUE_DISTRIBUTOR_ADDRESS: z.string().startsWith("0x"),
  CREATOR_FACTORY_ADDRESS: z.string().startsWith("0x"),
  USDC_ADDRESS: z.string().startsWith("0x"),

  // Circle
  CIRCLE_API_KEY: z.string().min(1),
  CIRCLE_ENTITY_SECRET: z.string().min(1),
  CIRCLE_WALLET_SET_ID: z.string().min(1),

  // Stork
  STORK_API_KEY: z.string().min(1),
  STORK_REST_URL: z.string().url().default("https://rest.jp.stork-oracle.network"),

  // Agent Alice
  ALICE_PRIVATE_KEY: z.string().startsWith("0x"),
  ALICE_EVM_ADDRESS: z.string().startsWith("0x"),
  ALICE_TOKEN_ADDRESS: z.string().startsWith("0x"),
  ALICE_BONDING_CURVE_ADDRESS: z.string().startsWith("0x"),

  // Agent Bob
  BOB_PRIVATE_KEY: z.string().startsWith("0x"),
  BOB_EVM_ADDRESS: z.string().startsWith("0x"),
  BOB_TOKEN_ADDRESS: z.string().startsWith("0x"),
  BOB_BONDING_CURVE_ADDRESS: z.string().startsWith("0x"),

  // Database
  DATABASE_URL: z.string().default("file:./data/versus.db"),

  // Server
  PORT: z.coerce.number().default(3001),
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  FRONTEND_URL: z.string().url().optional(),
});

function loadEnv() {
  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    console.error("Environment validation failed:");
    console.error(result.error.format());
    throw new Error("Invalid environment configuration");
  }

  return result.data;
}

export const env = loadEnv();
export type Env = z.infer<typeof envSchema>;
