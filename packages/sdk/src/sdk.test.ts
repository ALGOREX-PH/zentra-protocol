import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { Keypair, StrKey } from "@stellar/stellar-sdk";
import * as snarkjs from "snarkjs";

import { createPolicy } from "./policy";
import { proveAction } from "./prover";
import { buildMerkle } from "./crypto";
import { ProveError } from "./errors";

const here = dirname(fileURLToPath(import.meta.url));
const circuitDir = resolve(here, "../../../circuits/payment-policy");
const artifacts = {
  wasmPath: resolve(circuitDir, "payment_policy_js/payment_policy.wasm"),
  zkeyPath: resolve(circuitDir, "payment_policy.zkey"),
};

// The wasm/zkey are build outputs (gitignored). CI without them skips the
// proving suite rather than failing.
const hasArtifacts = existsSync(artifacts.wasmPath) && existsSync(artifacts.zkeyPath);
if (!hasArtifacts) {
  console.warn(
    "[sdk.test] circuit artifacts not found (payment_policy_js/payment_policy.wasm, payment_policy.zkey) — " +
      "run circuits/payment-policy/build.sh to generate them; skipping the proving suite.",
  );
}

const D = 10_000_000n;
const contractId = StrKey.encodeContract(randomBytes(32)); // valid C-address
const asset = StrKey.encodeContract(randomBytes(32));

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

function ctxFor(agent: Keypair, recipient: string) {
  return {
    agent: agent.publicKey(),
    contractId,
    recipient,
    amount: 75n * D,
    invoicePreimage: 123456789n,
    nonce: 1n,
    prevEpochId: 20180n,
    prevSpent: 300n * D,
    prevActionCount: 41n,
  };
}

describe.skipIf(!hasArtifacts)("SDK proving path (real addresses, real circuit)", () => {
  const vk = JSON.parse(readFileSync(resolve(circuitDir, "verification_key.json"), "utf8"));

  it("proves a compliant payment and the proof verifies", async () => {
    const agent = Keypair.random();
    const { policy, vendors } = await makePolicy();

    const result = await proveAction(policy, ctxFor(agent, vendors[1].publicKey()), artifacts);

    expect(result.publicSignals).toHaveLength(14);
    const ok = await snarkjs.groth16.verify(vk, result.publicSignals, result.proof);
    expect(ok).toBe(true);
  }, 60_000);
});

describe("prover pre-validation (throws before witness generation, no artifacts needed)", () => {
  it("refuses to prove a payment to a non-approved recipient (Panel B)", async () => {
    const agent = Keypair.random();
    const { policy } = await makePolicy();
    const attacker = Keypair.random();

    const p = proveAction(policy, ctxFor(agent, attacker.publicKey()), artifacts);
    await expect(p).rejects.toThrow(ProveError);
    await expect(
      proveAction(policy, ctxFor(agent, attacker.publicKey()), artifacts),
    ).rejects.toThrow(/not in the policy/);
  }, 30_000);

  it("rejects an amount above the policy's maxAmount, naming both values", async () => {
    const agent = Keypair.random();
    const { policy, vendors } = await makePolicy();

    const ctx = { ...ctxFor(agent, vendors[0].publicKey()), amount: 101n * D };
    const p = proveAction(policy, ctx, artifacts);
    await expect(p).rejects.toThrow(ProveError);
    await expect(proveAction(policy, ctx, artifacts)).rejects.toThrow(
      new RegExp(`${101n * D}.*maxAmount ${100n * D}`),
    );
  }, 30_000);

  it("rejects prevSpent + amount above the dailyLimit, naming the policy values", async () => {
    const agent = Keypair.random();
    const { policy, vendors } = await makePolicy();

    // 480 + 75 = 555 > 500 (mirrors the circuit's --over-spend case)
    const ctx = { ...ctxFor(agent, vendors[0].publicKey()), prevSpent: 480n * D };
    const p = proveAction(policy, ctx, artifacts);
    await expect(p).rejects.toThrow(ProveError);
    await expect(proveAction(policy, ctx, artifacts)).rejects.toThrow(
      new RegExp(`dailyLimit ${500n * D}`),
    );
  }, 30_000);

  it("rejects a negative amount (outside the circuit's 64-bit range)", async () => {
    const agent = Keypair.random();
    const { policy, vendors } = await makePolicy();

    await expect(
      proveAction(policy, { ...ctxFor(agent, vendors[0].publicKey()), amount: -1n }, artifacts),
    ).rejects.toThrow(/64-bit range/);
  }, 30_000);
});

describe("buildMerkle index bounds", () => {
  it("rejects out-of-range and non-integer indices", async () => {
    const fields = [101n, 202n, 303n];
    await expect(buildMerkle(fields, -1)).rejects.toThrow(/out of bounds/);
    await expect(buildMerkle(fields, 3)).rejects.toThrow(/out of bounds/);
    await expect(buildMerkle(fields, 1.5)).rejects.toThrow(/out of bounds/);
  });

  it("accepts every in-range index", async () => {
    const fields = [101n, 202n, 303n];
    const proofs = await Promise.all(fields.map((_, i) => buildMerkle(fields, i)));
    for (const p of proofs) expect(p.root).toBe(proofs[0].root);
  });
});
