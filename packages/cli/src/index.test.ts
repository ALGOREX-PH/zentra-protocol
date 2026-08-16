// CLI smoke tests: the prove -> submit JSON round-trip, against a mocked
// client. Imports the CLI module directly — its commander program only runs
// when the file is executed as a script.
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import { createPolicy, type ProveResult, type SubmitParams } from "@zentra/sdk";

import { savedProofFromResult, submitParamsFromSavedProof, type SavedProofFile } from "./index";

const here = dirname(fileURLToPath(import.meta.url));
// A real Groth16 proof shape (the committed sample proof for payment_policy.circom).
const proof = JSON.parse(
  readFileSync(resolve(here, "../../../circuits/payment-policy/proof.json"), "utf8"),
);

// Same bigint-stringifying replacer the CLI's writeJson uses; parse back like readJson.
const roundTripDisk = (v: unknown): SavedProofFile =>
  JSON.parse(JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? x.toString() : x)));

function fakeProveResult(recipient: string): ProveResult {
  return {
    proof,
    publicSignals: Array.from({ length: 14 }, (_, i) => String(i + 1)),
    recipient,
    amount: 750_000_000n,
    nullifier: 424242n,
    nullifierBytes: new Uint8Array(randomBytes(32)),
    invoiceHashBytes: new Uint8Array(randomBytes(32)),
    prevEpochId: 20180n,
    prevSpent: 3_000_000_000n,
    prevActionCount: 41n,
  };
}

describe("prove -> submit round-trip", () => {
  it("preserves every submitted field through the proof file", () => {
    const recipient = Keypair.random().publicKey();
    const result = fakeProveResult(recipient);

    const onDisk = roundTripDisk(savedProofFromResult("policies/vendor.json", result));
    expect(onDisk.policy).toBe("policies/vendor.json");

    const params = submitParamsFromSavedProof(onDisk);
    expect(params.proof).toEqual(proof);
    expect(params.recipient).toBe(recipient);
    expect(params.amount).toBe(750_000_000n);
    expect(params.invoiceHashBytes).toEqual(result.invoiceHashBytes);
    expect(params.nullifierBytes).toEqual(result.nullifierBytes);
    expect(params.prevEpochId).toBe(20180n);
    expect(params.prevSpent).toBe(3_000_000_000n);
    expect(params.prevActionCount).toBe(41n);
  });

  it("submits only real data — no fabricated publicSignals/nullifier placeholders", () => {
    const params = submitParamsFromSavedProof(
      roundTripDisk(savedProofFromResult("p.json", fakeProveResult(Keypair.random().publicKey()))),
    );
    expect("publicSignals" in params).toBe(false);
    expect("nullifier" in params).toBe(false); // only nullifierBytes is submitted
  });

  it("drives a mocked client the way the submit command does", async () => {
    const agent = Keypair.random();
    const recipient = Keypair.random().publicKey();
    const asset = StrKey.encodeContract(randomBytes(32));
    const policy = await createPolicy({
      name: "smoke",
      asset,
      maxAmount: 1_000_000_000n,
      dailyLimit: 5_000_000_000n,
      approvedRecipients: [recipient],
    });

    let captured: SubmitParams | undefined;
    const client = {
      authorizeAction: vi.fn(async (_agent: Keypair, _policy: unknown, params: SubmitParams, _asset: string) => {
        captured = params;
        return { hash: "TXHASH" };
      }),
    };

    const pf = roundTripDisk(savedProofFromResult("p.json", fakeProveResult(recipient)));
    const tx = await client.authorizeAction(agent, policy, submitParamsFromSavedProof(pf), asset);

    expect(tx.hash).toBe("TXHASH");
    expect(client.authorizeAction).toHaveBeenCalledTimes(1);
    expect(captured?.recipient).toBe(recipient);
    expect(captured?.amount).toBe(750_000_000n);
    expect(captured?.proof.pi_a).toEqual(proof.pi_a);
  });
});
