import hre from "hardhat";
import { formatEther, parseUnits } from "viem";
import * as fs from "fs";
import * as path from "path";

interface Deployment {
  contracts: {
    creatorFactory: `0x${string}`;
    usdc: `0x${string}`;
  };
}

async function main() {
  const [deployer] = await hre.viem.getWalletClients();
  const publicClient = await hre.viem.getPublicClient();

  console.log("Seeding data with account:", deployer.account.address);

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

  console.log("\n--- Creating Agent Creators ---\n");

  // Create Alice (Academic/Conservative strategy)
  console.log("1. Creating Agent Alice (Academic)...");
  const aliceWallet = deployer.account.address; // In production, use separate wallets

  try {
    const aliceHash = await creatorFactory.write.createCreator([
      "Agent Alice",
      "ALICE",
      aliceWallet,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: aliceHash });
    const aliceInfo = await creatorFactory.read.getCreator([aliceWallet]);
    console.log(`   Token: ${aliceInfo.token}`);
    console.log(`   BondingCurve: ${aliceInfo.bondingCurve}`);
  } catch (e: any) {
    if (e.message?.includes("CreatorExists")) {
      console.log("   Alice already exists, skipping...");
    } else {
      throw e;
    }
  }

  // For Bob, we need a different wallet address
  // In real setup, this would be a separate wallet
  // For testing, we'll derive a different address
  const bobWallet = "0x0000000000000000000000000000000000000002" as `0x${string}`;

  console.log("2. Creating Agent Bob (Degen)...");
  try {
    const bobHash = await creatorFactory.write.createCreator([
      "Agent Bob",
      "BOB",
      bobWallet,
    ]);
    await publicClient.waitForTransactionReceipt({ hash: bobHash });
    const bobInfo = await creatorFactory.read.getCreator([bobWallet]);
    console.log(`   Token: ${bobInfo.token}`);
    console.log(`   BondingCurve: ${bobInfo.bondingCurve}`);
  } catch (e: any) {
    if (e.message?.includes("CreatorExists")) {
      console.log("   Bob already exists, skipping...");
    } else {
      throw e;
    }
  }

  console.log("\n--- Seed Complete ---\n");

  // Get all creators
  const creatorCount = await creatorFactory.read.getCreatorCount();
  console.log(`Total creators: ${creatorCount}`);

  const allCreators = await creatorFactory.read.getAllCreators();
  console.log("All creator wallets:", allCreators);

  // Update deployment file with creator info
  const updatedDeployment: any = { ...deployment, creators: {} };

  for (const wallet of allCreators) {
    const info = await creatorFactory.read.getCreator([wallet]);
    const token = await hre.viem.getContractAt("CreatorToken", info.token);
    const symbol = await token.read.symbol();
    const name = await token.read.name();

    updatedDeployment.creators[symbol.toLowerCase()] = {
      name,
      symbol,
      wallet,
      token: info.token,
      bondingCurve: info.bondingCurve,
      createdAt: Number(info.createdAt),
    };
  }

  fs.writeFileSync(deploymentPath, JSON.stringify(updatedDeployment, null, 2));
  console.log(`\nDeployment updated: ${deploymentPath}`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
