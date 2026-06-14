import * as snarkjs from "snarkjs";
import { fieldToBytes32 } from "@zentra/serialization";
import { H, addressToField, buildMerkle } from "./crypto";
import type { Policy } from "./policy";

/** Everything needed to prove one payment action. State fields come from chain. */
export interface ActionContext {
  agent: string; // G... agent account
  contractId: string; // C... verifier contract the proof is bound to
  recipient: string; // G... vendor to pay
  amount: bigint; // base units
  invoicePreimage: bigint; // private; hashes to invoiceHash
  nonce: bigint; // replay nonce
  prevEpochId: bigint;
  prevSpent: bigint;
  prevActionCount: bigint;
}

export interface CircuitArtifacts {
  wasmPath: string;
  zkeyPath: string;
}

export interface ProveResult {
  proof: any; // snarkjs Groth16 proof
  publicSignals: string[]; // 14 decimal strings (canonical order)
  recipient: string;
  amount: bigint;
  nullifier: bigint;
  nullifierBytes: Uint8Array;
  invoiceHashBytes: Uint8Array;
  prevEpochId: bigint;
  prevSpent: bigint;
  prevActionCount: bigint;
}

/**
 * Generate a Proof-of-Compliance for `ctx` under `policy`. Throws before any
 * proving if the recipient is not in the policy's approved set (the
 * prompt-injection / Panel B failure mode).
 */
export async function proveAction(
  policy: Policy,
  ctx: ActionContext,
  artifacts: CircuitArtifacts,
): Promise<ProveResult> {
  const recipientField = addressToField(ctx.recipient);
  const index = policy.recipientFields.findIndex((f) => f === recipientField);
  if (index === -1) {
    throw new Error(
      `recipient ${ctx.recipient} is not in the policy's approved-vendor set — no proof can be produced`,
    );
  }

  const merkle = await buildMerkle(policy.recipientFields, index);
  if (merkle.root !== policy.recipientRoot) {
    throw new Error("internal error: rebuilt Merkle root does not match policy root");
  }

  const agentField = addressToField(ctx.agent);
  const contractField = addressToField(ctx.contractId);
  const nullifier = await H([agentField, policy.commitment, contractField, ctx.nonce]);
  const invoiceHash = await H([ctx.invoicePreimage]);
  const newSpent = ctx.prevSpent + ctx.amount;
  const newActionCount = ctx.prevActionCount + 1n;

  const input = {
    policyCommitment: policy.commitment.toString(),
    recipientRoot: policy.recipientRoot.toString(),
    recipient: recipientField.toString(),
    amount: ctx.amount.toString(),
    invoiceHash: invoiceHash.toString(),
    nullifier: nullifier.toString(),
    agentAddress: agentField.toString(),
    assetId: policy.assetField.toString(),
    contractAddress: contractField.toString(),
    prevEpochId: ctx.prevEpochId.toString(),
    prevSpent: ctx.prevSpent.toString(),
    prevActionCount: ctx.prevActionCount.toString(),
    newSpent: newSpent.toString(),
    newActionCount: newActionCount.toString(),
    privateMaxAmount: policy.maxAmount.toString(),
    privateDailyLimit: policy.dailyLimit.toString(),
    policySalt: policy.salt.toString(),
    pathElements: merkle.pathElements.map((x) => x.toString()),
    pathIndices: merkle.pathIndices.map((x) => x.toString()),
    invoicePreimage: ctx.invoicePreimage.toString(),
    nonce: ctx.nonce.toString(),
  };

  const { proof, publicSignals } = await snarkjs.groth16.fullProve(
    input,
    artifacts.wasmPath,
    artifacts.zkeyPath,
  );

  return {
    proof,
    publicSignals,
    recipient: ctx.recipient,
    amount: ctx.amount,
    nullifier,
    nullifierBytes: fieldToBytes32(nullifier),
    invoiceHashBytes: fieldToBytes32(invoiceHash),
    prevEpochId: ctx.prevEpochId,
    prevSpent: ctx.prevSpent,
    prevActionCount: ctx.prevActionCount,
  };
}
