// Generates the end-to-end `authorize_action` test fixture for the Soroban
// verifier: a real Groth16 proof (via the SDK's prover, exactly the code path
// production uses) whose 14 public signals are bound to FIXED Stellar
// addresses, so the Rust test env can recreate the identical statement with
// `Address::from_str` + `env.register_at` and drive the full settlement path.
//
// Outputs:
//   contracts/zentra-verifier/src/authorize_fixtures.rs  (Rust fixture, test-only)
//   authorize-fixture.proof.json                         (snarkjs proof sidecar)
//
// Reproducibility: all inputs are fixed constants, so every derived value
// (commitment, root, nullifier, public signals) is deterministic. Groth16
// proving itself is randomized (fresh r, s each run), so the sidecar makes the
// script idempotent: if the committed proof still verifies against the local
// verification_key.json and the recomputed public signals, it is reused and
// both outputs are rewritten byte-identically; otherwise a new proof is
// generated. Regenerate from scratch by deleting authorize-fixture.proof.json.
//
// The fixed ledger TIMESTAMP below must be set in the Rust test env
// (env.ledger().set_timestamp) so the contract's epoch math
// (timestamp / EPOCH_SECONDS) agrees with PREV_EPOCH_ID proven here.
//
// Usage: pnpm exec tsx gen-authorize-fixture.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { H, addressToField } from "../../packages/sdk/src/crypto.ts";
import { createPolicy } from "../../packages/sdk/src/policy.ts";
import { proveAction } from "../../packages/sdk/src/prover.ts";
import {
  fieldToBytes32,
  proofToBytes,
  publicInputsToDecimal,
  type Groth16Proof,
} from "../../packages/serialization/src/index.ts";

const here = dirname(fileURLToPath(import.meta.url));
// Resolve the SDK's own dependencies (pnpm keeps them out of the root store).
const sdkRequire = createRequire(resolve(here, "../../packages/sdk/package.json"));
const { StrKey } = sdkRequire("@stellar/stellar-sdk");
const snarkjs = sdkRequire("snarkjs");

// ---- fixed test identities (payload bytes -> strkey; any 32 bytes are valid) ----
const AGENT = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x11)) as string;
const RECIPIENT = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x22)) as string;
const OTHER_VENDOR = StrKey.encodeEd25519PublicKey(Buffer.alloc(32, 0x55)) as string;
const ASSET = StrKey.encodeContract(Buffer.alloc(32, 0x33)) as string;
const VERIFIER_CONTRACT = StrKey.encodeContract(Buffer.alloc(32, 0x44)) as string;

// ---- fixed policy + action constants (USDC-style 7 decimals) ----
const D = 10_000_000n;
const MAX_AMOUNT = 100n * D;
const DAILY_LIMIT = 500n * D;
const AMOUNT = 75n * D;
const EPOCH_SECONDS = 86_400n;
const TIMESTAMP = 1_754_969_145n; // 20_312 * 86_400 + 12_345
const PREV_EPOCH_ID = TIMESTAMP / EPOCH_SECONDS; // 20_312 — same math as the contract
const PREV_SPENT = 0n;
const PREV_ACTION_COUNT = 0n;
const POLICY_SALT = 424_242_424_242n;
const NONCE = 7n;
const INVOICE_PREIMAGE = 123_456_789n;

const SIDECAR = resolve(here, "authorize-fixture.proof.json");
const OUT_RS = resolve(here, "../../contracts/zentra-verifier/src/authorize_fixtures.rs");
const VK = JSON.parse(readFileSync(resolve(here, "verification_key.json"), "utf8"));

const policy = await createPolicy({
  name: "authorize-fixture",
  asset: ASSET,
  maxAmount: MAX_AMOUNT,
  dailyLimit: DAILY_LIMIT,
  approvedRecipients: [RECIPIENT, OTHER_VENDOR],
  epochSeconds: Number(EPOCH_SECONDS),
  salt: POLICY_SALT,
});

const agentField = addressToField(AGENT);
const contractField = addressToField(VERIFIER_CONTRACT);
const nullifier = await H([agentField, policy.commitment, contractField, NONCE]);
const invoiceHash = await H([INVOICE_PREIMAGE]);

const expectedSignals = publicInputsToDecimal({
  policyCommitment: policy.commitment,
  recipientRoot: policy.recipientRoot,
  recipient: addressToField(RECIPIENT),
  amount: AMOUNT,
  invoiceHash,
  nullifier,
  agentAddress: agentField,
  assetId: policy.assetField,
  contractAddress: contractField,
  prevEpochId: PREV_EPOCH_ID,
  prevSpent: PREV_SPENT,
  prevActionCount: PREV_ACTION_COUNT,
  newSpent: PREV_SPENT + AMOUNT,
  newActionCount: PREV_ACTION_COUNT + 1n,
});

interface Sidecar {
  proof: Groth16Proof;
  publicSignals: string[];
}

async function loadReusableSidecar(): Promise<Sidecar | null> {
  if (!existsSync(SIDECAR)) return null;
  const s = JSON.parse(readFileSync(SIDECAR, "utf8")) as Sidecar;
  if (
    s.publicSignals.length !== expectedSignals.length ||
    s.publicSignals.some((v, i) => v !== expectedSignals[i])
  ) {
    console.log("sidecar public signals no longer match the fixed inputs — regenerating proof");
    return null;
  }
  if (!(await snarkjs.groth16.verify(VK, s.publicSignals, s.proof))) {
    console.log("sidecar proof no longer verifies against verification_key.json — regenerating");
    return null;
  }
  return s;
}

let sidecar = await loadReusableSidecar();
if (sidecar) {
  console.log("reusing committed proof from authorize-fixture.proof.json (verified)");
} else {
  const result = await proveAction(
    policy,
    {
      agent: AGENT,
      contractId: VERIFIER_CONTRACT,
      recipient: RECIPIENT,
      amount: AMOUNT,
      invoicePreimage: INVOICE_PREIMAGE,
      nonce: NONCE,
      prevEpochId: PREV_EPOCH_ID,
      prevSpent: PREV_SPENT,
      prevActionCount: PREV_ACTION_COUNT,
    },
    {
      wasmPath: resolve(here, "payment_policy_js/payment_policy.wasm"),
      zkeyPath: resolve(here, "payment_policy.zkey"),
    },
  );
  if (
    result.publicSignals.length !== expectedSignals.length ||
    result.publicSignals.some((v, i) => v !== expectedSignals[i])
  ) {
    throw new Error("prover public signals do not match the recomputed canonical signals");
  }
  if (!(await snarkjs.groth16.verify(VK, result.publicSignals, result.proof))) {
    throw new Error("freshly generated proof does not verify against verification_key.json");
  }
  sidecar = { proof: result.proof as Groth16Proof, publicSignals: result.publicSignals };
}

writeFileSync(SIDECAR, JSON.stringify(sidecar, null, 2) + "\n");

// ---- emit the Rust fixture ----
const proofBytes = proofToBytes(sidecar.proof);
const signalRows = sidecar.publicSignals.map(fieldToBytes32);

// #[rustfmt::skip] on each array keeps `cargo fmt --check` from ever reflowing
// generated data, so regeneration is byte-identical to the committed file.
const arr = (name: string, b: Uint8Array) =>
  `#[rustfmt::skip]\npub const ${name}: [u8; ${b.length}] = [${Array.from(b).join(", ")}];`;
const arr2 = (name: string, rows: Uint8Array[]) =>
  `#[rustfmt::skip]\npub const ${name}: [[u8; ${rows[0].length}]; ${rows.length}] = [\n${rows.map((b) => `    [${Array.from(b).join(", ")}]`).join(",\n")},\n];`;

const rs = `// @generated by circuits/payment-policy/gen-authorize-fixture.ts — DO NOT EDIT BY HAND.
// End-to-end \`authorize_action\` fixture: a real payment-policy Groth16 proof
// whose public signals are bound to the fixed test addresses below. The test
// env must register the verifier at VERIFIER_CONTRACT, a token at ASSET, and
// set the ledger timestamp to TIMESTAMP for the statement to match.
#![allow(dead_code)]

pub const AGENT: &str = "${AGENT}";
pub const RECIPIENT: &str = "${RECIPIENT}";
pub const OTHER_VENDOR: &str = "${OTHER_VENDOR}";
pub const ASSET: &str = "${ASSET}";
pub const VERIFIER_CONTRACT: &str = "${VERIFIER_CONTRACT}";

pub const TIMESTAMP: u64 = ${TIMESTAMP};
pub const EPOCH_SECONDS: u64 = ${EPOCH_SECONDS};
pub const PREV_EPOCH_ID: u64 = ${PREV_EPOCH_ID};
pub const PREV_SPENT: i128 = ${PREV_SPENT};
pub const PREV_ACTION_COUNT: u64 = ${PREV_ACTION_COUNT};
pub const AMOUNT: i128 = ${AMOUNT};

${arr("POLICY_COMMITMENT", fieldToBytes32(policy.commitment))}
${arr("RECIPIENT_ROOT", fieldToBytes32(policy.recipientRoot))}
${arr("INVOICE_HASH", fieldToBytes32(invoiceHash))}
${arr("NULLIFIER", fieldToBytes32(nullifier))}

/// Proof blob in \`authorize_action\` wire form: a (64) || b (128) || c (64).
${arr("PROOF_BYTES", proofBytes)}

/// The 14 public signals (canonical order) the proof verifies against.
${arr2("PUB_SIGNALS", signalRows)}
`;
writeFileSync(OUT_RS, rs);

console.log(`wrote ${OUT_RS}`);
console.log(`wrote ${SIDECAR}`);
console.log("  agent            :", AGENT);
console.log("  recipient        :", RECIPIENT);
console.log("  asset            :", ASSET);
console.log("  verifier         :", VERIFIER_CONTRACT);
console.log("  policyCommitment :", policy.commitment.toString());
console.log("  nullifier        :", nullifier.toString());
console.log("  prevEpochId      :", PREV_EPOCH_ID.toString());
process.exit(0); // snarkjs keeps curve worker threads alive
