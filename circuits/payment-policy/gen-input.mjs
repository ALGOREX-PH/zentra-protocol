// Generates a consistent witness (input.example.json) for payment_policy.circom
// using circomlibjs Poseidon — the JS twin of the circuit's circomlib Poseidon.
// This is the reference for the SDK's policy/prover logic: build the vendor
// Merkle tree, open the policy commitment, derive the nullifier, hash the invoice.
//
// Usage: node gen-input.mjs [--bad-recipient] [--over-spend]
import { buildPoseidon } from "circomlibjs";
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));

const poseidon = await buildPoseidon();
const F = poseidon.F;
const H = (arr) => F.toObject(poseidon(arr.map((x) => BigInt(x))));

const DEPTH = 4;
const N = 1 << DEPTH;
const D = 10_000_000n; // USDC has 7 decimals

const maxAmount = 100n * D;
const dailyLimit = 500n * D;
const amount = 75n * D;
const prevSpent = args.has("--over-spend") ? 480n * D : 300n * D; // 480+75 > 500 -> over limit
const newSpent = prevSpent + amount;
const prevActionCount = 41n;
const newActionCount = prevActionCount + 1n;
const prevEpochId = 20180n;
const policySalt = 987654321n;
const nonce = 1n;
const invoicePreimage = 123456789n;

// Field-encoded addresses (the SDK derives these from real Stellar addresses).
const agentAddress = 1111n;
const assetId = 2222n;
const contractAddress = 3333n;

// Approved-vendor allowlist (field-encoded), padded to N leaves with sentinel 0.
const vendors = [101n, 202n, 303n];
const recipientIdx = 1;
const recipient = args.has("--bad-recipient") ? 999n : vendors[recipientIdx];

const leaves = [];
for (let i = 0; i < N; i++) {
  leaves.push(H([i < vendors.length ? vendors[i] : 0n]));
}

let level = leaves.slice();
const pathElements = [];
const pathIndices = [];
let idx = recipientIdx;
for (let d = 0; d < DEPTH; d++) {
  const isRight = idx & 1;
  pathElements.push(isRight ? level[idx - 1] : level[idx + 1]);
  pathIndices.push(BigInt(isRight));
  const next = [];
  for (let i = 0; i < level.length; i += 2) next.push(H([level[i], level[i + 1]]));
  level = next;
  idx >>= 1;
}
const recipientRoot = level[0];

const policyCommitment = H([maxAmount, dailyLimit, recipientRoot, assetId, policySalt]);
const invoiceHash = H([invoicePreimage]);
const nullifier = H([agentAddress, policyCommitment, contractAddress, nonce]);

const input = {
  policyCommitment, recipientRoot, amount, invoiceHash, nullifier,
  agentAddress, assetId, contractAddress, prevEpochId, prevSpent,
  prevActionCount, newSpent, newActionCount,
  privateMaxAmount: maxAmount, privateDailyLimit: dailyLimit, policySalt,
  recipient, pathElements, pathIndices, invoicePreimage, nonce,
};

// JSON can't hold BigInt — stringify all field values.
const ser = JSON.stringify(
  input,
  (_k, v) =>
    typeof v === "bigint" ? v.toString()
    : Array.isArray(v) ? v.map((x) => (typeof x === "bigint" ? x.toString() : x))
    : v,
  2,
);
writeFileSync(resolve(here, "input.example.json"), ser);
console.log("wrote input.example.json");
console.log("  recipientRoot   :", recipientRoot.toString());
console.log("  policyCommitment:", policyCommitment.toString());
console.log("  nullifier       :", nullifier.toString());
