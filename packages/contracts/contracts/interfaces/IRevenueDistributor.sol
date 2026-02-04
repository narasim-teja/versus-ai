// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IRevenueDistributor {
    // Events
    event RevenueDistributed(
        address indexed token,
        uint256 totalAmount,
        uint256 creatorAmount,
        uint256 holderAmount,
        uint256 protocolAmount
    );
    event CreatorRegistered(
        address indexed token,
        address indexed bondingCurve,
        address indexed creatorWallet
    );
    event SettlerWhitelisted(address indexed settler, bool status);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);

    // Constants
    function CREATOR_SHARE() external view returns (uint256);
    function HOLDER_SHARE() external view returns (uint256);
    function PROTOCOL_SHARE() external view returns (uint256);

    // View functions
    /// @notice Returns the USDC token address
    function usdc() external view returns (address);

    /// @notice Returns the protocol treasury address
    function treasury() external view returns (address);

    /// @notice Returns the creator wallet for a token
    /// @param token Creator token address
    function creatorWallets(address token) external view returns (address);

    /// @notice Returns the bonding curve for a token
    /// @param token Creator token address
    function bondingCurves(address token) external view returns (address);

    /// @notice Returns whether an address is a whitelisted settler
    /// @param settler Address to check
    function whitelistedSettlers(address settler) external view returns (bool);

    // State-changing functions
    /// @notice Distribute revenue for a creator (only whitelisted settlers)
    /// @param token Creator token address
    /// @param amount Total USDC amount to distribute
    function distributeRevenue(address token, uint256 amount) external;

    // Admin functions
    /// @notice Register a new creator (only owner)
    /// @param token Creator token address
    /// @param bondingCurve Bonding curve address
    /// @param creatorWallet Creator's wallet address
    function registerCreator(
        address token,
        address bondingCurve,
        address creatorWallet
    ) external;

    /// @notice Whitelist or remove a settler (only owner)
    /// @param settler Address to whitelist
    /// @param status True to whitelist, false to remove
    function setWhitelistedSettler(address settler, bool status) external;

    /// @notice Update the treasury address (only owner)
    /// @param newTreasury New treasury address
    function setTreasury(address newTreasury) external;
}
