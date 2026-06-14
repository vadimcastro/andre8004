// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {FunctionsClient} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/FunctionsClient.sol";
import {ConfirmedOwner} from "@chainlink/contracts/src/v0.8/shared/access/ConfirmedOwner.sol";
import {FunctionsRequest} from "@chainlink/contracts/src/v0.8/functions/dev/v1_0_0/libraries/FunctionsRequest.sol";

/**
 * @title andre8004
 * @notice Verification oracle contract for andre8004 AI agent trust scoring.
 * @dev Inherits from Chainlink FunctionsClient to support decentralized Merkle Root updates.
 */
contract andre8004 is FunctionsClient, ConfirmedOwner {
    using FunctionsRequest for FunctionsRequest.Request;

    // Mapping of epochId => Merkle Root bytes32
    mapping(uint256 => bytes32) public epochRoots;
    
    // Store current active epoch
    uint256 public currentEpoch;

    // Chainlink Functions subscription details
    uint64 public subscriptionId;
    uint32 public gasLimit = 300000;
    bytes32 public donId;

    // Record of last generated request ID
    bytes32 public lastRequestId;
    
    // Events
    event MerkleRootUpdated(uint256 indexed epochId, bytes32 root);
    event Response(bytes32 indexed requestId, bytes response, bytes err);

    constructor(
        address router,
        bytes32 _donId
    ) FunctionsClient(router) ConfirmedOwner(msg.sender) {
        donId = _donId;
    }

    /**
     * @notice Set Chainlink Functions subscription details
     */
    function setSubscriptionDetails(uint64 _subscriptionId, uint32 _gasLimit) external onlyOwner {
        subscriptionId = _subscriptionId;
        gasLimit = _gasLimit;
    }

    /**
     * @notice Set the DON ID
     */
    function setDonId(bytes32 _donId) external onlyOwner {
        donId = _donId;
    }

    /**
     * @notice Triggers a decentralized request to fetch the Merkle Root from our Bun backend.
     * @param source The JavaScript code block to run on Chainlink DON nodes.
     * @param secrets Encrypted secrets if needed (optional).
     * @param args Arguments to pass to the JS script (e.g. [ "1" ] for epoch 1).
     */
    function requestEpochRootUpdate(
        string calldata source,
        bytes calldata secrets,
        string[] calldata args
    ) external onlyOwner returns (bytes32 requestId) {
        FunctionsRequest.Request memory req;
        req.initializeRequestForInlineJavaScript(source);
        if (secrets.length > 0) {
            req.addSecretsReference(secrets);
        }
        if (args.length > 0) {
            req.setArgs(args);
        }

        lastRequestId = _sendRequest(
            req.encodeCBOR(),
            subscriptionId,
            gasLimit,
            donId
        );
        return lastRequestId;
    }

    /**
     * @notice Callback invoked by Chainlink Functions Router when the DON returns the Merkle Root.
     * @param requestId The request ID matching the update request.
     * @param response The response returned by the DON (32-byte Merkle root).
     * @param err Any error encountered by the DON.
     */
    function fulfillRequest(
        bytes32 requestId,
        bytes memory response,
        bytes memory err
    ) override internal {
        if (requestId == lastRequestId) {
            emit Response(requestId, response, err);
            
            if (err.length == 0 && response.length == 32) {
                // Parse 32-byte Merkle root and increment epoch
                bytes32 newRoot = bytes32(response);
                currentEpoch++;
                epochRoots[currentEpoch] = newRoot;
                emit MerkleRootUpdated(currentEpoch, newRoot);
            }
        }
    }

    /**
     * @notice Directly set Merkle root for testing or emergency bypass (backup).
     */
    function manualUpdateRoot(uint256 epochId, bytes32 newRoot) external onlyOwner {
        epochRoots[epochId] = newRoot;
        if (epochId > currentEpoch) {
            currentEpoch = epochId;
        }
        emit MerkleRootUpdated(epochId, newRoot);
    }

    /**
     * @notice Verifies if an agent's reputation claim matches the verified on-chain root.
     * @param epochId The epoch ID when the claim was generated.
     * @param targetAgent The wallet address of the target agent.
     * @param score The decimal-adjusted score (multiplied by 10^4).
     * @param x402Capable Boolean capability state.
     * @param proof The Merkle path proof array.
     */
    function verifyAgent(
        uint256 epochId,
        address targetAgent,
        int256 score,
        bool x402Capable,
        bytes32[] calldata proof
    ) external view returns (bool) {
        bytes32 root = epochRoots[epochId];
        if (root == bytes32(0)) {
            return false;
        }

        // Reconstruct the leaf hash exactly as done in merkle.ts
        bytes32 leaf = keccak256(
            abi.encodePacked(epochId, targetAgent, score, x402Capable)
        );

        // Standard OpenZeppelin-style verification with sorted pairs
        return verifyProof(proof, root, leaf);
    }

    /**
     * @notice Cryptographic Merkle proof verification helper.
     */
    function verifyProof(
        bytes32[] memory proof,
        bytes32 root,
        bytes32 leaf
    ) internal pure returns (bool) {
        bytes32 computedHash = leaf;

        for (uint256 i = 0; i < proof.length; i++) {
            bytes32 proofElement = proof[i];

            if (computedHash <= proofElement) {
                // Hash computedHash and proofElement sorted alphabetically
                computedHash = keccak256(abi.encodePacked(computedHash, proofElement));
            } else {
                computedHash = keccak256(abi.encodePacked(proofElement, computedHash));
            }
        }

        return computedHash == root;
    }
}
