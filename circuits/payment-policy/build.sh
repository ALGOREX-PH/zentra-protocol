#!/usr/bin/env bash
# Compile payment_policy.circom and produce a Groth16/BN254 proving + verifying
# key, then a sample proof. Non-interactive (entropy via -e). bn128 curve.
set -euo pipefail
cd "$(dirname "$0")"
ROOT=../..
POWER=14
POT="pot${POWER}_final.ptau"

echo "==> generating witness input"
node gen-input.mjs

echo "==> compiling circuit (bn128)"
circom payment_policy.circom --r1cs --wasm --sym -p bn128 -l "$ROOT/node_modules" -o .

echo "==> circuit info"
snarkjs r1cs info payment_policy.r1cs

if [ ! -f "$POT" ]; then
  echo "==> powers of tau (fresh, 2^${POWER})"
  snarkjs powersoftau new bn128 "$POWER" "pot${POWER}_0000.ptau" -v
  snarkjs powersoftau contribute "pot${POWER}_0000.ptau" "pot${POWER}_0001.ptau" --name="zentra-pp-1" -v -e="zentra payment-policy entropy 1"
  snarkjs powersoftau prepare phase2 "pot${POWER}_0001.ptau" "$POT" -v
fi

echo "==> groth16 setup + zkey contribution"
snarkjs groth16 setup payment_policy.r1cs "$POT" pp_0000.zkey
snarkjs zkey contribute pp_0000.zkey payment_policy.zkey --name="zentra-pp-2" -v -e="zentra payment-policy entropy 2"
snarkjs zkey export verificationkey payment_policy.zkey verification_key.json

echo "==> witness + proof"
snarkjs wtns calculate payment_policy_js/payment_policy.wasm input.example.json witness.wtns
snarkjs groth16 prove payment_policy.zkey witness.wtns proof.json public.json

echo "==> off-chain sanity verify"
snarkjs groth16 verify verification_key.json public.json proof.json

echo "==> done. public signals:"
cat public.json
