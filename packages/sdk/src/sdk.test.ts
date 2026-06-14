import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Keypair } from "@stellar/stellar-sdk";
import * as snarkjs from "snarkjs";

import { createPolicy } from "./policy";
import { proveAction } from "./prover";

const here = dirname(fileURLToPath(import.meta.url));
const circuitDir = resolve(here, "../../../circuits/payment-policy");
const artifacts = {
  wasmPath: resolve(circuitDir, "payment_policy_js/payment_policy.wasm"),
  zkeyPath: resolve(circuitDir, "payment_policy.zkey"),
};
const vk = JSON.parse(readFileSync(resolve(circuitDir, "verification_key.json"), "utf8"));

const D = 10_000_000n;
const contractId = Keypair.random().publicKey().replace(/^G/, "C"); // any C-address shape is fine for field derivation
const asset = Keypair.random().publicKey().replace(/^G/, "C");

async function makePolicy() {
  const vendors = [Keypair.random(), Keypair.random(), Keypair.random()];
  const policy = await createPolicy({
    name: "vendor-payment",
    asset,
    maxAmount: 100n * D,
    dailyLimit: 500n * D,
    approvedRecipients: vendors.map((v) => v.publicKey()),
  });
  return { policy, vendors };
}

describe("SDK proving path (real addresses, real circuit)", () => {
  it("proves a compliant payment and the proof verifies", async () => {
    const agent = Keypair.random();
    const { policy, vendors } = await makePolicy();

    const result = await proveAction(
      policy,
      {
        agent: agent.publicKey(),
        contractId,
        recipient: vendors[1].publicKey(),
        amount: 75n * D,
        invoicePreimage: 123456789n,
        nonce: 1n,
        prevEpochId: 20180n,
        prevSpent: 300n * D,
        prevActionCount: 41n,
      },
      artifacts,
    );

    expect(result.publicSignals).toHaveLength(14);
    const ok = await snarkjs.groth16.verify(vk, result.publicSignals, result.proof);
    expect(ok).toBe(true);
  }, 60_000);

  it("refuses to prove a payment to a non-approved recipient (Panel B)", async () => {
    const agent = Keypair.random();
    const { policy } = await makePolicy();
    const attacker = Keypair.random();

    await expect(
      proveAction(
        policy,
        {
          agent: agent.publicKey(),
          contractId,
          recipient: attacker.publicKey(),
          amount: 75n * D,
          invoicePreimage: 1n,
          nonce: 1n,
          prevEpochId: 20180n,
          prevSpent: 0n,
          prevActionCount: 0n,
        },
        artifacts,
      ),
    ).rejects.toThrow(/not in the policy/);
  }, 30_000);
});
