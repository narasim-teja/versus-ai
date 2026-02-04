// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

interface ICreatorToken is IERC20 {
    /// @notice Returns the bonding curve address that can mint/burn tokens
    function bondingCurve() external view returns (address);

    /// @notice Returns the creator's wallet address
    function creator() external view returns (address);

    /// @notice Mints tokens to an address (only callable by bonding curve)
    /// @param to Address to mint tokens to
    /// @param amount Amount of tokens to mint
    function mint(address to, uint256 amount) external;

    /// @notice Burns tokens from an address (only callable by bonding curve)
    /// @param from Address to burn tokens from
    /// @param amount Amount of tokens to burn
    function burnFrom(address from, uint256 amount) external;
}
