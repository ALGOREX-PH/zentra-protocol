// Poseidon, Merkle tree, and address->field helpers. These MUST match
// payment_policy.circom exactly: same Poseidon (circomlibjs == circomlib),
// leaf = Poseidon(recipientField), node = Poseidon(left,right), depth 4.

import { buildPoseidon } from "circomlibjs";
import { StrKey } from "@stellar/stellar-sdk";
import { bytes32ToField } from "@zentra/serialization";

export const MERKLE_DEPTH = 4;
export const MERKLE_LEAVES = 1 << MERKLE_DEPTH; // 16

let _poseidon: any = null;
async function poseidon() {
  if (!_poseidon) _poseidon = await buildPoseidon();
  return _poseidon;
}

/** Poseidon hash of field elements -> bigint (matches circom circomlib Poseidon). */
export async function H(inputs: (bigint | number | string)[]): Promise<bigint> {
  const p = await poseidon();
  return p.F.toObject(p(inputs.map((x) => BigInt(x))));
}

/** Decode a Stellar address (G... account or C... contract) to its 32-byte payload. */
export function addressPayload(address: string): Uint8Array {
  if (address.startsWith("G")) return StrKey.decodeEd25519PublicKey(address);
  if (address.startsWith("C")) return StrKey.decodeContract(address);
  throw new Error(`unsupported address type: ${address}`);
}

/** Field element for a Stellar address: the 32-byte payload reduced mod r. */
export function addressToField(address: string): bigint {
  return bytes32ToField(addressPayload(address));
}

export interface MerkleProof {
  root: bigint;
  pathElements: bigint[];
  pathIndices: bigint[];
}

/**
 * Build the approved-recipient tree from recipient field elements (padded to
 * 16 leaves with a sentinel), and return the root plus the inclusion path for
 * `index`. leaf_i = Poseidon(field_i).
 */
export async function buildMerkle(
  recipientFields: bigint[],
  index: number,
): Promise<MerkleProof> {
  if (recipientFields.length > MERKLE_LEAVES) {
    throw new Error(`at most ${MERKLE_LEAVES} recipients`);
  }
  const leaves: bigint[] = [];
  for (let i = 0; i < MERKLE_LEAVES; i++) {
    leaves.push(await H([i < recipientFields.length ? recipientFields[i] : 0n]));
  }

  let level = leaves.slice();
  const pathElements: bigint[] = [];
  const pathIndices: bigint[] = [];
  let idx = index;
  for (let d = 0; d < MERKLE_DEPTH; d++) {
    const isRight = idx & 1;
    pathElements.push(isRight ? level[idx - 1] : level[idx + 1]);
    pathIndices.push(BigInt(isRight));
    const next: bigint[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(await H([level[i], level[i + 1]]));
    level = next;
    idx >>= 1;
  }
  return { root: level[0], pathElements, pathIndices };
}

/** Just the Merkle root over a set of recipient field elements. */
export async function merkleRoot(recipientFields: bigint[]): Promise<bigint> {
  return (await buildMerkle(recipientFields.length ? recipientFields : [0n], 0)).root;
}
