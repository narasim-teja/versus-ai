/**
 * Setup Agent Wallets Script
 *
 * Creates Circle wallets for Alice and Bob agents.
 * Run: bun run scripts/setup-agent-wallets.ts
 *
 * This script will:
 * 1. Create/retrieve Circle wallets for each agent
 * 2. Store wallet info in the database
 * 3. Output the wallet addresses for reference
 */

import { initializeDatabase } from "../src/db/client";
import { getOrCreateWallet, listWallets } from "../src/integrations/circle/wallet";
import { isCircleConfigured } from "../src/integrations/circle/client";

const AGENTS = ["alice", "bob"] as const;

async function main() {
  console.log("🚀 Agent Wallet Setup\n");
  console.log("=" .repeat(50));

  // Check Circle configuration
  if (!isCircleConfigured()) {
    console.error("❌ Circle SDK not configured!");
    console.log("\nMake sure you have set these environment variables:");
    console.log("  - CIRCLE_API_KEY");
    console.log("  - CIRCLE_ENTITY_SECRET");
    console.log("  - CIRCLE_WALLET_SET_ID");
    process.exit(1);
  }

  console.log("✅ Circle SDK configured\n");

  // Initialize database first
  console.log("📦 Initializing database...");
  initializeDatabase();
  console.log("✅ Database ready\n");

  // List existing wallets for reference
  console.log("📋 Checking existing wallets in wallet set...");
  const existingWallets = await listWallets();
  if (existingWallets.length > 0) {
    console.log(`   Found ${existingWallets.length} existing wallet(s):`);
    for (const w of existingWallets) {
      console.log(`   - ${w.id}: ${w.address}`);
    }
  } else {
    console.log("   No existing wallets found.");
  }
  console.log("");

  // Create wallets for each agent
  const walletInfo: Record<string, { id: string; address: string }> = {};

  for (const agentId of AGENTS) {
    console.log(`\n🔧 Setting up wallet for ${agentId}...`);

    try {
      const wallet = await getOrCreateWallet(agentId);
      walletInfo[agentId] = {
        id: wallet.id,
        address: wallet.address,
      };

      console.log(`   ✅ Wallet ready:`);
      console.log(`      ID: ${wallet.id}`);
      console.log(`      Address: ${wallet.address}`);
      console.log(`      Blockchain: ${wallet.blockchain}`);
    } catch (error: any) {
      console.error(`   ❌ Failed to create wallet for ${agentId}:`, error.message);
    }
  }

  // Summary
  console.log("\n" + "=" .repeat(50));
  console.log("\n🎉 Wallet Setup Complete!\n");

  console.log("Agent Wallet Addresses:");
  console.log("─".repeat(50));
  for (const [agentId, info] of Object.entries(walletInfo)) {
    console.log(`${agentId.toUpperCase()}: ${info.address}`);
  }
  console.log("─".repeat(50));

  console.log("\n📝 Notes:");
  console.log("  - Wallets are stored in the database (circle_wallets table)");
  console.log("  - The agent runtime will automatically use these wallets");
  console.log("  - Fund these addresses with testnet USDC to start operations");

  // If we have wallet addresses, show env var suggestions
  if (Object.keys(walletInfo).length > 0) {
    console.log("\n💡 You can update your .env with the Circle wallet addresses:");
    for (const [agentId, info] of Object.entries(walletInfo)) {
      console.log(`# ${agentId.toUpperCase()} Circle Wallet: ${info.address}`);
    }
  }
}

main().catch((error) => {
  console.error("Setup failed:", error);
  process.exit(1);
});
