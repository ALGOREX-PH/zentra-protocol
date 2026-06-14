pragma circom 2.2.3;

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

// Poseidon-Merkle inclusion proof with binary path.
// pathIndices[i] == 0 -> current node is the LEFT child (sibling on the right)
// pathIndices[i] == 1 -> current node is the RIGHT child (sibling on the left)
template MerkleInclusion(depth) {
    signal input leaf;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal output root;

    component hashers[depth];
    signal cur[depth + 1];
    signal left[depth];
    signal right[depth];
    cur[0] <== leaf;

    for (var i = 0; i < depth; i++) {
        // pathIndices[i] must be boolean
        pathIndices[i] * (1 - pathIndices[i]) === 0;

        left[i]  <== cur[i] + pathIndices[i] * (pathElements[i] - cur[i]);
        right[i] <== pathElements[i] + pathIndices[i] * (cur[i] - pathElements[i]);

        hashers[i] = Poseidon(2);
        hashers[i].inputs[0] <== left[i];
        hashers[i].inputs[1] <== right[i];
        cur[i + 1] <== hashers[i].out;
    }
    root <== cur[depth];
}

// Zentra Proof-of-Compliance circuit for stellar_payment actions.
//
// Proves, in zero knowledge, that a proposed payment obeys a private policy and
// a valid state transition, without revealing the policy thresholds, the full
// vendor list, the invoice contents, or the agent's instruction context.
template PaymentPolicy(depth) {
    // ----- public inputs (MUST match @zentra/serialization PUBLIC_INPUT_ORDER) -----
    signal input policyCommitment;
    signal input recipientRoot;
    signal input recipient;        // public: the specific paid vendor (revealed at settlement anyway)
    signal input amount;
    signal input invoiceHash;
    signal input nullifier;
    signal input agentAddress;
    signal input assetId;
    signal input contractAddress;
    signal input prevEpochId;
    signal input prevSpent;
    signal input prevActionCount;
    signal input newSpent;
    signal input newActionCount;

    // ----- private inputs (the witness) -----
    signal input privateMaxAmount;
    signal input privateDailyLimit;
    signal input policySalt;
    signal input pathElements[depth];
    signal input pathIndices[depth];
    signal input invoicePreimage;
    signal input nonce;

    // (1) Policy commitment opening: the public commitment hides the private
    // thresholds + salt while binding the public recipientRoot and assetId.
    component commit = Poseidon(5);
    commit.inputs[0] <== privateMaxAmount;
    commit.inputs[1] <== privateDailyLimit;
    commit.inputs[2] <== recipientRoot;
    commit.inputs[3] <== assetId;
    commit.inputs[4] <== policySalt;
    commit.out === policyCommitment;

    // (2) Recipient is in the approved-vendor Merkle tree (leaf = Poseidon(recipient)).
    component leafHash = Poseidon(1);
    leafHash.inputs[0] <== recipient;
    component merkle = MerkleInclusion(depth);
    merkle.leaf <== leafHash.out;
    for (var i = 0; i < depth; i++) {
        merkle.pathElements[i] <== pathElements[i];
        merkle.pathIndices[i] <== pathIndices[i];
    }
    merkle.root === recipientRoot;

    // (3) Range checks. Bound operands to 64 bits so additions cannot wrap the field.
    component nAmount = Num2Bits(64); nAmount.in <== amount;
    component nMax    = Num2Bits(64); nMax.in    <== privateMaxAmount;
    component nPrev   = Num2Bits(64); nPrev.in   <== prevSpent;
    component nLimit  = Num2Bits(64); nLimit.in  <== privateDailyLimit;

    component leAmount = LessEqThan(64);
    leAmount.in[0] <== amount;
    leAmount.in[1] <== privateMaxAmount;
    leAmount.out === 1;

    signal sumSpent;
    sumSpent <== prevSpent + amount; // < 2^65
    component leDaily = LessEqThan(65);
    leDaily.in[0] <== sumSpent;
    leDaily.in[1] <== privateDailyLimit;
    leDaily.out === 1;

    // (4) State transition.
    newSpent === prevSpent + amount;
    newActionCount === prevActionCount + 1;

    // (5) Invoice binding.
    component inv = Poseidon(1);
    inv.inputs[0] <== invoicePreimage;
    inv.out === invoiceHash;

    // (6) Nullifier derivation. contractAddress is folded in for per-contract
    // domain separation (hardening over the PRD's 3-input form).
    component nf = Poseidon(4);
    nf.inputs[0] <== agentAddress;
    nf.inputs[1] <== policyCommitment;
    nf.inputs[2] <== contractAddress;
    nf.inputs[3] <== nonce;
    nf.out === nullifier;

    // prevEpochId is enforced by the contract (checked against the effective
    // epoch derived from ledger time + stored AuthorityState), not in-circuit.
}

component main { public [
    policyCommitment, recipientRoot, recipient, amount, invoiceHash, nullifier,
    agentAddress, assetId, contractAddress, prevEpochId, prevSpent,
    prevActionCount, newSpent, newActionCount
] } = PaymentPolicy(4);
