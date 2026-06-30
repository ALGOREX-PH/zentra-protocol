# Zentra Protocol

**The ZK policy layer for autonomous AI agents on Stellar.**

> Let agents act. Make them prove it. -- *No proof, no payment.*

Zentra lets developers build AI agents that can trigger Stellar payments **only after proving, in zero knowledge, that they followed private, user-defined policies.** Before an agent moves money, it generates a Groth16 proof that the action obeys the policy -- approved vendors, spending limits, invoice requirements, replay protection -- and a Soroban smart contract verifies that proof, checks it against the agent's authoritative on-chain state, and only then releases the payment.

Private rules stay private. Agent actions become verifiable.

> **Looking for the dApp or the Stellar hackathon belts (White → Green)?**
> The live testnet dApp — Freighter wallet connect/disconnect, XLM balances, and
> payments — plus all four belt submissions live in the
> **[zentra-docs](https://github.com/ALGOREX-PH/zentra-docs)** repo
> ([live app](https://zentra-docs.vercel.app/app)). *This* repo is the underlying ZK
> protocol: the Circom circuits, the Soroban verifier, the SDK, and the CLI.

## Verified live on Stellar testnet

The 3-panel demo runs end-to-end against testnet:

- **Panel A (legitimate):** policy registered, proof generated, contract verified it, **payment settled** -- real tx [`92ad909c...`](https://stellar.expert/explorer/testnet/tx/92ad909c0a00b446bb3718243de3020f885a1868b9bf859dac169eb046926575)
- **Panel B (compromised agent):** prompt injection to pay an attacker -> **no proof could be produced** (recipient not in the Merkle root)
- **Panel C (over-spend):** agent lies about prior spend -> **contract's AuthorityState check rejected it; no money moved**

Verifier contract: `CDS6BURFWRTU6FXN6IXOSKOIAZ4PX7XJ6U5FSI345XX3O5FGP7U3K7VY`

## Why this is real (not security theater)

1. **It verifies a real ZK proof on-chain.** Stellar **Protocol 25 ("X-Ray")** shipped BN254 host functions (CAP-0074) and **Protocol 26 ("Yardstick")** added BN254 multi-scalar-multiplication (CAP-80). Zentra's Soroban contract uses these to verify a Circom/snarkjs Groth16 proof in **~26M of the 100M CPU budget** -- comfortably on-chain.
2. **The proof is bound to authoritative on-chain state.** A naive ZK policy check lets a compromised agent claim `dailySpent = 0` every time. Zentra's contract maintains an `AuthorityState` per `(agent, policy)` and rejects any proof whose claimed prior spend does not match the chain. The agent **cannot lie about its own history.**

## The developer API

```ts
import { Zentra } from "@zentra/sdk";

const zentra = new Zentra({ contractId: "CDLZ...", asset: usdcSac, circuit });
const policy = await zentra.createPolicy({
  name: "vendor-payment",
  maxAmount: 100n * 10_000_000n,
  dailyLimit: 500n * 10_000_000n,
  approvedRecipients: ["GABC...", "GBXQ...", "GDLR..."],
});
await zentra.commitPolicy(agent, policy);

const guarded = zentra.guard(agent, policy);   // the agent can ONLY pay through Zentra
await guarded.pay({ recipient: "GABC...", amount: 75n * 10_000_000n, invoicePreimage });
//  proof generated -> verifier accepted -> payment released
```

## Run the demo

```bash
pnpm install
# 1. build the circuit + proving artifacts (Circom + snarkjs, BN254)
bash circuits/payment-policy/build.sh
# 2. build/test the contract
cd contracts/zentra-verifier && cargo test && cd -
# 3. run the live testnet demo (funds throwaway accounts via friendbot)
pnpm --filter @zentra/example-vendor-payment-agent demo
```

## Architecture

```
Developer defines private policy
   -> Poseidon commitment + Merkle root of approved recipients
Agent proposes an action
   -> Zentra SDK reads AuthorityState from chain
Zentra prover generates a Groth16/BN254 proof
   -> bound to (policy, recipient, amount, prior state, nullifier)
Soroban verifier checks proof + state + nullifier
   -> payment executes if valid, and emits a Verifiable Action Receipt
```

The circuit proves: `Poseidon(rules,salt) == commitment`, recipient is in the Merkle root, `amount <= max`, `prevSpent + amount <= dailyLimit`, a valid state transition, `Poseidon(invoicePreimage) == invoiceHash`, and a correct nullifier.

## Repository

```
zentra-protocol/
  circuits/payment-policy/        Circom circuit + build/test scripts (BN254, Poseidon)
  contracts/zentra-verifier/      Soroban contract: verify proof, enforce state, settle
  packages/serialization/         canonical byte-exact public-input codec (circuit<->contract<->SDK)
  packages/sdk/                   @zentra/sdk -- the product
  packages/cli/                   zentra CLI
  examples/vendor-payment-agent/  the 3-panel demo
```

Why a monorepo: the circuit, contract, and SDK share a byte-for-byte public-input serialization. They must version atomically, in the same commit.

## Scope boundary (what Zentra is *not*)

Zentra is a proof-of-compliance and settlement layer. It is **not** an identity system, an oracle, a policy author, or a key manager. It enforces the rules you give it; it does not decide whether those rules are wise, whether an invoice is real, or protect keys you leak.

## Roadmap (articulated, not in the v0.1 MVP)

ERC-8004 / stellar8004 agent identity + reputation from Verifiable Action Receipts; ERC-7715 scoped wallet permissions; composable / multi-policy authority; non-payment actions (contract calls, treasury, API payments); on-chain CAP-0075 Poseidon receipt hashing; Noir / RISC Zero proof backends.

---

*Built on Stellar. Circom + snarkjs (Groth16, BN254) -> Soroban verifier (soroban-sdk v26 BN254 host functions) -> TypeScript SDK + CLI.*
