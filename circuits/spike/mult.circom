pragma circom 2.2.3;

// Phase-0 de-risk spike circuit.
//
// Purpose: the smallest possible Groth16/BN254 circuit that still has a public
// input, so it exercises the on-chain verifier's public-input aggregation
// (vk_x = IC[0] + IC[1]*c). We prove knowledge of two private factors a, b of
// a public product c. This circuit has no security meaning — it exists only to
// produce a real snarkjs proof we can feed to the Soroban BN254 verifier and
// confirm (a) it verifies on testnet and (b) it fits the resource budget.
template Mult() {
    signal input a;   // private factor
    signal input b;   // private factor
    signal output c;  // public product

    c <== a * b;
}

component main = Mult();
