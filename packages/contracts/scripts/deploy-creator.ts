import hre from "hardhat";
import { formatEther } from "viem";
import * as fs from "fs";
import * as path from "path";

interface Deployment {
  contracts: {
    creatorFactory: `0x${string}`;
  };
}

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  console.log("Creating creator with account:", deployer.account.address);

  // Load deployment addresses
  const networkName = hre.network.name;
  const deploymentPath = path.join(
    __dirname,
    "..",
    "deployments",
    `${networkName}.json`
  );

  if (!fs.existsSync(deploymentPath)) {
    throw new Error(
      `Deployment file not found: ${deploymentPath}. Run deploy.ts first.`
    );
  }

  const deployment: Deployment = JSON.parse(
    fs.readFileSync(deploymentPath, "utf8")
  );

  // Get CreatorFactory contract
  const creatorFactory = await hre.viem.getContractAt(
    "CreatorFactory",
    deployment.contracts.creatorFactory
  );

  // Get command line arguments or use defaults
  const args = process.argv.slice(2);
  const name = args[0] || "Agent Alice";
  const symbol = args[1] || "ALICE";
  const wallet = (args[2] as `0x${string}`) || deployer.account.address;

  console.log(`\nCreating creator: ${name} (${symbol})`);
  console.log(`Creator wallet: ${wallet}`);

  // Create creator
  const hash = await creatorFactory.write.createCreator([name, symbol, wallet]);

  console.log("Transaction hash:", hash);
  console.log("Waiting for confirmation...");

  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log("Transaction confirmed in block:", receipt.blockNumber);

  // Get creator info
  const creatorInfo = await creatorFactory.read.getCreator([wallet]);

  console.log("\n=== CREATOR DEPLOYED ===");
  console.log(`Name: ${name}`);
  console.log(`Symbol: ${symbol}`);
  console.log(`Wallet: ${wallet}`);
  console.log(`Token: ${creatorInfo.token}`);
  console.log(`BondingCurve: ${creatorInfo.bondingCurve}`);
  console.log(`Created At: ${new Date(Number(creatorInfo.createdAt) * 1000).toISOString()}`);
  console.log("========================\n");

  // Append to deployment file
  const updatedDeployment = {
    ...deployment,
    creators: {
      ...(deployment as any).creators,
      [symbol.toLowerCase()]: {
        name,
        symbol,
        wallet,
        token: creatorInfo.token,
        bondingCurve: creatorInfo.bondingCurve,
        createdAt: Number(creatorInfo.createdAt),
      },
    },
  };

  fs.writeFileSync(deploymentPath, JSON.stringify(updatedDeployment, null, 2));
  console.log(`Creator info saved to: ${deploymentPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
