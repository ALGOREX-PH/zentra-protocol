import { randomBytes } from "node:crypto";
import { fieldToBytes32, modFr } from "@zentra/serialization";
import { H, addressToField, merkleRoot } from "./crypto";

export interface PolicyConfig {
  name: string;
  /** SAC contract address (C...) of the asset, e.g. testnet USDC. */
  asset: string;
  /** Per-invoice cap, in asset base units (USDC has 7 decimals). */
  maxAmount: bigint;
  /** Per-epoch cap, in asset base units. */
  dailyLimit: bigint;
  /** Approved vendor account addresses (G...). */
  approvedRecipients: string[];
  /** Epoch window in seconds (default 86400 = daily). */
  epochSeconds?: number;
  /** Hiding salt; randomly generated if omitted. Keep secret. */
  salt?: bigint;
}

export interface Policy {
  name: string;
  asset: string;
  assetField: bigint;
  maxAmount: bigint;
  dailyLimit: bigint;
  approvedRecipients: string[];
  recipientFields: bigint[];
  recipientRoot: bigint;
  salt: bigint;
  epochSeconds: number;
  /** policyCommitment — the on-chain policy id. */
  commitment: bigint;
  commitmentBytes: Uint8Array;
  recipientRootBytes: Uint8Array;
}

function randomFieldSalt(): bigint {
  // 31 bytes < r; reduce defensively.
  return modFr(BigInt("0x" + Buffer.from(randomBytes(31)).toString("hex")));
}

/**
 * Create a policy: build the approved-recipient Merkle root and the Poseidon
 * policy commitment. The commitment opening must match payment_policy.circom:
 *   commitment = Poseidon(maxAmount, dailyLimit, recipientRoot, assetField, salt)
 */
export async function createPolicy(config: PolicyConfig): Promise<Policy> {
  const epochSeconds = config.epochSeconds ?? 86_400;
  const salt = config.salt ?? randomFieldSalt();
  const assetField = addressToField(config.asset);
  const recipientFields = config.approvedRecipients.map(addressToField);
  const recipientRoot = await merkleRoot(recipientFields);
  const commitment = await H([
    config.maxAmount,
    config.dailyLimit,
    recipientRoot,
    assetField,
    salt,
  ]);

  return {
    name: config.name,
    asset: config.asset,
    assetField,
    maxAmount: config.maxAmount,
    dailyLimit: config.dailyLimit,
    approvedRecipients: config.approvedRecipients,
    recipientFields,
    recipientRoot,
    salt,
    epochSeconds,
    commitment,
    commitmentBytes: fieldToBytes32(commitment),
    recipientRootBytes: fieldToBytes32(recipientRoot),
  };
}
