#!/usr/bin/env bash
# Compile payment_policy.circom and produce a Groth16/BN254 proving + verifying
# key, then a sample proof. bn128 curve, non-interactive.
#
# ── TRUSTED-SETUP INVARIANT: one zkey per deployment ─────────────────────────
# A Groth16 verification key is valid for EXACTLY ONE zkey. The committed
# contracts/zentra-verifier/src/vk.rs (and any deployed verifier contract)
# corresponds to one specific payment_policy.zkey. Every run of this script
# makes a NEW phase-2 contribution and therefore a NEW zkey with a DIFFERENT
# verification key: proofs from the new zkey will NOT verify against the
# committed/deployed verifier until you regenerate vk.rs (to-soroban-vk.ts),
# commit it, and redeploy the contract. check-vk.sh detects this drift and is
# run automatically at the end of this script.
#
# Phase 1 (powers of tau) is the public Hermez/iden3 ceremony file, downloaded
# once into circuits/ptau/ (gitignored) and verified against the sha256 pinned
# below. Phase 2 (the zkey contribution) is DEV-GRADE: a single local
# contribution. Production requires a real multi-party phase-2 ceremony.
#
# Usage: build.sh [--dev]
#   --dev  use a fixed, publicly-known entropy string for the zkey
#          contribution (worthless for soundness — development only).
#          Without --dev, random entropy is used; the setup is still
#          dev-grade (single contributor, no ceremony).
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../..

# ── pinned powers-of-tau ─────────────────────────────────────────────────────
# powersOfTau28_hez_final_13.ptau: public Hermez/iden3 ceremony (54
# contributions + random beacon), 2^13 = 8192 constraints — the smallest file
# covering this circuit (snarkjs r1cs info: 4883 constraints).
# Provenance: the snarkjs README (github.com/iden3/snarkjs) publishes the
# official blake2b-512 hash for this file:
#   58efc8bf2834d04768a3d7ffcd8e1e23d461561729beaac4e3e7a47829a1c9066d5320241e124a1a8e8aa6c75be0ba66f65bc8239a0542ed38e11276f6fdb4d9
# The sha256 pinned here was computed on 2026-08-16 from the file downloaded
# at PTAU_URL, after verifying its blake2b-512 against that published value.
PTAU_DIR="$ROOT/circuits/ptau"
PTAU_NAME=powersOfTau28_hez_final_13.ptau
PTAU="$PTAU_DIR/$PTAU_NAME"
PTAU_URL="https://storage.googleapis.com/zkevm/ptau/$PTAU_NAME"
PTAU_SHA256=95751b5207f20aa822f01109902315c01c15250303feacea2b8aa7dc9fdfeefd

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1" | cut -d' ' -f1
  else
    shasum -a 256 "$1" | cut -d' ' -f1
  fi
}

mkdir -p "$PTAU_DIR"
if [ ! -f "$PTAU" ]; then
  echo "==> downloading $PTAU_NAME (public Hermez ceremony) into circuits/ptau/"
  curl -fsSL -o "$PTAU.tmp" "$PTAU_URL"
  mv "$PTAU.tmp" "$PTAU"
fi
echo "==> verifying $PTAU_NAME against pinned sha256"
got="$(sha256_of "$PTAU")"
if [ "$got" != "$PTAU_SHA256" ]; then
  echo "ERROR: $PTAU sha256 mismatch" >&2
  echo "  expected: $PTAU_SHA256" >&2
  echo "  got:      $got" >&2
  echo "Delete the file and re-run, or investigate a tampered download." >&2
  exit 1
fi

# ── zkey entropy: deterministic ONLY behind --dev ────────────────────────────
DEV=0
for a in "$@"; do [ "$a" = "--dev" ] && DEV=1; done
if [ "$DEV" = 1 ]; then
  ENTROPY="zentra payment-policy entropy 2"
else
  ENTROPY="$(head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi

echo "==> generating witness input"
pnpm exec tsx gen-input.ts

echo "==> compiling circuit (bn128)"
circom payment_policy.circom --r1cs --wasm --sym -p bn128 -l "$ROOT/node_modules" -o .

echo "==> circuit info"
snarkjs r1cs info payment_policy.r1cs

echo "==> groth16 setup + zkey contribution"
snarkjs groth16 setup payment_policy.r1cs "$PTAU" pp_0000.zkey
snarkjs zkey contribute pp_0000.zkey payment_policy.zkey --name="zentra-pp-2" -v -e="$ENTROPY"
snarkjs zkey export verificationkey payment_policy.zkey verification_key.json

cat >&2 <<'EOF'
#############################################################################
##  WARNING: DEVELOPMENT-GRADE TRUSTED SETUP                               ##
##  payment_policy.zkey comes from a single local phase-2 contribution.    ##
##  These keys are for DEVELOPMENT ONLY — production requires a real       ##
##  multi-party phase-2 ceremony. See the header of this script.           ##
#############################################################################
EOF
if [ "$DEV" = 1 ]; then
  echo "!! --dev: zkey entropy is a fixed, publicly-known string — this proving key has ZERO soundness value." >&2
fi

echo "==> witness + proof"
snarkjs wtns calculate payment_policy_js/payment_policy.wasm input.example.json witness.wtns
snarkjs groth16 prove payment_policy.zkey witness.wtns proof.json public.json

echo "==> off-chain sanity verify"
snarkjs groth16 verify verification_key.json public.json proof.json

echo "==> done. public signals:"
cat public.json

# New zkey => (almost certainly) new VK. Warn loudly if it no longer matches
# the committed vk.rs — the build itself still succeeded.
bash check-vk.sh || true
