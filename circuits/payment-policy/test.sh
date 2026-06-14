#!/usr/bin/env bash
# Circuit behavior tests: a valid witness must compute; policy-violating inputs
# must FAIL witness generation (the proof can't be produced). Requires build.sh
# to have produced payment_policy_js/payment_policy.wasm first.
set -uo pipefail
cd "$(dirname "$0")"
WASM=payment_policy_js/payment_policy.wasm
TMP=witness_neg.wtns
pass=0; fail=0

check() { # $1 = expected ok|err ; rest = gen-input args
  local expected="$1"; shift
  node gen-input.mjs "$@" >/dev/null
  if snarkjs wtns calculate "$WASM" input.example.json "$TMP" >/dev/null 2>&1; then got=ok; else got=err; fi
  if [ "$got" = "$expected" ]; then
    echo "PASS (expected $expected): gen-input $*"; pass=$((pass+1))
  else
    echo "FAIL (expected $expected, got $got): gen-input $*"; fail=$((fail+1))
  fi
}

check ok                     # valid payment within policy
check err --bad-recipient    # Panel B: recipient not in approved Merkle root
check err --over-spend       # prevSpent+amount exceeds the private daily limit

rm -f "$TMP"
node gen-input.mjs >/dev/null  # restore the valid input.example.json
echo "----"
echo "passed=$pass failed=$fail"
[ "$fail" -eq 0 ]
