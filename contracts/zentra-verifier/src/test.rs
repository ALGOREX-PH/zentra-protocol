#![cfg(test)]
extern crate std;

use soroban_sdk::{
    crypto::bn254::{Bn254Fr as Fr, Bn254G1Affine as G1Affine, Bn254G2Affine as G2Affine},
    testutils::{Address as _, Ledger as _},
    Address, Bytes, BytesN, Env,
};

use crate::payment_fixtures as fx;
use crate::{effective_prior, AuthorityState, Error, Proof, ZentraVerifier, ZentraVerifierClient};

fn fixture_proof(env: &Env) -> Proof {
    Proof {
        a: G1Affine::from_array(env, &fx::PROOF_A),
        b: G2Affine::from_array(env, &fx::PROOF_B),
        c: G1Affine::from_array(env, &fx::PROOF_C),
    }
}

fn signals_from(env: &Env, rows: &[[u8; 32]; 14]) -> soroban_sdk::Vec<Fr> {
    let mut v = soroban_sdk::Vec::new(env);
    for s in rows.iter() {
        v.push_back(Fr::from_bytes(BytesN::from_array(env, s)));
    }
    v
}

// ---- Groth16 verification (real payment-policy circuit vk + proof) ----

#[test]
fn verifies_payment_proof() {
    let env = Env::default();
    let id = env.register(ZentraVerifier, ());
    let client = ZentraVerifierClient::new(&env, &id);
    let res = client.verify_proof(&fixture_proof(&env), &signals_from(&env, &fx::PUB_SIGNALS));
    assert_eq!(res, true, "a valid payment-policy proof must verify");
}

#[test]
fn rejects_tampered_payment_proof() {
    let env = Env::default();
    let id = env.register(ZentraVerifier, ());
    let client = ZentraVerifierClient::new(&env, &id);

    let mut rows = fx::PUB_SIGNALS; // copy
    rows[3][31] ^= 1; // flip the low byte of `amount`
    let res = client.verify_proof(&fixture_proof(&env), &signals_from(&env, &rows));
    assert_eq!(res, false, "a proof with a tampered public signal must be rejected");
}

// ---- Proof byte parsing (malformed input returns a typed error, not a trap) ----

#[test]
fn proof_from_bytes_rejects_wrong_lengths_with_typed_error() {
    let env = Env::default();
    let buf = [0u8; 257];
    for len in [0usize, 255, 257] {
        let raw = Bytes::from_slice(&env, &buf[..len]);
        assert!(
            matches!(Proof::from_bytes(&raw), Err(Error::MalformedProof)),
            "a {}-byte blob must return Error::MalformedProof, not trap",
            len
        );
    }
}

#[test]
fn garbage_256_byte_proof_parses_but_fails_verification() {
    let env = Env::default();
    let id = env.register(ZentraVerifier, ());
    let client = ZentraVerifierClient::new(&env, &id);

    // Structurally valid length, cryptographically garbage content.
    let raw = Bytes::from_slice(&env, &[0xA5u8; 256]);
    let proof = Proof::from_bytes(&raw).expect("a 256-byte blob must parse structurally");
    let res = client.try_verify_proof(&proof, &signals_from(&env, &fx::PUB_SIGNALS));
    assert!(
        !matches!(res, Ok(Ok(true))),
        "garbage proof bytes must never verify"
    );
}

// ---- Epoch rollover (the daily-limit reset that preserves cumulative count) ----

#[test]
fn effective_prior_same_epoch_is_unchanged() {
    let s = AuthorityState { epoch_id: 5, spent_in_epoch: 300, action_count: 7 };
    assert_eq!(effective_prior(&s, 100, 550), s); // 550 / 100 == 5
}

#[test]
fn effective_prior_rollover_resets_spend_keeps_count() {
    let s = AuthorityState { epoch_id: 5, spent_in_epoch: 300, action_count: 7 };
    let e = effective_prior(&s, 100, 650); // 650 / 100 == 6 != 5
    assert_eq!(e, AuthorityState { epoch_id: 6, spent_in_epoch: 0, action_count: 7 });
}

// ---- Policy registration / state / revocation ----

fn setup<'a>(env: &Env) -> (ZentraVerifierClient<'a>, Address, BytesN<32>, BytesN<32>) {
    env.mock_all_auths();
    let id = env.register(ZentraVerifier, ());
    let client = ZentraVerifierClient::new(env, &id);
    let agent = Address::generate(env);
    let commit = BytesN::from_array(env, &[1u8; 32]);
    let root = BytesN::from_array(env, &[2u8; 32]);
    (client, agent, commit, root)
}

#[test]
fn register_initializes_authority_state_at_current_epoch() {
    let env = Env::default();
    env.ledger().set_timestamp(86_400 * 20_180);
    let (client, agent, commit, root) = setup(&env);

    client.register_policy(&agent, &commit, &root, &86_400);

    let st = client.authority_state(&agent, &commit);
    assert_eq!(st, AuthorityState { epoch_id: 20_180, spent_in_epoch: 0, action_count: 0 });
}

#[test]
fn register_rejects_zero_epoch_seconds_with_typed_error() {
    let env = Env::default();
    let (client, agent, commit, root) = setup(&env);

    let res = client.try_register_policy(&agent, &commit, &root, &0);
    assert_eq!(
        res,
        Err(Ok(Error::InvalidEpoch)),
        "epoch_seconds == 0 must return Error::InvalidEpoch, not trap"
    );
}

#[test]
fn authority_state_absent_is_zero() {
    let env = Env::default();
    let (client, agent, commit, _root) = setup(&env);
    let st = client.authority_state(&agent, &commit);
    assert_eq!(st, AuthorityState { epoch_id: 0, spent_in_epoch: 0, action_count: 0 });
}

#[test]
fn revoke_existing_policy_succeeds_and_missing_policy_errors() {
    let env = Env::default();
    let (client, agent, commit, root) = setup(&env);

    client.register_policy(&agent, &commit, &root, &86_400);
    client.revoke_policy(&agent, &commit); // Ok(()) — no panic

    let missing = BytesN::from_array(&env, &[9u8; 32]);
    assert!(client.try_revoke_policy(&agent, &missing).is_err());
}

#[test]
fn action_id_is_deterministic_and_input_sensitive() {
    let env = Env::default();
    let agent = Address::generate(&env);
    let recipient = Address::generate(&env);
    let nullifier = BytesN::from_array(&env, &[7u8; 32]);

    let a = crate::encoding::action_id(&env, &agent, &recipient, 750_000_000, &nullifier, 3_000_000_000);
    let b = crate::encoding::action_id(&env, &agent, &recipient, 750_000_000, &nullifier, 3_000_000_000);
    assert_eq!(a, b, "CAP-0075 Poseidon hash must be deterministic");

    let c = crate::encoding::action_id(&env, &agent, &recipient, 760_000_000, &nullifier, 3_000_000_000);
    assert_ne!(a, c, "changing an input must change the hash");
}
