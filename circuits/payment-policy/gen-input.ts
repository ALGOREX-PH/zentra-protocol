// Generates a consistent witness (input.example.json) for payment_policy.circom
// using the SDK's Poseidon/Merkle helpers (packages/sdk/src/crypto.ts) — the
// same code the policy/prover logic uses, so the circuit and SDK can never
// drift: build the vendor Merkle tree, open the policy commitment, derive the
// nullifier, hash the invoice.
//
// Usage: pnpm exec tsx gen-input.ts [--bad-recipient] [--over-spend]
import { writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { H, buildMerkle } from "../../packages/sdk/src/crypto.ts";

const here = dirname(fileURLToPath(import.meta.url));
const args = new Set(process.argv.slice(2));

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

// Approved-vendor allowlist (field-encoded); buildMerkle pads to 16 leaves
// with sentinel 0 exactly like the circuit expects.
const vendors = [101n, 202n, 303n];
const recipientIdx = 1;
const recipient = args.has("--bad-recipient") ? 999n : vendors[recipientIdx];

const { root: recipientRoot, pathElements, pathIndices } = await buildMerkle(
  vendors,
  recipientIdx,
);

const policyCommitment = await H([maxAmount, dailyLimit, recipientRoot, assetId, policySalt]);
const invoiceHash = await H([invoicePreimage]);
const nullifier = await H([agentAddress, policyCommitment, contractAddress, nonce]);

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
  (_k: string, v: unknown) =>
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
