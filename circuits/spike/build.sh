#!/usr/bin/env bash
# Phase-0 spike: compile mult.circom and produce a real Groth16/BN254 proof.
# Curve is bn128 (== BN254 / alt_bn128), matching Stellar's BN254 host functions.
# All steps are non-interactive (-e supplies entropy) so this runs headless.
set -euo pipefail
cd "$(dirname "$0")"

POT=pot8_final.ptau

echo "==> compiling circuit (bn128)"
circom mult.circom --r1cs --wasm --sym -p bn128 -o .

if [ ! -f "$POT" ]; then
  echo "==> powers of tau (fresh, 2^8)"
  snarkjs powersoftau new bn128 8 pot8_0000.ptau -v
  snarkjs powersoftau contribute pot8_0000.ptau pot8_0001.ptau --name="zentra-spike-1" -v -e="zentra phase0 entropy 1"
  snarkjs powersoftau prepare phase2 pot8_0001.ptau "$POT" -v
fi

echo "==> groth16 setup + zkey contribution"
snarkjs groth16 setup mult.r1cs "$POT" mult_0000.zkey
snarkjs zkey contribute mult_0000.zkey mult_final.zkey --name="zentra-spike-2" -v -e="zentra phase0 entropy 2"
snarkjs zkey export verificationkey mult_final.zkey verification_key.json

echo "==> witness + proof"
node mult_js/generate_witness.js mult_js/mult.wasm input.json witness.wtns
snarkjs groth16 prove mult_final.zkey witness.wtns proof.json public.json

echo "==> off-chain sanity verify"
snarkjs groth16 verify verification_key.json public.json proof.json

echo "==> done. artifacts: verification_key.json, proof.json, public.json"
