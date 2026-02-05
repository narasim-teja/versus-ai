/**
 * Register Circle Entity Secret
 *
 * Registers your entity secret with Circle and creates a wallet set.
 *
 * Required env vars:
 *   CIRCLE_API_KEY - Your Circle API key
 *   CIRCLE_ENTITY_SECRET - The entity secret to register (from generate-entity-secret.ts)
 *
 * Run: CIRCLE_ENTITY_SECRET=xxx bun run scripts/register-entity-secret.ts
 */

import {
  registerEntitySecretCiphertext,
  initiateDeveloperControlledWalletsClient,
} from "@circle-fin/developer-controlled-wallets";
import { resolve } from "path";
import { existsSync, mkdirSync } from "fs";

const RECOVERY_DIR = resolve(__dirname, "../.circle-recovery");

async function main() {
  const apiKey = process.env.CIRCLE_API_KEY;
  const entitySecret = process.env.CIRCLE_ENTITY_SECRET;

  if (!apiKey || apiKey.includes("your_")) {
    console.error("❌ CIRCLE_API_KEY not set");
    console.log("Get your API key from: https://console.circle.com/");
    process.exit(1);
  }

  if (!entitySecret || entitySecret.includes("your_")) {
    console.error("❌ CIRCLE_ENTITY_SECRET not set");
    console.log("Run: bun run scripts/generate-entity-secret.ts");
    process.exit(1);
  }

  // Ensure recovery directory exists
  if (!existsSync(RECOVERY_DIR)) {
    mkdirSync(RECOVERY_DIR, { recursive: true });
  }

  console.log("🔐 Circle Entity Secret Registration\n");
  console.log("=" .repeat(50));

  // Step 1: Register Entity Secret
  console.log("\n📝 Registering Entity Secret with Circle...\n");

  try {
    const response = await registerEntitySecretCiphertext({
      apiKey,
      entitySecret,
      recoveryFileDownloadPath: RECOVERY_DIR,
    });

    console.log("✅ Entity Secret registered successfully!");
    console.log(`📁 Recovery file saved to: ${RECOVERY_DIR}\n`);

    if (response.data?.recoveryFile) {
      console.log("Recovery file ID:", response.data.recoveryFile.substring(0, 50) + "...");
    }
  } catch (error: any) {
    // Check if already registered
    if (error.response?.data?.code === 155104 || error.message?.includes("already")) {
      console.log("ℹ️  Entity Secret is already registered. Continuing...\n");
    } else {
      console.error("❌ Registration failed:", error.response?.data || error.message);
      process.exit(1);
    }
  }

  // Step 2: Create Wallet Set
  console.log("📝 Creating Wallet Set for agents...\n");

  const client = initiateDeveloperControlledWalletsClient({
    apiKey,
    entitySecret,
  });

  try {
    // First check if wallet set already exists
    const existingSets = await client.listWalletSets({});
    const versusSet = existingSets.data?.walletSets?.find(
      (ws) => ws.name === "versus-agents"
    );

    if (versusSet) {
      console.log("ℹ️  Wallet Set 'versus-agents' already exists:");
      console.log(`   ID: ${versusSet.id}\n`);
      printEnvVars(apiKey, entitySecret, versusSet.id);
      return;
    }

    // Create new wallet set
    const walletSetResponse = await client.createWalletSet({
      name: "versus-agents",
    });

    if (walletSetResponse.data?.walletSet) {
      const walletSet = walletSetResponse.data.walletSet;
      console.log("✅ Wallet Set created:");
      console.log(`   ID: ${walletSet.id}`);
      console.log(`   Name: ${walletSet.name}\n`);

      printEnvVars(apiKey, entitySecret, walletSet.id);
    }
  } catch (error: any) {
    console.error("❌ Failed to create Wallet Set:", error.response?.data || error.message);
    console.log("\nYou can create one manually at: https://console.circle.com/\n");
    printEnvVars(apiKey, entitySecret, "<create_in_console>");
  }
}

function printEnvVars(apiKey: string, entitySecret: string, walletSetId: string) {
  console.log("=" .repeat(50));
  console.log("\n🎉 Setup Complete! Update your .env file:\n");
  console.log("─".repeat(50));
  console.log(`CIRCLE_API_KEY=${apiKey}`);
  console.log(`CIRCLE_ENTITY_SECRET=${entitySecret}`);
  console.log(`CIRCLE_WALLET_SET_ID=${walletSetId}`);
  console.log("─".repeat(50));
  console.log("\n" + "=" .repeat(50));
}

main().catch(console.error);
