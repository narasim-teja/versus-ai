import { z } from "zod";

const envSchema = z.object({
  // Chain
  ARC_TESTNET_RPC_URL: z.string().url().default("https://rpc.testnet.arc.network"),
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

  // Agent Alice - Token/BondingCurve addresses (EVM address comes from Circle wallet)
  ALICE_TOKEN_ADDRESS: z.string().startsWith("0x"),
  ALICE_BONDING_CURVE_ADDRESS: z.string().startsWith("0x"),
  ALICE_WALLET_ADDRESS: z.string().startsWith("0x").optional(),

  // Agent Bob - Token/BondingCurve addresses (EVM address comes from Circle wallet)
  BOB_TOKEN_ADDRESS: z.string().startsWith("0x"),
  BOB_BONDING_CURVE_ADDRESS: z.string().startsWith("0x"),
  BOB_WALLET_ADDRESS: z.string().startsWith("0x").optional(),

  // OpenRouter (optional - falls back to rule-based decisions if not set)
  OPENROUTER_API_KEY: z.string().min(1).optional(),
  OPENROUTER_MODEL: z.string().default("anthropic/claude-sonnet-4-5-20250929"),

  // Yellow Network (state channel payments - optional, falls back to bearer auth)
  YELLOW_CLEARNODE_URL: z.string().url().default("wss://clearnet-sandbox.yellow.com/ws"),
  YELLOW_SERVER_PRIVATE_KEY: z.string().startsWith("0x").optional(),
  YELLOW_ASSET: z.string().default("ytest.usd"),
  YELLOW_PRICE_PER_SEGMENT: z.string().default("0.01"),

  // Base Sepolia (on-chain video registry + bridge escrow)
  BASE_SEPOLIA_RPC_URL: z.string().url().default("https://sepolia.base.org"),
  VIDEO_REGISTRY_ADDRESS: z.string().startsWith("0x").optional(),
  BRIDGE_ESCROW_ADDRESS: z.string().startsWith("0x").optional(),
  BASE_SEPOLIA_USDC_ADDRESS: z.string().startsWith("0x").default("0x036CbD53842c5426634e7929541eC2318f3dCF7e"),

  // Nitrolite Custody/Adjudicator (on-chain state channels - Base Sepolia)
  NITROLITE_CUSTODY_ADDRESS: z.string().startsWith("0x").default("0x019B65A265EB3363822f2752141b3dF16131b262"),
  NITROLITE_ADJUDICATOR_ADDRESS: z.string().startsWith("0x").default("0x7c7ccbc98469190849BCC6c926307794fDfB11F2"),

  // Supabase (video storage)
  SUPABASE_URL: z.string().url().optional(),
  SUPABASE_SERVICE_KEY: z.string().min(1).optional(),
  SUPABASE_STORAGE_BUCKET: z.string().default("videos"),

  // LTX-2 Video Generation (autonomous video creation)
  LTX_API_KEY: z.string().min(1).optional(),

  // Gemini Image Generation (video thumbnails)
  GEMINI_API_KEY: z.string().min(1).optional(),

  // Video Generation Schedule
  VIDEO_GEN_INTERVAL_MS: z.coerce.number().default(14_400_000), // 4 hours
  VIDEO_GEN_OFFSET_MS: z.coerce.number().default(7_200_000),    // 2 hour stagger

  // Video processing
  VIDEO_SEGMENT_DURATION: z.coerce.number().default(5),
  VIDEO_QUALITY: z.string().default("720p"),

  // Database (Supabase PostgreSQL)
  DATABASE_URL: z.string().url(),

  // Encryption (for encrypting master secrets at rest)
  ENCRYPTION_KEY: z.string().length(64).regex(/^[0-9a-fA-F]{64}$/, "Must be a 32-byte hex string"),

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
