import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

export default buildModule("VersusCore", (m) => {
  // Network-specific parameters
  const usdcAddress = m.getParameter("usdcAddress");
  const treasury = m.getParameter("treasury");

  // 1. Deploy RevenueDistributor
  const revenueDistributor = m.contract("RevenueDistributor", [
    usdcAddress,
    treasury,
    m.getAccount(0), // owner
  ]);

  // 2. Deploy LendingPool
  const lendingPool = m.contract("LendingPool", [
    usdcAddress,
    m.getAccount(0), // owner
  ]);

  // 3. Deploy CreatorFactory
  const creatorFactory = m.contract("CreatorFactory", [
    usdcAddress,
    revenueDistributor,
    lendingPool,
    m.getAccount(0), // owner
  ]);

  // 4. Configure factory in RevenueDistributor
  m.call(revenueDistributor, "setFactory", [creatorFactory], {
    id: "RevenueDistributor_setFactory",
  });

  // 5. Configure factory in LendingPool
  m.call(lendingPool, "setFactory", [creatorFactory], {
    id: "LendingPool_setFactory",
  });

  // 6. Whitelist deployer as settler (for testing)
  m.call(revenueDistributor, "setWhitelistedSettler", [m.getAccount(0), true], {
    id: "RevenueDistributor_whitelistDeployer",
  });

  return { revenueDistributor, lendingPool, creatorFactory };
});
