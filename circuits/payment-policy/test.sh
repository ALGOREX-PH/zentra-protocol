#!/usr/bin/env bash
# Circuit behavior tests: a valid witness must compute; policy-violating inputs
# must FAIL witness generation (the proof can't be produced). Requires build.sh
# to have produced payment_policy_js/payment_policy.wasm first.
# Case inputs are written to a temp dir — the tracked input.example.json is
# never touched, so an interrupted run leaves the tree clean.
set -uo pipefail
cd "$(dirname "$0")"
WASM=payment_policy_js/payment_policy.wasm
TMP="$(mktemp -d ./test-input-XXXXXX)"
trap 'rm -rf "$TMP"' EXIT
pass=0; fail=0

check() { # $1 = expected ok|err ; rest = gen-input args
  local expected="$1"; shift
  pnpm exec tsx gen-input.ts --out "$TMP/input.json" "$@" >/dev/null
  if snarkjs wtns calculate "$WASM" "$TMP/input.json" "$TMP/witness.wtns" >/dev/null 2>&1; then got=ok; else got=err; fi
  if [ "$got" = "$expected" ]; then
    echo "PASS (expected $expected): gen-input $*"; pass=$((pass+1))
  else
    echo "FAIL (expected $expected, got $got): gen-input $*"; fail=$((fail+1))
  fi
}

check ok                     # valid payment within policy
check err --bad-recipient    # Panel B: recipient not in approved Merkle root
check err --over-spend       # prevSpent+amount exceeds the private daily limit

echo "----"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
