//! Groth16/BN254 proof verification on the soroban-sdk v26 BN254 host functions.

use soroban_sdk::{
    contracttype,
    crypto::bn254::{Bn254Fr as Fr, Bn254G1Affine as G1Affine, Bn254G2Affine as G2Affine},
    vec, Bytes, BytesN, Env, Vec,
};

use crate::Error;

/// Groth16 verification key (BN254), in soroban-sdk byte layout.
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

impl Proof {
    /// Parse a 256-byte proof blob: a (64) || b (128) || c (64), in the same
    /// byte layout as the SDK and `@zentra/serialization` produce.
    pub fn from_bytes(raw: &Bytes) -> Proof {
        let a: BytesN<64> = raw.slice(0..64).try_into().expect("proof.a is 64 bytes");
        let b: BytesN<128> = raw.slice(64..192).try_into().expect("proof.b is 128 bytes");
        let c: BytesN<64> = raw.slice(192..256).try_into().expect("proof.c is 64 bytes");
        Proof {
            a: G1Affine::from_bytes(a),
            b: G2Affine::from_bytes(b),
            c: G1Affine::from_bytes(c),
        }
    }
}

/// Verify a Groth16 proof: e(-A,B)·e(alpha,beta)·e(vk_x,gamma)·e(C,delta) == 1
/// where vk_x = ic[0] + Σ pub_signals[i]·ic[i+1].
pub fn verify(
    env: &Env,
    vk: VerificationKey,
    proof: Proof,
    pub_signals: Vec<Fr>,
) -> Result<bool, Error> {
    let bn = env.crypto().bn254();

    if pub_signals.len() + 1 != vk.ic.len() {
        return Err(Error::MalformedVerifyingKey);
    }

    let mut vk_x = vk.ic.get(0).unwrap();
    for (s, v) in pub_signals.iter().zip(vk.ic.iter().skip(1)) {
        let prod = bn.g1_mul(&v, &s);
        vk_x = bn.g1_add(&vk_x, &prod);
    }

    let neg_a = -proof.a;
    let vp1 = vec![env, neg_a, vk.alpha, vk_x, proof.c];
    let vp2 = vec![env, proof.b, vk.beta, vk.gamma, vk.delta];

    Ok(bn.pairing_check(vp1, vp2))
}
