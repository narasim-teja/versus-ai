// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title BridgeEscrow
 * @notice Demonstrates cross-chain USDC flow via CCTP pattern
 * @dev Locks USDC on Base Sepolia, emits event for bridge to ARC testnet.
 *      In production this would use Circle's CCTP MessageTransmitter.
 */
contract BridgeEscrow is Ownable {
    using SafeERC20 for IERC20;

    address public immutable usdc;
    uint256 public bridgeNonce;

    event BridgeInitiated(
        uint256 indexed nonce,
        uint256 amount,
        uint32 sourceChainId,
        uint32 destinationChainId,
        address indexed creator,
        address indexed creatorToken
    );

    constructor(address usdc_, address owner_) Ownable(owner_) {
        usdc = usdc_;
    }

    function initiateBridge(
        uint256 amount,
        uint32 destinationChainId,
        address creator,
        address creatorToken
    ) external onlyOwner {
        IERC20(usdc).safeTransferFrom(msg.sender, address(this), amount);
        bridgeNonce++;
        emit BridgeInitiated(
            bridgeNonce,
            amount,
            uint32(block.chainid),
            destinationChainId,
            creator,
            creatorToken
        );
    }

    function withdraw(address to, uint256 amount) external onlyOwner {
        IERC20(usdc).safeTransfer(to, amount);
    }
}
