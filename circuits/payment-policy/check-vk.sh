#!/usr/bin/env bash
# VK-drift check: regenerate vk.rs from the local circuit artifacts
# (verification_key.json + proof.json + public.json) into a temp dir and diff
# it against the committed contracts/zentra-verifier/src/vk.rs, ignoring the
# single @generated header line and formatting (the committed file is
# rustfmt-formatted; the generator emits single-line arrays).
#
# Drift means the local payment_policy.zkey does not correspond to the
# committed (and presumably deployed) verifier: proofs generated locally will
# NOT verify on-chain. Fix by regenerating vk.rs (to-soroban-vk.ts), committing
# it, and redeploying the contract — one zkey per deployment.
#
# Standalone: only needs artifacts from a previous build.sh run, not a rebuild.
# Exits 0 when in sync, 1 on drift, 2 when artifacts are missing.
set -euo pipefail
cd "$(dirname "$0")"

COMMITTED=../../contracts/zentra-verifier/src/vk.rs
if [ ! -f verification_key.json ]; then
  echo "ERROR: verification_key.json not found — run build.sh first." >&2
  exit 2
fi

TMP="$(mktemp -d ./vk-check-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
pnpm exec tsx to-soroban-vk.ts --out-dir "$TMP" >/dev/null

# Strip whitespace and trailing array commas before diffing so rustfmt reflow
# of the committed file (line wrapping, trailing commas) never reads as key
# drift; every byte value, separator, bracket, and identifier is still compared.
normalize() { tail -n +2 "$1" | tr -d '[:space:]' | sed 's/,\]/]/g'; }
if diff <(normalize "$TMP/vk.rs") <(normalize "$COMMITTED") >/dev/null; then
  echo "==> VK check OK: local verification_key.json matches the committed vk.rs"
else
  cat >&2 <<'EOF'
#############################################################################
##  WARNING: VERIFICATION-KEY DRIFT                                        ##
##  The local zkey/verification_key.json does NOT match the committed      ##
##  contracts/zentra-verifier/src/vk.rs. Proofs generated with the local   ##
##  artifacts will NOT verify against the committed/deployed verifier.     ##
##                                                                         ##
##  To realign: pnpm exec tsx to-soroban-vk.ts, commit the new vk.rs, and  ##
##  redeploy the contract (one zkey per deployment).                       ##
#############################################################################
EOF
  exit 1
fi
