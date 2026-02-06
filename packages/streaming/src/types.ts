/**
 * Core types for streaming protocol
 */

/** Video segment */
export interface Segment {
  index: number;
  duration: number;
  data: Buffer;
}

/** Encrypted segment */
export interface EncryptedSegment {
  index: number;
  data: Buffer;
  iv: Buffer;
}

/** Merkle proof for key verification */
export interface MerkleProof {
  leaf: string;
  proof: string[];
  root: string;
  index: number;
}

/** Key response from server */
export interface KeyResponse {
  key: string;
  iv: string;
  proof: MerkleProof;
  segmentIndex: number;
}
