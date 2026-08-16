# Zentra Protocol — Documentation Website PRD

**Status:** Draft v1.0
**Date:** 2026-06-18
**Owner:** Zentra Protocol
**Scope:** A full documentation website (`docs.zentra.*`) — marketing landing, complete developer documentation, an interactive proof playground, and a blog/changelog — built on Fumadocs (Next.js).
**Relationship to other docs:** This PRD governs the *website*. The protocol product spec is `PRD.md`; the repo overview is `README.md`. This document does not redefine the protocol; it specifies how the protocol is explained, demonstrated, and referenced on the web.

---

## 1. Context

Zentra Protocol is a working, testnet-proven ZK policy-enforcement layer for autonomous AI agents on Stellar. Before an agent can move money, it must generate a Groth16 zero-knowledge proof that the action obeys a **private**, user-defined policy — approved recipients (a Merkle root), a per-invoice cap, a daily spend limit, an invoice-hash match, and a single-use nullifier — and that proof is **bound to the agent's authoritative on-chain state**, so the agent cannot lie about prior spend. A Soroban contract verifies the proof, checks the state binding, enforces nullifier uniqueness, settles the payment, and emits a Verifiable Action Receipt. The thesis: **"Let agents act. Make them prove it."** The promise: **"No proof, no payment."**

**The problem this website solves.** Today the protocol's entire public surface is two files: `PRD.md` (a ~1,500-line internal product spec) and a 97-line `README.md`. The code is real — the demo settles a live payment on Stellar testnet, blocks a prompt-injected payment at proof time, and blocks an over-spend at the contract's on-chain state check — but it is effectively undiscoverable and unlearnable by anyone outside the repo. There is:

- no place to understand *why* Zentra exists (the agentic-payments trust gap),
- no hands-on path for a developer to integrate the SDK in their first session,
- no authoritative, drift-proof reference for the SDK, CLI, contract, circuit, and the byte-exact serialization that ties them together,
- no way for an evaluator, judge, or prospective integrator to *see* the proof→verify→pay loop without cloning the repo and building Circom artifacts.

A documentation website is the protocol's front door, its teacher, its reference manual, and its proof-of-life — in one place.

**Intended outcome.** Ship a website where (a) a newcomer grasps the thesis and the threat model in two minutes, (b) a developer goes from zero to a verified proof on testnet in their first sitting, (c) a Stellar/Soroban engineer can audit exactly how on-chain Groth16/BN254 + CAP-0075 Poseidon verification works and what it costs, and (d) anyone can watch the three security panels run interactively — and optionally generate a real proof in their own browser.

---

## 2. Vision, goals & non-goals

### 2.1 Vision

The canonical home for Zentra Protocol: the clearest explanation of *why proof beats surveillance for agentic payments*, the fastest on-ramp for building proof-gated agents on Stellar, and a living, always-accurate reference that cannot drift from the code it documents.

### 2.2 Goals

| # | Goal | How we'll know |
|---|------|----------------|
| G1 | Communicate the thesis & threat model fast | A first-time visitor can restate "no proof, no payment" and name the over-spend/injection threats after the landing + Start Here pages |
| G2 | Get a developer to a verified proof quickly | Quickstart is completable in one sitting on testnet; "time-to-first-proof" is measured |
| G3 | Be the authoritative, drift-proof reference | Every documented signature, error code, public-input name, and event field is verified against source in CI |
| G4 | Make the proof loop *tangible* | The playground replays the three panels for everyone and runs a real in-browser proof for the curious |
| G5 | Serve all three audiences from one IA | Developers, Stellar engineers, and evaluators each have a clear path without three parallel trees |
| G6 | Establish a distinctive, trustworthy brand | Visual language reads as "cryptographic trust," cohesive with the upcoming app frontend |

### 2.3 Non-goals (v1)

- **Not** the protocol spec itself — `PRD.md` remains the product source of truth; the site *explains* it.
- **Not** the application frontend (the upcoming agent-management UI is a separate workstream; the docs site shares design tokens but ships independently).
- **No** authenticated areas, dashboards, or user accounts.
- **No** mainnet operations guidance beyond what the protocol actually supports (testnet is the live target today).
- **No** i18n/localization in v1 (English only; structure the content so i18n is addable later).
- **No** documentation of roadmap features as if they exist — deferred capabilities (ERC-8004/stellar8004, ERC-7715 scoped permissions, contract-vault treasury, non-payment actions, Noir/RISC Zero backends, multi-asset) appear only under Roadmap, clearly labeled as future.

---

## 3. Audiences & personas

The site is **balanced** across three audiences. Content uses a single journey-led IA with lightweight audience signposts (callouts and "next step" links) rather than three separate trees.

### Persona A — "Maya," the agent developer (primary hands-on)
Builds autonomous agents (payments, procurement, treasury ops) in TypeScript. Wants to bolt policy enforcement onto an agent *without* learning ZK theory. Cares about: install, `createPolicy`, `guard(agent)`, `.pay(...)`, error handling, and what happens when an agent misbehaves.
**Jobs-to-be-done:** "Stop my agent from paying the wrong person or overspending — provably — in an afternoon."
**Entry points:** Landing → Quickstart → Guides (integrate the SDK, guard an agent) → SDK Reference.

### Persona B — "Dev," the Stellar/Soroban engineer (technical evaluator)
Evaluates whether on-chain ZK verification is real and affordable on Soroban. Cares about: the verifier contract interface, BN254 host functions (CAP-0074), Poseidon (CAP-0075), MSM (CAP-80 / Protocol 26), the resource budget, and the byte-exact serialization contract.
**Jobs-to-be-done:** "Verify the cryptography is sound and the per-transaction cost fits the ledger budget."
**Entry points:** Landing → How it works → Reference (contract interface, circuit spec, serialization).

### Persona C — "Sam," the evaluator/newcomer (judge, investor, protocol-curious)
Assessing significance and credibility. Cares about: the problem, why this is newly possible, the live demo, the roadmap, and the boundary of what Zentra claims.
**Jobs-to-be-done:** "Decide in ten minutes whether this is novel, real, and worth backing."
**Entry points:** Landing → Playground → Start Here (thesis, threat model, boundary statement) → Roadmap.

---

## 4. Success metrics

**Primary**
- **Time-to-first-proof (TTFP):** median minutes from landing to a completed proof (playground "real proof" run, or Quickstart success self-report). Target: under 15 minutes for the playground path.
- **Quickstart completion rate:** % of Quickstart starters who reach the "you have a verified proof" step (instrumented via step anchors / events).
- **Playground engagement:** % of unique visitors who run at least one panel; secondary: % who trigger a real in-browser proof.

**Secondary**
- Docs search success (queries with a click-through vs. zero-result queries).
- Reference accuracy incidents (target: **zero** shipped signature/code drifts, enforced by CI gate G3).
- Roadmap/Blog return visits; outbound clicks to GitHub, the live verifier on Stellar Expert, and the Quickstart.
- Core Web Vitals pass rate (see §13).

**Guardrail**
- Bounce on landing under target; no regression in Lighthouse performance/accessibility below the budgets in §13.

---

## 5. Site scope & surfaces

Five surfaces ship in v1:

1. **Landing page** — sells the thesis and routes each audience (§9).
2. **Documentation** — Start Here, Quickstart, Concepts, Guides, How it works, Reference (§7, §8).
3. **Interactive proof playground** — hybrid: guided 3-panel replay for everyone + opt-in real in-browser proving (§10).
4. **Blog / Changelog** — releases, deep-dives, testnet results (§7.7).
5. **Roadmap** — v0.1 → v1.0 "cross-chain agent trust stack" (§7.8).

Cross-cutting: global search, dark/light theming, responsive layout, SEO/social metadata, analytics, accessibility, and a CI doc-accuracy gate.

---

## 6. Information architecture & sitemap

Approved approach: **journey-led, Diátaxis-backed.** Top navigation follows the reader's path; inside Docs we keep Diátaxis discipline (tutorial / how-to / reference / explanation) so each page has exactly one job.

```
/                                  Landing
/docs
  /start-here                      Why Zentra · the trust gap · "no proof, no payment"
    /problem                       The agentic-payments threat model
    /how-zentra-answers            Proof vs. surveillance; the three questions (who/what/did-it)
    /what-zentra-is-not            Boundary statement (verbatim)
  /quickstart                      0 → verified proof on testnet (the golden path)
  /concepts
    /proof-of-compliance           The core idea
    /policy-and-commitment         Policy, Poseidon commitment, salt, hiding
    /recipient-allowlist           Poseidon-Merkle root (depth 4 / 16 leaves)
    /authority-state               epoch_id · spent_in_epoch · action_count
    /epochs-and-limits             Daily-limit rollover math
    /nullifiers                    Single-use replay protection
    /verifiable-action-receipt     The receipt + CAP-0075 action_id
    /privacy-model                 What stays private vs. public
  /guides
    /define-a-policy               SDK + CLI
    /integrate-the-sdk             Wire Zentra into an agent
    /guard-an-agent                The guard() adapter; why direct pay is impossible
    /three-failure-modes           Legit / prompt-injection / over-spend, end to end
    /cli-workflow                  init → policy → prove → submit
    /deploy-your-own-verifier      Build, deploy, register policies on testnet
    /read-receipts                 Consume ActionReceipt events
  /how-it-works
    /overview                      End-to-end flow diagram
    /the-circuit                   14 public inputs, constraints, Poseidon arities
    /on-chain-verification         Groth16/BN254, MSM, pairing check, CPU budget
    /poseidon-on-chain             CAP-0075 receipt hashing
    /state-binding                 How prev_* binds a proof to chain state (anti-over-spend)
    /why-now                       Protocol 25/26, CAP-0074/0075/80
  /reference
    /sdk                           @zentra/sdk — Zentra, GuardedAgent, proveAction, StatusEvent, types
    /cli                           zentra — init, policy, prove, submit
    /contract                      ZentraVerifier — methods, errors, events, storage
    /circuit                       payment_policy.circom — signals, constraints, build
    /serialization                 @zentra/serialization — codec, public-input order, byte layout
    /errors                        Error enum (codes 1–8) + SDK error surfaces
    /receipt-schema                Verifiable Action Receipt JSON
/playground                        Guided panels + real in-browser proof (opt-in)
/blog                              Posts + changelog entries
/roadmap                           v0.1 → v1.0
```

**Navigation chrome.** Top bar: Docs · Playground · Blog · Roadmap · GitHub · "Live on testnet" (links to the verifier on Stellar Expert). Left sidebar within Docs mirrors the tree above. Right "On this page" TOC on reference/explanation pages. Persistent search (`⌘K`/`Ctrl-K`). Audience signpost callouts appear at the top of section landings (e.g., Start Here → "Building an agent? Skip to Quickstart. Evaluating the crypto? Jump to How it works.").

---

## 7. Content inventory (page-by-page)

Every page below lists its **job**, **key content**, and the **verified source** the writer must mirror. Source-of-truth facts are consolidated in the Appendix (§18); reference pages must match it exactly (enforced by §11 / §16 CI).

### 7.1 Start Here

- **/start-here** — *Job:* state the thesis in under two minutes. *Content:* "Let agents act. Make them prove it." / "No proof, no payment." The one-liner: *"Zentra lets developers build AI agents that can trigger Stellar payments only after proving, in zero knowledge, that they followed private, user-defined policies."* The category framing: *"Every action a proof. Every proof a receipt. Every receipt reputation."* Short "is this for me?" audience router.
- **/start-here/problem** — *Job:* make the threat visceral. *Content:* the agentic-payments trust gap; why identity + permission are insufficient; named threats — prompt injection, over-spend/drain, replay, fabricated spend history, silent policy tampering; "logs after the fact are forensics, not security."
- **/start-here/how-zentra-answers** — *Job:* the core mental model. *Content:* the three questions of agentic finance — *who is this agent?* (identity), *what is it allowed to do?* (permissions), and the one Zentra answers: *did this specific action, right now, actually obey the rules — without exposing private details?* Proof replaces surveillance.
- **/start-here/what-zentra-is-not** — *Job:* set boundaries, build trust. *Content:* the boundary statement, **verbatim** — "Zentra is a proof-of-compliance and settlement layer. It is **not** an identity system, an oracle, a policy author, a key manager, or a full compliance engine."

### 7.2 Quickstart (the golden path)

- **/quickstart** — *Job:* zero → verified proof in one sitting on testnet. *Content (numbered, copy-pasteable):*
  1. Prereqs (Node, pnpm, a testnet keypair; link to funding via friendbot).
  2. Install (`pnpm add @zentra/sdk`) and point at the live verifier + native XLM SAC.
  3. `createPolicy({ name, maxAmount, dailyLimit, approvedRecipients })`.
  4. `commitPolicy(agent, policy)` — register on testnet.
  5. `const guarded = zentra.guard(agent, policy)` then `guarded.pay({ recipient, amount, invoicePreimage })`.
  6. Observe the `StatusEvent` sequence: `proving → proof-ready → submitting → released`.
  7. Read the receipt / open the tx on Stellar Expert.
  *Source:* SDK surface (§18.4), demo (`examples/vendor-payment-agent/demo.ts`). *Note:* contract id and asset must be injected from the single source-of-truth config (§16), never hardcoded in prose.

### 7.3 Concepts (explanation)

- **/concepts/proof-of-compliance** — the zero-knowledge proof that a *proposed* action obeyed the private policy **and** current Authority State; why "proposed, then proven, then settled" differs from "act, then log."
- **/concepts/policy-and-commitment** — a Policy (name, asset, `maxAmount`, `dailyLimit`, approved recipients, `epochSeconds`, secret `salt`); the on-chain commitment `Poseidon(maxAmount, dailyLimit, recipientRoot, assetField, salt)`; why the salt is secret (hiding) and what registering a commitment does vs. revealing the policy.
- **/concepts/recipient-allowlist** — the approved-recipient set as a Poseidon-Merkle tree, **depth 4 (16 leaves)**, leaf = `Poseidon(recipientField)`, padded with `0` sentinels; proving membership without revealing the full vendor list.
- **/concepts/authority-state** — `AuthorityState { epoch_id: u64, spent_in_epoch: i128, action_count: u64 }`; the authoritative per-(agent, policy) record; why it lives on-chain.
- **/concepts/epochs-and-limits** — `current_epoch = ledger.timestamp() / epoch_seconds`; on rollover `spent_in_epoch` resets to 0 while `action_count` is preserved; the SDK must compute the *effective prior* identically (a one-off here causes false rejections).
- **/concepts/nullifiers** — `nullifier = Poseidon(agentAddress, policyCommitment, contractAddress, nonce)`; single-use replay protection; why nullifiers are stored **persistently** (an expiring nullifier re-enables replay).
- **/concepts/verifiable-action-receipt** — the portable, proof-backed attestation emitted on success; its fields; the CAP-0075 Poseidon `action_id` as canonical receipt id; "reputation that is cryptographically earned, not self-claimed."
- **/concepts/privacy-model** — table of **private** (full vendor list, policy thresholds, daily-spend history, invoice contents, agent instruction context) vs. **public** (proof validity, policy commitment, nullifier, action id, payment eligibility).

### 7.4 Guides (how-to)

Task-oriented, each with a single outcome and copy-pasteable code:
- **/guides/define-a-policy** — via SDK (`createPolicy`) and via CLI (`zentra policy create … --max-amount --daily-limit --allowlist`).
- **/guides/integrate-the-sdk** — construct `Zentra({ contractId, asset, circuit, onStatus })`; wire `onStatus` to your UI/logs.
- **/guides/guard-an-agent** — the `guard()` adapter and `GuardedAgent.pay`; why an agent **cannot** call payment directly; this is Panel B's mechanism (a non-allowlisted recipient throws at prove time).
- **/guides/three-failure-modes** — run all three panels end to end: legitimate payment settles; prompt-injection blocked at proof generation; over-spend blocked by the contract's `StateMismatch` check. Mirrors the demo.
- **/guides/cli-workflow** — `init → policy create → policy commit → prove → submit`; the `ZENTRA_AGENT_SECRET` env var; the `policies/ actions/ proofs/` scaffold and `zentra.config.json`.
- **/guides/deploy-your-own-verifier** — build the contract (`wasm32v1-none`), deploy with stellar-cli, register policies; note `soroban-sdk` features and the `soroban-poseidon` dependency.
- **/guides/read-receipts** — subscribe to / parse `ActionReceipt` events; reconstruct the receipt JSON off-chain.

### 7.5 How it works (explanation, deeper)

- **/how-it-works/overview** — the full loop diagram: define policy → SDK reads `AuthorityState` → prover builds a Groth16/BN254 proof bound to (policy, recipient, amount, prior state, nullifier) → Soroban verifies proof + state + nullifier → payment settles → receipt emitted.
- **/how-it-works/the-circuit** — the **14 public inputs in canonical order**, the 7 private inputs, and the six constraint families (commitment opening, Merkle membership, range checks, state transition, invoice binding, nullifier derivation), with exact Poseidon arities.
- **/how-it-works/on-chain-verification** — `Proof { a: G1, b: G2, c: G1 }`; the 256-byte blob layout (a 64 ‖ b 128 ‖ c 64); `vk_x = IC[0] + Σ pubᵢ·IC[i]` via MSM; the pairing check `e(-A,B)·e(α,β)·e(vk_x,γ)·e(C,δ) == 1`; vk has **15 IC points**; the measured cost (**~26M of the 100M CPU budget** on testnet).
- **/how-it-works/poseidon-on-chain** — CAP-0075 host Poseidon recomputes the receipt `action_id = Poseidon(agent, recipient, amount, nullifier, new_spent)` (arity 6), inputs reduced mod the scalar field.
- **/how-it-works/state-binding** — how `prev_epoch_id / prev_spent / prev_action_count` in the proof must equal the contract's *effective prior* state; this is what makes lying about prior spend impossible (Panel C).
- **/how-it-works/why-now** — Protocol 25 "X-Ray" (CAP-0074 BN254 host fns, CAP-0075 Poseidon), Protocol 26 "Yardstick" (CAP-80 BN254 MSM); why this stack is *newly* feasible on Soroban and why Groth16/BN254 + Circom is the right MVP choice.

### 7.6 Reference (hybrid: curated + source-verified — see §11)

- **/reference/sdk** — `@zentra/sdk`: `Zentra` (constructor `ZentraConfig`, methods `createPolicy`, `commitPolicy`, `readState`, `pay`, `guard`); `GuardedAgent.pay`; `proveAction(policy, ctx, artifacts)`; `StatusEvent` union (`proving`/`proof-ready`/`submitting`/`released`/`blocked`); types `Policy`, `PolicyConfig`, `PayRequest`, `PayResult`, `ActionContext`, `CircuitArtifacts`, `ProveResult`, `AuthorityState`, `ConfirmedTx`; `TESTNET` constants.
- **/reference/cli** — `zentra`: `init [--contract --asset]`, `policy create <name> [--max-amount --daily-limit --allowlist --asset --epoch-seconds]`, `policy commit <file>`, `prove <actionFile> --policy <file>`, `submit <proofFile>`; `zentra.config.json` shape; `ZENTRA_AGENT_SECRET`.
- **/reference/contract** — `ZentraVerifier`: `register_policy`, `authority_state`, `revoke_policy`, `verify_proof`, `authorize_action` (full arg lists + the ordered state machine); `AuthorityState`, `PolicyRecord`, `DataKey`; storage tiers + TTLs.
- **/reference/circuit** — `payment_policy.circom`: signals, constraints, depth, curve, tooling (circom 2.2.3, snarkjs 0.7.6, pot14), the build pipeline and generated artifacts (`vk.rs`, fixtures).
- **/reference/serialization** — `@zentra/serialization`: `FR_MODULUS`, `PUBLIC_INPUT_ORDER` (14), `modFr`, `fieldToBytes32`, `bytes32ToField`, `amountToField`, `addressToField`, `toHex`, `encodePublicInputs`, `publicInputsToDecimal`; byte layouts (Fr 32B BE; address payload reduced mod r; i128 right-aligned 16+16; u64 right-aligned 24+8).
- **/reference/errors** — `Error` enum codes 1–8 (`MalformedVerifyingKey`, `PolicyNotFound`, `PolicyRevoked`, `InvalidProof`, `StateMismatch`, `NullifierUsed`, `InvalidAmount`, `Overflow`) with the SDK-level symptom and likely cause of each.
- **/reference/receipt-schema** — the `ActionReceipt` event fields (`agent`, `policy`, `recipient`, `amount`, `asset`, `nullifier`, `epoch_id`, `new_action_count`, `action_id`) and the off-chain receipt JSON.

### 7.7 Blog / Changelog

- **/blog** — chronological posts; categories: Releases, Deep-dives, Testnet results. Seed posts: "Verifying a Groth16 proof inside Soroban for ~26M CPU"; "Why state-bound proofs beat naive policy checks"; "On-chain Poseidon receipts (CAP-0075)." Changelog entries link to releases and (where relevant) the migrating contract id.

### 7.8 Roadmap

- **/roadmap** — the staged plan, clearly labeled future: v0.2 Policy Runtime (composable/versioned/revocable policies, a TypeScript policy DSL, templates); v0.3 Beyond Payments (contract calls, treasury actions, API payments, workflow approvals); v0.4 Reputation from Verified Actions (ERC-8004/stellar8004 connector, receipts → reputation); v0.5 Scoped Permissions (ERC-7715-style); v1.0 Cross-Chain Agent Trust Stack (identity + permission + compliance + settlement + reputation). Also: Noir/RISC Zero backends, recursive proof aggregation, multi-asset.

---

## 8. Page templates

Five reusable layouts (Fumadocs MDX + shared components):

1. **Doc page (default)** — sidebar + content + right TOC; frontmatter `title`, `description`, `audience?`, `nextSteps[]`.
2. **Concept page** — adds a "mental model" callout and a "see it in code" cross-link to the matching reference/guide.
3. **Reference page** — structured API blocks (signature, params table, returns, throws, example), each block tagged with a `source` pointer used by the accuracy check (§11).
4. **Guide page** — outcome statement at top, numbered steps, "verify it worked" checkpoint, copy buttons on all code.
5. **Landing / marketing** — full-bleed sections, motion, CTAs (§9).

Shared MDX components: `Callout` (note/warning/audience), `Steps`, `CodeTabs` (SDK/CLI), `ApiBlock`, `PublicInputsTable`, `FlowDiagram`, `ProofPanel` (embeds a playground panel inline), `StatusEventTimeline`, `LiveContractBadge` (reads the current testnet contract id from config).

---

## 9. Landing page specification

*Job:* in one scroll, make Sam care, make Maya want to build, and make Dev believe the crypto is real.

**Section order (wireframe):**

```
┌───────────────────────────────────────────────────────────────┐
│ NAV  Zentra   Docs  Playground  Blog  Roadmap   GitHub  ◍testnet│
├───────────────────────────────────────────────────────────────┤
│  HERO                                                           │
│   "Let agents act. Make them prove it."                         │
│   Subhead: AI agents trigger Stellar payments only after        │
│   proving, in zero knowledge, they followed your private rules. │
│   [ Start building ]   [ Try the playground ]                   │
│   ◍ Live on Stellar testnet — verified Groth16 in ~26M CPU      │
├───────────────────────────────────────────────────────────────┤
│  THE GAP   identity ✓  permission ✓  "did this action obey      │
│            the rules, right now, privately?" ✗  ← Zentra        │
├───────────────────────────────────────────────────────────────┤
│  THREE PANELS (animated, pulls from playground fixtures)        │
│   A legitimate → settles   B injection → blocked at proof       │
│   C over-spend → blocked on-chain                               │
├───────────────────────────────────────────────────────────────┤
│  HOW IT WORKS  (4-step flow diagram → links to How it works)    │
├───────────────────────────────────────────────────────────────┤
│  CODE   createPolicy → guard(agent) → guarded.pay(...)          │
│         (CodeTabs: SDK / CLI)                                   │
├───────────────────────────────────────────────────────────────┤
│  WHY NOW  Protocol 25/26, CAP-0074/0075/80 — on-chain ZK is     │
│           real and affordable on Soroban                        │
├───────────────────────────────────────────────────────────────┤
│  BOUNDARY  "Zentra is a proof-of-compliance and settlement      │
│             layer. It is not…"  (builds trust)                  │
├───────────────────────────────────────────────────────────────┤
│  CTA   Build a guarded agent in 15 minutes →  Quickstart        │
│  FOOTER  docs · playground · blog · roadmap · GitHub · X        │
└───────────────────────────────────────────────────────────────┘
```

**Hero copy is fixed** to the protocol's voice. The "three panels" block reuses the playground's fixtures so the marketing animation and the interactive demo never tell different stories. The "Live on testnet" badge is data-driven from the same config that feeds docs (§16).

---

## 10. Interactive proof playground specification

Approved model: **hybrid — guided replay for everyone, real in-browser proving opt-in.**

### 10.1 Default mode — Guided panels (always works)
A stepped, animated walkthrough of the three scenarios, driven by **pre-captured real fixtures** (a real proof, real public signals, a real settled-tx hash) committed to the site:
- **Panel A — Legitimate payment:** compose a payment to an approved vendor → watch `proving → proof-ready → submitting → released` → open the real settled tx on Stellar Expert.
- **Panel B — Prompt injection:** attempt to pay a non-allowlisted "attacker" → the prover refuses *before* producing a proof (recipient not in the Merkle root) → "no proof, no payment."
- **Panel C — Over-spend:** the agent lies about prior spend (`prevSpent = 0`) → a valid-looking proof is produced → the contract's `StateMismatch` check rejects it; no money moves.
Each panel shows the `StatusEvent` timeline, the (redacted) public inputs, and a plain-language explanation of *which* check fired. Deterministic, offline-capable, fast.

### 10.2 Advanced mode — Real in-browser proof (opt-in)
Behind an explicit "Generate a real proof in your browser" toggle (warns about a multi-MB artifact download and CPU cost):
- Load `payment_policy.wasm` + `.zkey` and run `snarkjs.groth16.fullProve` in a **Web Worker** (keeps the UI responsive).
- Let the user pick a recipient (in-set vs. out-of-set) and an amount; show the assembled circuit inputs, then the generated proof + 14 public signals.
- **Verification options:** (a) verify the proof client-side against the embedded verification key (always available, no network); (b) *optional* "submit to testnet" via a **managed, rate-limited demo agent** behind a serverless route — clearly marked as a shared sandbox, with graceful failure if unfunded/unavailable.

### 10.3 Architecture & fallbacks
- snarkjs + artifacts loaded lazily, only on advanced opt-in; proving runs in a Web Worker; progress streamed to the UI.
- Fixtures for default mode are generated by a repo script and version-pinned to the deployed circuit/contract (so a panel never contradicts the live protocol).
- The optional submit route holds the demo agent secret server-side (never in the client), enforces rate limits, and degrades to "client-side verification only" if the sandbox is down. The default (guided) mode has **zero** external dependencies and is the canonical experience for evaluators.
- Performance guardrail: advanced mode must not block first paint; artifacts are never on the critical path for landing/docs.

---

## 11. API-reference strategy (hybrid: curated + verified)

Reference pages are **hand-authored** (narrative, examples, "why") but every machine-checkable fact is **verified against source in CI** so docs cannot silently drift.

**What's verified (the contract between docs and code):**
- SDK: exported symbol names and public method/function signatures of `@zentra/sdk` and `@zentra/serialization`.
- CLI: command names and flags registered in the commander program.
- Contract: `ZentraVerifier` method names/arity, the `Error` enum variants + codes, the `ActionReceipt` field set.
- Circuit/serialization: the `PUBLIC_INPUT_ORDER` (the 14 names, in order) and `FR_MODULUS`.

**How:** each `ApiBlock` carries a `source` key (e.g., `sdk:Zentra.createPolicy`). A build-time check extracts the real symbols (TypeScript compiler API / TypeDoc JSON for TS; a small parser or generated JSON for the Rust enum/event and the circuit's public list) and asserts the documented set matches. A mismatch **fails CI** (gate G3). Prose, examples, and explanations remain free-form; only the enumerated facts are gated. This keeps polish high and drift impossible without forcing fully generated, narrative-poor pages.

---

## 12. Design system & brand direction

**Direction:** "cryptographic trust" — precise, technical, confident; not playful, not enterprise-bland. The emotional target is *verified*, not *hopeful*.

- **Mode:** dark-first with a high-quality light theme. Deep near-black canvas, a single strong accent (electric/verification hue) used sparingly for "proof/verified" states, plus a clear "blocked/denied" red used only for the rejection panels.
- **Typography:** a precise grotesk/sans for UI and headings; a crisp monospace for code, hashes, field elements, and the public-input tables (hashes and addresses should *look* cryptographic).
- **Motion:** restrained, purposeful — the proof→verify→settle timeline animates; the three panels have distinct success/blocked motion signatures. Respect `prefers-reduced-motion`.
- **Iconography/motif:** a verification/seal/lattice motif; the ✓ (proof accepted) and ✗ (blocked) are first-class brand marks tied to the protocol's checkmark output.
- **Cohesion:** ship design tokens (color, type scale, spacing, radii) as a shared package so the upcoming app frontend inherits the same language. Tokens live with the docs app but are structured for extraction.
- **Components:** built on the Fumadocs UI layer; product/marketing components composed in the same system; accessible color contrast (WCAG AA) verified.

A full visual design (hi-fi mockups) is a follow-on activity once this PRD is approved; this section fixes the *direction*, not the pixels.

---

## 13. Technical architecture

- **Framework:** Fumadocs on **Next.js (App Router)**, MDX content, React Server Components where appropriate.
- **Repo placement:** monorepo app at **`apps/docs`** (extends the existing pnpm workspace alongside `packages/*` and `examples/*`), so the site can import types from `@zentra/sdk`/`@zentra/serialization` for reference verification and reuse fixtures. Ships independently of the protocol packages.
- **Content:** MDX in `apps/docs/content/**`; navigation/meta via Fumadocs `meta.json`/source config; frontmatter per §8.
- **Search:** Fumadocs built-in (Orama) for v1 (no external dependency, static-friendly); Algolia DocSearch as a drop-in upgrade if scale warrants.
- **Playground:** snarkjs in a Web Worker; artifacts served as static assets with long-cache headers, loaded only on advanced opt-in; the optional testnet-submit route is a serverless function holding the demo secret.
- **Deployment:** **Vercel** (preview deploys per PR, production on main). Environment config for the live contract id / asset / RPC injected at build (§16).
- **Analytics:** privacy-respecting product analytics for the §4 metrics (page/section funnels, playground events, search queries); no PII, cookie-light.
- **CI:** lint + typecheck + build; the **doc-accuracy gate** (§11); link-checker; Lighthouse CI against the budgets below.
- **Performance budgets:** Core Web Vitals "good" (LCP < 2.5s, CLS < 0.1, INP < 200ms) on landing and docs; JS kept off the critical path; snarkjs/artifacts **excluded** from initial load. Lighthouse: Performance ≥ 90, Accessibility ≥ 95, Best Practices ≥ 95, SEO ≥ 95 on key pages.
- **Accessibility:** WCAG 2.1 AA — keyboard-navigable nav/search/playground, focus management, `prefers-reduced-motion`, AA contrast, alt text on diagrams.

---

## 14. SEO, metadata & social

- Per-page `<title>`/meta description from frontmatter; canonical URLs; sitemap.xml; robots.txt.
- Open Graph / Twitter cards; a branded default OG image plus per-section variants (auto-generated OG images for docs pages via the framework's OG image route).
- Structured data where it helps (Article for blog, BreadcrumbList for docs).
- Stable URL scheme (the §6 tree); a redirects map so future restructures don't break inbound links; descriptive slugs.
- Target queries: "ZK policy enforcement AI agents," "Soroban Groth16 verifier," "proof-gated agent payments Stellar," "on-chain Poseidon Soroban."

---

## 15. Versioning & maintenance

- **v1 is unversioned** (single "latest"), matching the protocol's pre-1.0 stage; the IA and Fumadocs config leave room to add versioned docs later without restructuring.
- **Drift control:** the §11 accuracy gate is the primary defense; in addition, reference pages link to the exact source files, and the changelog records contract-id migrations.
- **Single source of truth for live facts** (§16): the current testnet contract id, asset, RPC, and the published CPU-budget figure live in one config consumed by docs, the landing badge, the playground, and Quickstart — so a redeploy updates everything at once. (Today the README's contract id and the demo's default differ; the site must not reproduce that split.)
- **Ownership:** docs ship in the same PRs as protocol changes that alter the public surface; a PR that changes an SDK signature or contract method without updating the gated reference set fails CI.

---

## 16. Configuration: single source of truth for live facts

A small committed config (e.g., `apps/docs/config/protocol.ts`) holds:
- `contractId` (current testnet `ZentraVerifier`), `assetId` (native XLM SAC used by the demo), `rpcUrl`, `networkPassphrase`,
- `cpuBudget` (e.g., "~26M / 100M"), `samplePanelTxHash` (the real settled Panel-A tx),
- circuit/tooling pins surfaced in docs (circom 2.2.3, snarkjs 0.7.6, `soroban-sdk` 26.1.0).

Every surface (landing badge, Quickstart, playground, reference notes) reads from this — no hardcoded ids in prose. Updating it on redeploy is the only change needed to keep the whole site current.

---

## 17. Milestones / phased delivery

**M0 — Foundations (scaffold).** `apps/docs` Fumadocs/Next app in the workspace; design tokens + theming; nav/IA skeleton; deploy to Vercel with preview deploys; the protocol config (§16).

**M1 — Core docs (the spine).** Start Here, Quickstart (verified on testnet end-to-end), Concepts, How it works. This alone makes the protocol learnable.

**M2 — Reference + accuracy gate.** SDK/CLI/contract/circuit/serialization/errors/receipt pages; the §11 CI verification wired so the reference can't drift.

**M3 — Playground.** Guided 3-panel replay from fixtures (default), then the real-proof Web Worker path; optional testnet-submit route last.

**M4 — Landing + Blog/Roadmap + polish.** Marketing landing (§9), seed blog posts, roadmap page; SEO/OG, Lighthouse/a11y budgets met; analytics live.

Dependencies: M1 depends on M0; M2 can overlap M1 once the SDK/contract surface is stable; M3's default mode needs only fixtures (early), advanced mode needs M0 build plumbing; M4 reuses playground fixtures for the landing panels.

---

## 18. Appendix — verified protocol facts (golden reference)

These are the source-of-truth facts the reference and how-it-works pages must mirror, captured from the codebase. The §11 gate verifies the enumerated subset against source.

### 18.1 Positioning (verbatim)
- Tagline: **"Let agents act. Make them prove it."**
- Closing: **"No proof, no payment."**
- One-liner: *"Zentra lets developers build AI agents that can trigger Stellar payments only after proving, in zero knowledge, that they followed private, user-defined policies."*
- Category: *"Every action a proof. Every proof a receipt. Every receipt reputation."*
- Boundary: *"Zentra is a proof-of-compliance and settlement layer. It is not an identity system, an oracle, a policy author, a key manager, or a full compliance engine."*

### 18.2 Contract — `ZentraVerifier` (Soroban, `contracts/zentra-verifier/`)
- **Methods:** `register_policy(agent, policy_commitment: BytesN<32>, recipient_root: BytesN<32>, epoch_seconds: u64)`; `authority_state(agent, policy: BytesN<32>) -> AuthorityState`; `revoke_policy(agent, policy: BytesN<32>) -> Result<(),Error>`; `verify_proof(proof: Proof, pub_signals: Vec<Fr>) -> Result<bool,Error>`; `authorize_action(agent, policy_commitment, proof_bytes: Bytes, recipient, amount: i128, asset, invoice_hash: BytesN<32>, nullifier: BytesN<32>, prev_epoch_id: u64, prev_spent: i128, prev_action_count: u64) -> Result<(),Error>`.
- **`authorize_action` ordered state machine:** `agent.require_auth()` → assert `amount > 0` (`InvalidAmount`) → load `PolicyRecord` (`PolicyNotFound`; `PolicyRevoked` if revoked) → compute `effective_prior` (epoch rollover) → assert `prev_epoch_id/prev_spent/prev_action_count == effective` (`StateMismatch`) → nullifier unused (`NullifierUsed`) → compute `new_spent = prev_spent + amount`, `new_action_count = prev_action_count + 1` (`Overflow`) → build 14 public inputs + Groth16 `verify` (`InvalidProof`) → atomic writes (mark nullifier; write new `AuthorityState`; extend TTLs) → `token.transfer(agent → recipient, amount)` → compute CAP-0075 `action_id`, emit `ActionReceipt` → `Ok(())`.
- **Structs:** `AuthorityState { epoch_id: u64, spent_in_epoch: i128, action_count: u64 }`; `PolicyRecord { recipient_root: BytesN<32>, epoch_seconds: u64, revoked: bool }`; `DataKey::{ Policy(Address,BytesN<32>), Authority(Address,BytesN<32>), Nullifier(BytesN<32>) }`.
- **`Error` (repr u32):** `MalformedVerifyingKey=1, PolicyNotFound=2, PolicyRevoked=3, InvalidProof=4, StateMismatch=5, NullifierUsed=6, InvalidAmount=7, Overflow=8`.
- **`ActionReceipt` event (topics=["receipt"]):** `agent, policy, recipient, amount, asset, nullifier, epoch_id, new_action_count, action_id`.
- **Storage:** persistent; `DAY_TTL=17280` (~1 day @ 5s ledgers), `RETENTION_TTL=518400` (~30 days); nullifiers persistent (expiry would re-enable replay).
- **Deps:** `soroban-sdk` 26.1.0 (features `hazmat-address`, `hazmat-crypto`), `soroban-poseidon` (git); target `wasm32v1-none`.

### 18.3 Groth16 / BN254 + Poseidon
- `Proof { a: G1Affine, b: G2Affine, c: G1Affine }`; 256-byte blob `a(64) ‖ b(128) ‖ c(64)`, coordinates 32B big-endian.
- `VerificationKey { alpha: G1, beta/gamma/delta: G2, ic: Vec<G1> }`; **15 IC points** (1 + 14 public inputs).
- `vk_x = IC[0] + Σ pub[i]·IC[i+1]` (MSM); pairing check `e(-A,B)·e(α,β)·e(vk_x,γ)·e(C,δ) == 1`.
- Receipt hash: `action_id = Poseidon(agent, recipient, amount, nullifier, new_spent)` (arity 6), CAP-0075 host fn, inputs reduced mod r.
- Measured cost: **~26M of 100M CPU budget** on testnet.

### 18.4 SDK — `@zentra/sdk` (`packages/sdk/`)
- `new Zentra(cfg: ZentraConfig)` where `ZentraConfig = { contractId, asset, circuit: { wasmPath, zkeyPath }, rpcUrl?, networkPassphrase?, onStatus? }`.
- Methods: `createPolicy(config) -> Policy`; `commitPolicy(agent, policy) -> ConfirmedTx`; `readState(agentPub, policy) -> AuthorityState`; `pay(agent, policy, req: PayRequest) -> PayResult`; `guard(agent, policy) -> GuardedAgent`.
- `GuardedAgent.pay(req: PayRequest) -> PayResult`; `PayRequest = { recipient, amount: bigint, invoicePreimage: bigint, nonce?, nowSeconds? }`; `PayResult = { txHash, nullifier }`.
- `proveAction(policy, ctx: ActionContext, artifacts: CircuitArtifacts) -> ProveResult` (validates recipient ∈ approved set; throws before proving if not — Panel B).
- `StatusEvent = { phase:'proving', recipient, amount } | { phase:'proof-ready', nullifier } | { phase:'submitting' } | { phase:'released', txHash } | { phase:'blocked', reason }`.
- Policy commitment: `Poseidon(maxAmount, dailyLimit, recipientRoot, assetField, salt)`. Merkle: depth 4 / 16 leaves, leaf `Poseidon(recipientField)`, pad with `0`.
- Nullifier: `Poseidon(agentField, policyCommitment, contractField, nonce)`. Invoice: `Poseidon(invoicePreimage)`.
- `TESTNET = { rpcUrl: 'https://soroban-testnet.stellar.org', networkPassphrase: 'Test SDF Network ; September 2015' }`. Proof bytes: 256 (a64‖b128‖c64). Deps: `@stellar/stellar-sdk` 15.1.0, `snarkjs` 0.7.6, `circomlibjs` 0.1.7.

### 18.5 CLI — `@zentra/cli` (`packages/cli/`)
- Binary `zentra` (commander 12.1.0). Commands: `init [--contract --asset]`; `policy create <name> --max-amount --daily-limit --allowlist [--asset --epoch-seconds]`; `policy commit <file>`; `prove <actionFile> --policy <file>`; `submit <proofFile>`.
- `zentra.config.json` = `{ network, rpcUrl, networkPassphrase, contractId, asset, circuit:{ wasmPath, zkeyPath } }`. Scaffold dirs: `policies/ actions/ proofs/`. Env: `ZENTRA_AGENT_SECRET` (S… seed).

### 18.6 Circuit — `payment_policy.circom` (`circuits/payment-policy/`)
- circom 2.2.3, curve bn128/BN254, depth-4 Merkle. Tooling: snarkjs 0.7.6, Powers-of-Tau `pot14`. Deps: circomlib (`poseidon`, `comparators`/`LessEqThan`, `bitify`/`Num2Bits`).
- **14 public inputs in order:** `policyCommitment, recipientRoot, recipient, amount, invoiceHash, nullifier, agentAddress, assetId, contractAddress, prevEpochId, prevSpent, prevActionCount, newSpent, newActionCount`.
- **Private inputs:** `privateMaxAmount, privateDailyLimit, policySalt, pathElements[4], pathIndices[4], invoicePreimage, nonce`.
- **Constraints:** commitment `Poseidon(privateMaxAmount, privateDailyLimit, recipientRoot, assetId, policySalt) === policyCommitment`; Merkle membership of `Poseidon(recipient)` under `recipientRoot` (depth 4, boolean path indices); range `amount ≤ privateMaxAmount` and `prevSpent + amount ≤ privateDailyLimit` (`Num2Bits(64)`); state transition `newSpent === prevSpent + amount`, `newActionCount === prevActionCount + 1`; invoice `Poseidon(invoicePreimage) === invoiceHash`; nullifier `Poseidon(agentAddress, policyCommitment, contractAddress, nonce) === nullifier`.

### 18.7 Serialization — `@zentra/serialization` (`packages/serialization/`)
- `FR_MODULUS = 21888242871839275222246405745257275088548364400416034343698204186575808495617`.
- `PUBLIC_INPUT_ORDER` = the 14 names in §18.6 order.
- Functions: `modFr`, `fieldToBytes32`, `bytes32ToField`, `amountToField`, `addressToField`, `toHex`, `encodePublicInputs`, `publicInputsToDecimal`.
- Byte layout: Fr = 32B big-endian (reduced mod r); address payload = 32B reduced mod r; i128 = right-aligned (16 zero bytes ‖ 16 value bytes BE); u64 = right-aligned (24 zero bytes ‖ 8 value bytes BE).

### 18.8 Workspace
- pnpm 10.33.0 workspaces; vitest 2.1.0; tsx 4.19.0; TypeScript 5.6; circomlib 2.0.5 / circomlibjs 0.1.7. Packages: `@zentra/sdk`, `@zentra/cli`, `@zentra/serialization`, `@zentra/example-vendor-payment-agent`.
- Demo: `examples/vendor-payment-agent/demo.ts` — 3 panels, native XLM SAC, `.demo-state.json`, friendbot funding.

---

## 19. Open questions

1. **Domain & hosting** — `docs.zentra.*` vs. root domain; final analytics vendor choice.
2. **Playground testnet-submit sandbox** — ship the optional managed-agent submit route in v1, or defer to a fast-follow (default guided + client-side verify is sufficient for launch)?
3. **Design depth before build** — proceed to hi-fi mockups (separate frontend-design pass) before M0, or scaffold M0 with the token system and design in-flow?
4. **Search** — start on Orama (built-in) and only adopt Algolia DocSearch if needed — confirm.
5. **Live-facts reconciliation** — the README contract id and the demo default currently differ; confirm the single canonical testnet contract id to seed §16.
