#!/usr/bin/env bash
# Phase-0 spike: compile mult.circom and produce a real Groth16/BN254 proof.
# Curve is bn128 (== BN254 / alt_bn128), matching Stellar's BN254 host
# functions. Non-interactive.
#
# Phase 1 (powers of tau) is the public Hermez/iden3 ceremony file, downloaded
# once into circuits/ptau/ (gitignored) and verified against the sha256 pinned
# below. Phase 2 (the zkey contribution) is DEV-GRADE: a single local
# contribution. Production requires a real multi-party phase-2 ceremony.
#
# Usage: build.sh [--dev]
#   --dev  use a fixed, publicly-known entropy string for the zkey
#          contribution (worthless for soundness — development only).
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../..

# ── pinned powers-of-tau ─────────────────────────────────────────────────────
# powersOfTau28_hez_final_08.ptau: public Hermez/iden3 ceremony (54
# contributions + random beacon), 2^8 = 256 constraints — far more than this
# one-constraint spike circuit needs, and the smallest file published.
# Provenance: the snarkjs README (github.com/iden3/snarkjs) publishes the
# official blake2b-512 hash for this file:
#   d6a8fb3a04feb600096c3b791f936a578c4e664d262e4aa24beed1b7a9a96aa5eb72864d628db247e9293384b74b36ffb52ca8d148d6e1b8b51e279fdf57b583
# The sha256 pinned here was computed on 2026-08-16 from the file downloaded
# at PTAU_URL, after verifying its blake2b-512 against that published value.
PTAU_DIR="$ROOT/circuits/ptau"
PTAU_NAME=powersOfTau28_hez_final_08.ptau
PTAU="$PTAU_DIR/$PTAU_NAME"
PTAU_URL="https://storage.googleapis.com/zkevm/ptau/$PTAU_NAME"
PTAU_SHA256=f741f2ddee2875915c24db8aae90d021f51181533f1ee3b58baf64b042e91654

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
  ENTROPY="zentra phase0 entropy 2"
else
  ENTROPY="$(head -c 64 /dev/urandom | od -An -tx1 | tr -d ' \n')"
fi

echo "==> compiling circuit (bn128)"
circom mult.circom --r1cs --wasm --sym -p bn128 -o .

echo "==> groth16 setup + zkey contribution"
snarkjs groth16 setup mult.r1cs "$PTAU" mult_0000.zkey
snarkjs zkey contribute mult_0000.zkey mult_final.zkey --name="zentra-spike-2" -v -e="$ENTROPY"
snarkjs zkey export verificationkey mult_final.zkey verification_key.json

cat >&2 <<'EOF'
#############################################################################
##  WARNING: DEVELOPMENT-GRADE TRUSTED SETUP                               ##
##  mult_final.zkey comes from a single local phase-2 contribution.        ##
##  These keys are for DEVELOPMENT ONLY — production requires a real       ##
##  multi-party phase-2 ceremony.                                          ##
#############################################################################
EOF
if [ "$DEV" = 1 ]; then
  echo "!! --dev: zkey entropy is a fixed, publicly-known string — this proving key has ZERO soundness value." >&2
fi

echo "==> witness + proof"
# snarkjs wtns calculate, not `node mult_js/generate_witness.js`: the generated
# script is CommonJS and the workspace root package.json declares type=module,
# so node refuses to run it. Same computation either way.
snarkjs wtns calculate mult_js/mult.wasm input.json witness.wtns
snarkjs groth16 prove mult_final.zkey witness.wtns proof.json public.json

echo "==> off-chain sanity verify"
snarkjs groth16 verify verification_key.json public.json proof.json

echo "==> done. artifacts: verification_key.json, proof.json, public.json"
