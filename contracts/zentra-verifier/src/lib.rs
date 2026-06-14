#![no_std]
//! Zentra Protocol — Soroban verifier.
//!
//! Phase-0 spike: a BN254 Groth16 proof verifier built on the `soroban-sdk` v26
//! BN254 host functions (CAP-0074/CAP-0080). This proves the proof↔contract
//! serialization and the on-chain resource budget before the real
//! policy-compliance state machine is built on top.

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr as Fr, Bn254G1Affine as G1Affine, Bn254G2Affine as G2Affine},
    vec, Env, Vec,
};

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum VerifierError {
    /// pub_signals length does not match (ic.len() - 1).
    MalformedVerifyingKey = 1,
}

/// Groth16 verification key (BN254). Points are in the soroban-sdk byte layout.
#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub alpha: G1Affine,
    pub beta: G2Affine,
    pub gamma: G2Affine,
    pub delta: G2Affine,
    pub ic: Vec<G1Affine>,
}

/// Groth16 proof (BN254).
#[derive(Clone)]
#[contracttype]
pub struct Proof {
    pub a: G1Affine,
    pub b: G2Affine,
    pub c: G1Affine,
}

#[contract]
pub struct ZentraVerifier;

#[contractimpl]
impl ZentraVerifier {
    /// Verify a Groth16 proof over BN254 against `vk` and `pub_signals`.
    ///
    /// Checks the pairing equation
    ///   e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
    /// where vk_x = ic[0] + sum(pub_signals[i] * ic[i+1]).
    pub fn verify_proof(
        env: Env,
        vk: VerificationKey,
        proof: Proof,
        pub_signals: Vec<Fr>,
    ) -> Result<bool, VerifierError> {
        let bn = env.crypto().bn254();

        // One IC point per public signal, plus IC[0].
        if pub_signals.len() + 1 != vk.ic.len() {
            return Err(VerifierError::MalformedVerifyingKey);
        }

        // vk_x = ic[0] + sum(pub_signals[i] * ic[i+1])
        let mut vk_x = vk.ic.get(0).unwrap();
        for (s, v) in pub_signals.iter().zip(vk.ic.iter().skip(1)) {
            let prod = bn.g1_mul(&v, &s);
            vk_x = bn.g1_add(&vk_x, &prod);
        }

        // e(-A, B) * e(alpha, beta) * e(vk_x, gamma) * e(C, delta) == 1
        let neg_a = -proof.a;
        let vp1 = vec![&env, neg_a, vk.alpha, vk_x, proof.c];
        let vp2 = vec![&env, proof.b, vk.beta, vk.gamma, vk.delta];

        Ok(bn.pairing_check(vp1, vp2))
    }
}

#[cfg(test)]
mod spike_fixtures;
#[cfg(test)]
mod test;
