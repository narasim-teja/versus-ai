// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title VideoRegistry
 * @notice On-chain commitment of video merkle roots and settlement records
 * @dev Deployed on Base Sepolia alongside Yellow Network Custody/Adjudicator
 */
contract VideoRegistry is Ownable {
    struct VideoCommitment {
        bytes32 merkleRoot;
        address creator;
        uint256 totalSegments;
        uint256 timestamp;
    }

    mapping(bytes32 => VideoCommitment) public videos;
    bytes32[] public videoIds;

    event VideoRegistered(
        bytes32 indexed videoIdHash,
        bytes32 merkleRoot,
        address indexed creator,
        uint256 totalSegments
    );

    event SettlementRecorded(
        bytes32 indexed videoIdHash,
        address indexed viewer,
        uint256 segmentsWatched,
        uint256 totalPaid,
        string yellowSessionId
    );

    constructor(address owner_) Ownable(owner_) {}

    function registerVideo(
        bytes32 videoIdHash,
        bytes32 merkleRoot,
        address creator,
        uint256 totalSegments
    ) external onlyOwner {
        videos[videoIdHash] = VideoCommitment({
            merkleRoot: merkleRoot,
            creator: creator,
            totalSegments: totalSegments,
            timestamp: block.timestamp
        });
        videoIds.push(videoIdHash);
        emit VideoRegistered(videoIdHash, merkleRoot, creator, totalSegments);
    }

    function recordSettlement(
        bytes32 videoIdHash,
        address viewer,
        uint256 segmentsWatched,
        uint256 totalPaid,
        string calldata yellowSessionId
    ) external onlyOwner {
        emit SettlementRecorded(videoIdHash, viewer, segmentsWatched, totalPaid, yellowSessionId);
    }

    function getVideo(bytes32 videoIdHash) external view returns (VideoCommitment memory) {
        return videos[videoIdHash];
    }

    function getVideoCount() external view returns (uint256) {
        return videoIds.length;
    }
}
