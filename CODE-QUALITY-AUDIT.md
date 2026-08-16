# Code Quality Audit & Improvement Plan

**Date:** 2026-08-16 · **Scope:** this repo — the Groth16 verifier contract, Circom circuits, and the TS SDK/CLI/serialization packages. Every claim was verified against the code at exact file:line; `cargo check --locked` was run to confirm the compile break. The companion audit for the docs+dApp repo lives at `zentra-docs/docs/CODE-QUALITY-AUDIT.md`.

## Verdict

**Grade: C+** — architecturally serious R&D (correct circom comparator hygiene, proofs bound to authoritative on-chain state, an explicit canonical-encoding package) whose main artifact **does not compile from a fresh clone**, with **no CI** to notice, no lint/format toolchain, and nothing that ever runs `tsc`. Fixing ZP-01/02/03 and adding CI makes this a B+.

## Findings

| ID    | Sev  | Where                                                                                         | Problem → Fix                                                                                                                                                                                                                                                                                                                                                                                                                                                                             | Effort |
| ----- | ---- | --------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| ZP-01 | HIGH | `contracts/zentra-verifier/src/encoding.rs:9`, `Cargo.toml`                                   | **Contract does not compile as committed**: `soroban_poseidon` is imported but never declared (`cargo check --locked` fails with E0432; Cargo.lock confirms deps = soroban-sdk only). The dependency exists only in someone's uncommitted local state; README's `cargo test` step and any fresh-clone deploy are dead. → Add `soroban-poseidon` to `[dependencies]`, regenerate Cargo.lock, commit both.                                                                                  | S      |
| ZP-02 | HIGH | `circuits/payment-policy/build.sh:19-28` (+spike)                                             | Dev-grade trusted setup with hard-coded public entropy — the keys have no soundness value — and since zkeys/ptau are gitignored while setup reruns per invocation, a fresh clone's VK silently mismatches the committed `vk.rs` and the deployed contract; SDK proofs then fail on-chain with nothing flagging why. → Hash-pin the public Hermez ptau; add a check that a rebuilt `verification_key.json` matches `vk.rs`; document that vk.rs/deployment are valid for exactly one zkey. | M      |
| ZP-03 | HIGH | `contracts/zentra-verifier/src/lib.rs:159-266`                                                | `authorize_action` — the only function that moves money — has **zero tests**: no happy path with token settlement, no `StateMismatch`/`NullifierUsed`/`PolicyRevoked`/`InvalidAmount`/`Overflow` paths. The committed fixture can't drive it (toy address signals 1111/2222/3333). → Generate a fixture from real testutils addresses via the SDK prover; add error-path tests (they fail before verification, so no valid proof needed).                                                 | M/L    |
| ZP-04 | MED  | `groth16.rs:34-43`                                                                            | `Proof::from_bytes` traps/panics on malformed input instead of returning the existing typed `Error`. → Length-check and return `Result`; add malformed-length and wrong-curve tests.                                                                                                                                                                                                                                                                                                      | S      |
| ZP-05 | MED  | `lib.rs:110`                                                                                  | `assert!(epoch_seconds > 0)` traps instead of a typed error, inconsistent with every other entrypoint (the guard itself is correct — zero would cause division panics). → `Error::InvalidEpoch`.                                                                                                                                                                                                                                                                                          | S      |
| ZP-06 | MED  | `sdk/client.ts:31-48`, `spike/to-soroban.mjs:25-48`, `payment-policy/to-soroban-vk.mjs:17-28` | The be32/G1/G2 encoding — the most error-prone byte layout in the system — exists in three hand-rolled copies (two already diverged on negative handling); the Poseidon-Merkle builder and `effective_prior` are each duplicated too, despite `@zentra/serialization` declaring itself the single canonical codec. → Move point serialization + epoch helper into `@zentra/serialization`; import from the .mjs scripts and CLI.                                                          | M      |
| ZP-07 | MED  | repo root                                                                                     | **No CI, no lint/format toolchain, nothing ever typechecks** (vitest strips types; no package has a `typecheck` script; root `build` script is a no-op). This is precisely how ZP-01 landed. → GitHub Actions running `cargo test`, per-package `tsc --noEmit`, `vitest run`; add prettier + clippy/fmt.                                                                                                                                                                                  | M      |
| ZP-08 | MED  | `serialization/golden-vectors.json:2`                                                         | Claims the vectors are asserted by both TS and Rust — no Rust code references them. → Add the Rust golden-vector test or correct the comment.                                                                                                                                                                                                                                                                                                                                             | S      |
| ZP-09 | MED  | `sdk/client.ts`, `sdk/index.ts`, `cli/index.ts`                                               | Zero tests for the client, the `Zentra` facade, and the entire CLI — including `proofToBytes` (the third reimplementation of the trickiest encoding). → Assert `proofToBytes` byte-for-byte against the committed proof.json/fixtures; mirror `effectivePrior` against the Rust cases; smoke-test CLI with a mocked client.                                                                                                                                                               | M      |
| ZP-10 | MED  | `examples/vendor-payment-agent/demo.ts:112-142`                                               | Bare `catch` prints security success on ANY failure — an RPC outage or the ZP-02 VK desync displays as "blocked by ZK proof"; Panel C's `prevSpent: 0n` lie is only a lie if Panel A settled. → Match the contract error code before printing the verdict; derive the lie from actual on-chain spend.                                                                                                                                                                                     | S      |
| ZP-11 | MED  | `cli/index.ts:199-210`                                                                        | CLI fabricates a fake `ProveResult` (`publicSignals: []`, `nullifier: 0n`) to satisfy the type — a future refactor reading the wrong field silently submits zeros. → Narrow `SubmitParams` type on `authorizeAction`.                                                                                                                                                                                                                                                                     | S      |
| ZP-12 | MED  | `sdk/client.ts:85-100`, `prover.ts:49-57`                                                     | No typed errors: contract error codes surface as raw JSON/XDR strings (`NullifierUsed` reaches the demo unreadable). → Small `ZentraError` hierarchy + `Error(Contract, #n)` code mapping.                                                                                                                                                                                                                                                                                                | M      |
| ZP-13 | MED  | `sdk/prover.ts:42-95`, `crypto.ts:47-73`                                                      | No cheap pre-checks (`amount <= maxAmount`, `prevSpent + amount <= dailyLimit`, Merkle index bounds) — over-limit requests burn full witness generation and die as cryptic snarkjs constraint asserts. → Bigint guards at the top with policy-referencing messages.                                                                                                                                                                                                                       | S      |
| ZP-14 | LOW  | `README.md:26,99`, `lib.rs:69`                                                                | Contract-id drift (README `CDLZFP…` vs demo `CDS6BU…`); Poseidon action hashing described as "planned" though it's implemented and emitted. → Update both.                                                                                                                                                                                                                                                                                                                                | S      |
| ZP-15 | LOW  | `test_snapshots/`                                                                             | Stale snapshots for renamed tests; the surviving "tampered proof" test actually tampers a public signal. → Delete stale files; add a genuine tampered-proof-bytes test.                                                                                                                                                                                                                                                                                                                   | S      |
| ZP-16 | LOW  | `spike/to-soroban.mjs:81`                                                                     | Spike generator writes an orphaned `spike_fixtures.rs` into the contract crate. → Retire or redirect to a scratch path.                                                                                                                                                                                                                                                                                                                                                                   | S      |
| ZP-17 | LOW  | package.jsons                                                                                 | No `private: true`/license/repository on the three packages; CLI shebang relies on `tsx` it doesn't depend on. → Metadata now; build step before any publish.                                                                                                                                                                                                                                                                                                                             | S      |
| ZP-18 | LOW  | `payment-policy/test.sh:13,27`, `cli init`                                                    | Test harness mutates the tracked `input.example.json` in place (interrupt = dirty tree); `init` writes `"C..."` placeholders accepted without validation. → Temp files; StrKey validation on load.                                                                                                                                                                                                                                                                                        | S      |
| ZP-19 | LOW  | `sdk/client.ts:24-28`                                                                         | `raced()` never clears its timers — CLI/demo can hang up to ~25s after finishing. → `clearTimeout` in finally or `.unref()`.                                                                                                                                                                                                                                                                                                                                                              | S      |

## Improvement plan

### Phase 0 — Unbreak the repo (immediately)

- [ ] ZP-01 Declare `soroban-poseidon`, regenerate Cargo.lock, verify `cargo test --locked` from a clean checkout

### Phase 1 — CI from zero (so Phase 0 can never regress)

- [ ] ZP-07 GitHub Actions: `cargo check --locked` + `cargo test` (verifier), `tsc --noEmit` per package, `vitest run`, `cargo fmt --check` + clippy, prettier check
- [ ] Document (or script in CI) that SDK tests require `circuits/payment-policy/build.sh` artifacts

### Phase 2 — ZK workflow integrity

- [ ] ZP-02 Hash-pinned Hermez ptau; rebuilt-VK-matches-`vk.rs` check; one-zkey-per-deployment documented
- [ ] ZP-08 Rust golden-vector test against `golden-vectors.json` (or fix the false claim)
- [ ] ZP-15 Delete stale snapshots; add a real tampered-proof-bytes test
- [ ] ZP-16 Retire/redirect the spike fixture generator

### Phase 3 — Correctness & robustness

- [ ] ZP-04 `Proof::from_bytes` → `Result` + malformed-input tests
- [ ] ZP-05 `Error::InvalidEpoch` instead of `assert!`
- [ ] ZP-10 Demo verdicts matched on contract error codes; Panel C lie derived from real state
- [ ] ZP-13 Cheap pre-validation before witness generation; Merkle index bounds
- [ ] ZP-12 `ZentraError` hierarchy + contract error-code mapping
- [ ] ZP-11 `SubmitParams` type for `authorizeAction`
- [ ] ZP-19 Clear/unref the race timers

### Phase 4 — Deduplication

- [ ] ZP-06 Point serialization + `effectivePrior` live only in `@zentra/serialization`; .mjs scripts and CLI import it

### Phase 5 — Test debt

- [ ] ZP-03 `authorize_action` suite: real-address fixture, settlement assertions, every error path
- [ ] ZP-09 `proofToBytes` byte-for-byte vs committed fixtures; `effectivePrior` mirrors the Rust cases; CLI smoke tests
- [ ] Circuit matrix: over-max amount, wrong salt/commitment, wrong assetId, non-boolean pathIndices, wrong newSpent transition, boundary equalities, constraint-count regression check
- [ ] Serialization: `publicInputsToDecimal`, negative bigints, near-modulus vectors

### Phase 6 — Polish

- [ ] ZP-14 README contract id + stale Poseidon roadmap notes · ZP-17 package metadata · ZP-18 temp-file test harness + StrKey validation

## What NOT to change

- Circom comparator hygiene (`Num2Bits` range-binding before `LessEqThan`, constrained pathIndices booleanity) — the two classic soundness bugs, both avoided.
- Proofs bound to authoritative state: `effective_prior` epoch rollover, single-use nullifiers, checked arithmetic, writes only after verification.
- `@zentra/serialization` as an explicit canonical codec with golden vectors and a documented `PUBLIC_INPUT_ORDER` — strengthen it (ZP-06), don't dilute it.
- Generated Rust marked `@generated` with generators committed alongside; clean git hygiene (no target/wasm/zkey/ptau tracked, `.demo-state.json` ignored, Cargo.lock committed, tuned wasm release profile).
- Tamper-negative tests on both sides; SDK tests prove with real Stellar addresses against the real circuit.
- Docs that explain _why_ (field-reduction rationale, constraint-to-threat mapping) and a README with an honest scope boundary.
