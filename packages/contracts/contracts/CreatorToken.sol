// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ERC20Burnable} from "@openzeppelin/contracts/token/ERC20/extensions/ERC20Burnable.sol";
import {ICreatorToken} from "./interfaces/ICreatorToken.sol";

/**
 * @title CreatorToken
 * @notice ERC20 token for creators with restricted minting/burning
 * @dev Only the bonding curve can mint and burn tokens
 */
contract CreatorToken is ERC20, ERC20Burnable, ICreatorToken {
    /// @notice The bonding curve contract that controls minting/burning
    address public override bondingCurve;

    /// @notice The creator's wallet address
    address public immutable override creator;

    /// @notice The factory that deployed this token (can set bondingCurve once)
    address public immutable factory;

    /// @notice Error thrown when caller is not the bonding curve
    error OnlyBondingCurve();

    /// @notice Error thrown when address is zero
    error ZeroAddress();

    /// @notice Error thrown when caller is not the factory
    error OnlyFactory();

    /// @notice Error thrown when bonding curve already set
    error BondingCurveAlreadySet();

    /**
     * @notice Creates a new creator token
     * @param name_ Token name (e.g., "Alice Token")
     * @param symbol_ Token symbol (e.g., "ALICE")
     * @param bondingCurve_ Address of the bonding curve contract (can be placeholder)
     * @param creator_ Address of the creator
     */
    constructor(
        string memory name_,
        string memory symbol_,
        address bondingCurve_,
        address creator_
    ) ERC20(name_, symbol_) {
        if (creator_ == address(0)) revert ZeroAddress();

        bondingCurve = bondingCurve_;
        creator = creator_;
        factory = msg.sender;
    }

    /**
     * @notice Sets the bonding curve address (can only be called once by factory)
     * @param bondingCurve_ The real bonding curve address
     */
    function setBondingCurve(address bondingCurve_) external {
        if (msg.sender != factory) revert OnlyFactory();
        if (bondingCurve != address(1)) revert BondingCurveAlreadySet();
        if (bondingCurve_ == address(0)) revert ZeroAddress();
        bondingCurve = bondingCurve_;
    }

    /**
     * @notice Modifier to restrict function access to bonding curve only
     */
    modifier onlyBondingCurve() {
        if (msg.sender != bondingCurve) revert OnlyBondingCurve();
        _;
    }

    /**
     * @notice Mints tokens to an address
     * @dev Only callable by the bonding curve
     * @param to Address to mint tokens to
     * @param amount Amount of tokens to mint (18 decimals)
     */
    function mint(address to, uint256 amount) external override onlyBondingCurve {
        _mint(to, amount);
    }

    /**
     * @notice Burns tokens from an address with allowance
     * @dev Overrides ERC20Burnable to add bonding curve restriction for external burns
     * @param from Address to burn tokens from
     * @param amount Amount of tokens to burn
     */
    function burnFrom(
        address from,
        uint256 amount
    ) public override(ERC20Burnable, ICreatorToken) {
        // Allow bonding curve to burn without allowance check
        if (msg.sender == bondingCurve) {
            _burn(from, amount);
        } else {
            // Standard burnFrom with allowance check for others
            super.burnFrom(from, amount);
        }
    }
}
