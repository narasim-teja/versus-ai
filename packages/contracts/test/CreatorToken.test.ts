import { loadFixture } from "@nomicfoundation/hardhat-toolbox-viem/network-helpers";
import { expect } from "chai";
import hre from "hardhat";
import { getAddress, parseEther } from "viem";

describe("CreatorToken", function () {
  async function deployCreatorTokenFixture() {
    const [owner, bondingCurve, creator, user] =
      await hre.viem.getWalletClients();
    const publicClient = await hre.viem.getPublicClient();

    const creatorToken = await hre.viem.deployContract("CreatorToken", [
      "Test Creator",
      "TEST",
      bondingCurve.account.address,
      creator.account.address,
    ]);

    return {
      creatorToken,
      owner,
      bondingCurve,
      creator,
      user,
      publicClient,
    };
  }

  describe("Deployment", function () {
    it("Should set the correct name and symbol", async function () {
      const { creatorToken } = await loadFixture(deployCreatorTokenFixture);

      expect(await creatorToken.read.name()).to.equal("Test Creator");
      expect(await creatorToken.read.symbol()).to.equal("TEST");
    });

    it("Should set the correct bonding curve address", async function () {
      const { creatorToken, bondingCurve } = await loadFixture(
        deployCreatorTokenFixture
      );

      expect(await creatorToken.read.bondingCurve()).to.equal(
        getAddress(bondingCurve.account.address)
      );
    });

    it("Should set the correct creator address", async function () {
      const { creatorToken, creator } = await loadFixture(
        deployCreatorTokenFixture
      );

      expect(await creatorToken.read.creator()).to.equal(
        getAddress(creator.account.address)
      );
    });

    it("Should revert on zero creator address", async function () {
      const [bondingCurve] = await hre.viem.getWalletClients();

      await expect(
        hre.viem.deployContract("CreatorToken", [
          "Test",
          "TEST",
          bondingCurve.account.address,
          "0x0000000000000000000000000000000000000000",
        ])
      ).to.be.rejectedWith("ZeroAddress");
    });
  });

  describe("Minting", function () {
    it("Should allow bonding curve to mint tokens", async function () {
      const { creatorToken, bondingCurve, user } = await loadFixture(
        deployCreatorTokenFixture
      );

      const amount = parseEther("1000");

      // Get contract instance connected to bonding curve
      const tokenAsBondingCurve = await hre.viem.getContractAt(
        "CreatorToken",
        creatorToken.address,
        { client: { wallet: bondingCurve } }
      );

      await tokenAsBondingCurve.write.mint([user.account.address, amount]);

      expect(await creatorToken.read.balanceOf([user.account.address])).to.equal(
        amount
      );
    });

    it("Should revert if non-bonding-curve tries to mint", async function () {
      const { creatorToken, user } = await loadFixture(
        deployCreatorTokenFixture
      );

      const tokenAsUser = await hre.viem.getContractAt(
        "CreatorToken",
        creatorToken.address,
        { client: { wallet: user } }
      );

      // Custom errors show as hex selector in viem errors
      await expect(
        tokenAsUser.write.mint([user.account.address, parseEther("100")])
      ).to.be.rejected;
    });
  });

  describe("Burning", function () {
    it("Should allow bonding curve to burn tokens without allowance", async function () {
      const { creatorToken, bondingCurve, user } = await loadFixture(
        deployCreatorTokenFixture
      );

      const amount = parseEther("1000");

      // Mint first
      const tokenAsBondingCurve = await hre.viem.getContractAt(
        "CreatorToken",
        creatorToken.address,
        { client: { wallet: bondingCurve } }
      );

      await tokenAsBondingCurve.write.mint([user.account.address, amount]);

      // Burn without needing allowance
      await tokenAsBondingCurve.write.burnFrom([
        user.account.address,
        parseEther("500"),
      ]);

      expect(await creatorToken.read.balanceOf([user.account.address])).to.equal(
        parseEther("500")
      );
    });

    it("Should allow users to burn their own tokens", async function () {
      const { creatorToken, bondingCurve, user } = await loadFixture(
        deployCreatorTokenFixture
      );

      const amount = parseEther("1000");

      // Mint first
      const tokenAsBondingCurve = await hre.viem.getContractAt(
        "CreatorToken",
        creatorToken.address,
        { client: { wallet: bondingCurve } }
      );

      await tokenAsBondingCurve.write.mint([user.account.address, amount]);

      // User burns their own tokens
      const tokenAsUser = await hre.viem.getContractAt(
        "CreatorToken",
        creatorToken.address,
        { client: { wallet: user } }
      );

      await tokenAsUser.write.burn([parseEther("300")]);

      expect(await creatorToken.read.balanceOf([user.account.address])).to.equal(
        parseEther("700")
      );
    });
  });
});
