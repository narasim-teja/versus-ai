/**
 * Merkle tree implementation for key commitment
 */

import { sha256 } from "@noble/hashes/sha256";
import type { MerkleProof } from "../types";
import { InvalidProofError } from "../errors";

/** Merkle tree structure */
export interface MerkleTree {
  leaves: Buffer[];
  layers: Buffer[][];
  root: Buffer;
}

function hash(data: Buffer | Uint8Array): Buffer {
  return Buffer.from(sha256(data));
}

function hashPair(left: Buffer, right: Buffer): Buffer {
  return hash(Buffer.concat([left, right]));
}

function padToPowerOfTwo(arr: Buffer[]): Buffer[] {
  if (arr.length === 0) {
    throw new Error("Cannot build Merkle tree from empty array");
  }

  let targetLength = 1;
  while (targetLength < arr.length) {
    targetLength *= 2;
  }

  const result = [...arr];
  while (result.length < targetLength) {
    result.push(result[result.length - 1]);
  }

  return result;
}

/**
 * Build a Merkle tree from an array of keys
 */
export function buildMerkleTree(keys: Buffer[]): MerkleTree {
  if (keys.length === 0) {
    throw new Error("Cannot build Merkle tree from empty keys array");
  }

  const hashedLeaves = keys.map((key) => hash(key));
  const leaves = padToPowerOfTwo(hashedLeaves);
  const layers: Buffer[][] = [leaves];

  while (layers[layers.length - 1].length > 1) {
    const currentLayer = layers[layers.length - 1];
    const nextLayer: Buffer[] = [];

    for (let i = 0; i < currentLayer.length; i += 2) {
      const left = currentLayer[i];
      const right = currentLayer[i + 1] || left;
      nextLayer.push(hashPair(left, right));
    }

    layers.push(nextLayer);
  }

  return {
    leaves,
    layers,
    root: layers[layers.length - 1][0],
  };
}

/**
 * Generate a Merkle proof for a specific key index
 */
export function generateMerkleProof(
  tree: MerkleTree,
  index: number
): MerkleProof {
  if (index < 0 || index >= tree.leaves.length) {
    throw new Error(
      `Invalid index: ${index}. Must be between 0 and ${tree.leaves.length - 1}`
    );
  }

  const proof: Buffer[] = [];
  let currentIndex = index;

  for (let i = 0; i < tree.layers.length - 1; i++) {
    const layer = tree.layers[i];
    const isLeft = currentIndex % 2 === 0;
    const siblingIndex = isLeft ? currentIndex + 1 : currentIndex - 1;

    if (siblingIndex < layer.length) {
      proof.push(layer[siblingIndex]);
    }

    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    leaf: tree.leaves[index].toString("hex"),
    proof: proof.map((p) => p.toString("hex")),
    root: tree.root.toString("hex"),
    index,
  };
}

/**
 * Verify a Merkle proof
 */
export function verifyMerkleProof(key: Buffer, proof: MerkleProof): boolean {
  let current = hash(key);
  let index = proof.index;

  for (const siblingHex of proof.proof) {
    const sibling = Buffer.from(siblingHex, "hex");
    const isLeft = index % 2 === 0;

    if (isLeft) {
      current = hashPair(current, sibling);
    } else {
      current = hashPair(sibling, current);
    }

    index = Math.floor(index / 2);
  }

  return current.toString("hex") === proof.root;
}

/**
 * Verify a Merkle proof and throw if invalid
 */
export function assertValidProof(key: Buffer, proof: MerkleProof): void {
  if (!verifyMerkleProof(key, proof)) {
    throw new InvalidProofError(proof.index);
  }
}

/**
 * Get the Merkle root as a hex string
 */
export function getMerkleRoot(tree: MerkleTree): string {
  return tree.root.toString("hex");
}

/**
 * Serialize Merkle tree to JSON-safe string
 */
export function serializeMerkleTree(tree: MerkleTree): string {
  return JSON.stringify({
    leaves: tree.leaves.map((l) => l.toString("hex")),
    layers: tree.layers.map((layer) => layer.map((n) => n.toString("hex"))),
    root: tree.root.toString("hex"),
  });
}

/**
 * Deserialize Merkle tree from JSON string
 */
export function deserializeMerkleTree(json: string): MerkleTree {
  const data = JSON.parse(json);
  return {
    leaves: data.leaves.map((l: string) => Buffer.from(l, "hex")),
    layers: data.layers.map((layer: string[]) =>
      layer.map((n: string) => Buffer.from(n, "hex"))
    ),
    root: Buffer.from(data.root, "hex"),
  };
}
