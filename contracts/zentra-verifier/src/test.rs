#![cfg(test)]
extern crate std;

use soroban_sdk::{
    crypto::bn254::{Bn254Fr as Fr, Bn254G1Affine as G1Affine, Bn254G2Affine as G2Affine},
    BytesN, Env, Vec,
};

use crate::spike_fixtures as fx;
use crate::{Proof, VerificationKey, ZentraVerifier, ZentraVerifierClient};

fn g1(env: &Env, b: &[u8; 64]) -> G1Affine {
    G1Affine::from_array(env, b)
}
fn g2(env: &Env, b: &[u8; 128]) -> G2Affine {
    G2Affine::from_array(env, b)
}
fn fr(env: &Env, b: &[u8; 32]) -> Fr {
    Fr::from_bytes(BytesN::from_array(env, b))
}

fn vk(env: &Env) -> VerificationKey {
    let mut ic = Vec::new(env);
    for p in fx::IC.iter() {
        ic.push_back(g1(env, p));
    }
    VerificationKey {
        alpha: g1(env, &fx::ALPHA),
        beta: g2(env, &fx::BETA),
        gamma: g2(env, &fx::GAMMA),
        delta: g2(env, &fx::DELTA),
        ic,
    }
}

fn proof(env: &Env) -> Proof {
    Proof {
        a: g1(env, &fx::PI_A),
        b: g2(env, &fx::PI_B),
        c: g1(env, &fx::PI_C),
    }
}

fn signals(env: &Env) -> Vec<Fr> {
    let mut v = Vec::new(env);
    for s in fx::PUB_SIGNALS.iter() {
        v.push_back(fr(env, s));
    }
    v
}

#[test]
fn verifies_valid_proof() {
    let env = Env::default();
    let id = env.register(ZentraVerifier, ());
    let client = ZentraVerifierClient::new(&env, &id);

    let res = client.verify_proof(&vk(&env), &proof(&env), &signals(&env));
    assert_eq!(res, true, "a real, valid BN254 Groth16 proof must verify");

    // Phase-0 budget evidence (CPU/mem used vs Soroban limits).
    env.cost_estimate().budget().print();
}

#[test]
fn rejects_tampered_public_signal() {
    let env = Env::default();
    let id = env.register(ZentraVerifier, ());
    let client = ZentraVerifierClient::new(&env, &id);

    // Flip the public output (33 -> 34): the same proof must NOT verify.
    let mut bad = fx::PUB_SIGNALS[0];
    bad[31] = bad[31].wrapping_add(1);
    let mut v = Vec::new(&env);
    v.push_back(fr(&env, &bad));

    let res = client.verify_proof(&vk(&env), &proof(&env), &v);
    assert_eq!(res, false, "a proof with the wrong public signal must be rejected");
}
