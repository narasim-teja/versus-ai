/**
 * Circle Entity Secret Setup Script
 *
 * This script helps you:
 * 1. Generate a new Entity Secret
 * 2. Register it with Circle
 * 3. Create a Wallet Set for the agents
 *
 * Run with: bun run scripts/setup-circle.ts
 */

import {
  generateEntitySecret,
  registerEntitySecretCiphertext,
  initiateDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";
import { resolve } from "path";

const RECOVERY_FILE_PATH = resolve(__dirname, "../.circle-recovery");

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;

  if (!apiKey || apiKey === "your_api_key") {
    console.error("❌ CIRCLE_API_KEY not set in environment");
    console.log("\nGet your API key from: https://console.circle.com/");
    console.log("Then set it: export CIRCLE_API_KEY='your_key'");
    process.exit(1);
  }

  console.log("🔐 Circle Entity Secret Setup\n");
  console.log("=" .repeat(50));

  // Step 1: Generate Entity Secret
  console.log("\n📝 Step 1: Generating Entity Secret...\n");
  const entitySecret = generateEntitySecret();
  console.log("✅ Entity Secret generated:");
  console.log(`   ${entitySecret}\n`);
  console.log("⚠️  SAVE THIS SECURELY! Circle cannot recover it for you.\n");

  // Step 2: Register Entity Secret
  console.log("📝 Step 2: Registering Entity Secret with Circle...\n");

  try {
    const response = await registerEntitySecretCiphertext({
      apiKey,
      entitySecret,
      recoveryFileDownloadPath: RECOVERY_FILE_PATH,
    });

    console.log("✅ Entity Secret registered successfully!");
    console.log(`   Recovery file saved to: ${RECOVERY_FILE_PATH}\n`);

    if (response.data?.recoveryFile) {
      console.log("📁 Recovery file contents (also save this):");
      console.log(`   ${response.data.recoveryFile.substring(0, 50)}...\n`);
    }
  } catch (error: any) {
    if (error.message?.includes("already registered")) {
      console.log("ℹ️  Entity Secret already registered. Using existing one.\n");
    } else {
      console.error("❌ Failed to register Entity Secret:", error.message);
      process.exit(1);
    }
  }

  // Step 3: Create Wallet Set
  console.log("📝 Step 3: Creating Wallet Set for agents...\n");

  const client = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });

  try {
    const walletSetResponse = await client.createWalletSet({
      name: "versus-agents",
    });

    if (walletSetResponse.data?.walletSet) {
      const walletSet = walletSetResponse.data.walletSet;
      console.log("✅ Wallet Set created:");
      console.log(`   ID: ${walletSet.id}`);
      console.log(`   Name: ${walletSet.name}\n`);

      // Print final env vars
      console.log("=" .repeat(50));
      console.log("\n🎉 Setup Complete! Add these to your .env file:\n");
      console.log(`CIRCLE_API_KEY=${apiKey}`);
      console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
      console.log(`CIRCLE_WALLET_SET_ID=${walletSet.id}`);
      console.log("\n" + "=" .repeat(50));
    }
  } catch (error: any) {
    console.error("❌ Failed to create Wallet Set:", error.message);

    // Still print the entity secret for manual setup
    console.log("\n" + "=" .repeat(50));
    console.log("\n⚠️  Wallet Set creation failed, but Entity Secret is ready.");
    console.log("You can create a Wallet Set manually in the Circle Console.\n");
    console.log("Add these to your .env file:\n");
    console.log(`CIRCLE_API_KEY=${apiKey}`);
    console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
    console.log(`CIRCLE_WALLET_SET_ID=<create_in_console>`);
    console.log("\n" + "=" .repeat(50));
  }
}

// Also export a function to just list existing wallet sets
export async function listWalletSets() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || !entitySecret) {
    console.error("Missing CIRCLE_API_KEY or CIRCLE_ENTITY_SECRET");
    return;
  }

  const client = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });

  const response = await client.listWalletSets({});
  console.log("Existing Wallet Sets:");
  console.log(JSON.stringify(response.data, null, 2));
}

// Run if called directly
main().catch(console.error);
