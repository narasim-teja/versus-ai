/**
 * Generate Circle Entity Secret
 *
 * Simple script to generate an entity secret.
 * Run: bun run scripts/generate-entity-secret.ts
 */

import { generateEntitySecret } from "@circle-fin/developer-controlled-wallets";

console.log("🔐 Generating Circle Entity Secret...\n");

const entitySecret = generateEntitySecret();

console.log("Your Entity Secret (32-byte hex):");
console.log("─".repeat(70));
console.log(entitySecret);
console.log("─".repeat(70));
console.log("\n⚠️  IMPORTANT: Save this securely! Circle cannot recover it.\n");
console.log("Next steps:");
console.log("1. Copy this entity secret");
console.log("2. Run: bun run scripts/register-entity-secret.ts");
console.log("   OR register via Circle Console: https://console.circle.com/");
