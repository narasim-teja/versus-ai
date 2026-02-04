import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey();
const account = privateKeyToAccount(privateKey);

console.log("=== NEW DEPLOYER WALLET ===");
console.log("Address:", account.address);
console.log("Private Key:", privateKey);
console.log("\nAdd to .env:");
console.log(`PRIVATE_KEY=${privateKey}`);
console.log("\nFund this address on:");
console.log("- Base Sepolia ETH: https://www.alchemy.com/faucets/base-sepolia");
console.log("- Arc Testnet USDC: (Arc uses USDC as native gas token)");
