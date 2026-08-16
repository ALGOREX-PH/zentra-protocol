#![cfg(test)]
extern crate std;

use soroban_sdk::{
    contract, contractimpl, contracttype,
    crypto::bn254::{Bn254Fr as Fr, Bn254G1Affine as G1Affine, Bn254G2Affine as G2Affine},
    testutils::{Address as _, Events as _, Ledger as _},
    Address, Bytes, BytesN, Env, Event as _,
};

use crate::authorize_fixtures as afx;
use crate::payment_fixtures as fx;
use crate::{
    effective_prior, ActionReceipt, AuthorityState, DataKey, Error, Proof, ZentraVerifier,
    ZentraVerifierClient,
};

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
    assert!(res, "a valid payment-policy proof must verify");
}

#[test]
fn rejects_tampered_public_signal() {
    let env = Env::default();
    let id = env.register(ZentraVerifier, ());
    let client = ZentraVerifierClient::new(&env, &id);

    let mut rows = fx::PUB_SIGNALS; // copy
    rows[3][31] ^= 1; // flip the low byte of `amount`
    let res = client.verify_proof(&fixture_proof(&env), &signals_from(&env, &rows));
    assert!(
        !res,
        "a valid proof with a tampered public signal must be rejected"
    );
}

#[test]
fn rejects_tampered_proof_bytes() {
    let env = Env::default();
    let id = env.register(ZentraVerifier, ());
    let client = ZentraVerifierClient::new(&env, &id);

    // Corrupt the proof itself (not a public signal): flip one byte of `a`
    // in the 256-byte a || b || c blob, then parse it like `authorize_action` does.
    let mut blob = [0u8; 256];
    blob[..64].copy_from_slice(&fx::PROOF_A);
    blob[64..192].copy_from_slice(&fx::PROOF_B);
    blob[192..].copy_from_slice(&fx::PROOF_C);
    blob[31] ^= 1;
    let proof =
        Proof::from_bytes(&Bytes::from_array(&env, &blob)).expect("256-byte blob must parse");

    // A tampered point is rejected either as `false` or as a host-level
    // invalid-point error; it must never be accepted.
    let res = client.try_verify_proof(&proof, &signals_from(&env, &fx::PUB_SIGNALS));
    assert!(
        !matches!(res, Ok(Ok(true))),
        "a proof with tampered proof bytes must be rejected"
    );
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
    let s = AuthorityState {
        epoch_id: 5,
        spent_in_epoch: 300,
        action_count: 7,
    };
    assert_eq!(effective_prior(&s, 100, 550), s); // 550 / 100 == 5
}

#[test]
fn effective_prior_exact_epoch_boundary_rolls_over() {
    let s = AuthorityState {
        epoch_id: 5,
        spent_in_epoch: 300,
        action_count: 7,
    };
    // Last second of epoch 5: unchanged.
    assert_eq!(effective_prior(&s, 100, 599), s);
    // Exactly at the boundary (600 / 100 == 6): spend resets, count kept.
    assert_eq!(
        effective_prior(&s, 100, 600),
        AuthorityState {
            epoch_id: 6,
            spent_in_epoch: 0,
            action_count: 7
        }
    );
}

#[test]
fn effective_prior_rollover_resets_spend_keeps_count() {
    let s = AuthorityState {
        epoch_id: 5,
        spent_in_epoch: 300,
        action_count: 7,
    };
    let e = effective_prior(&s, 100, 650); // 650 / 100 == 6 != 5
    assert_eq!(
        e,
        AuthorityState {
            epoch_id: 6,
            spent_in_epoch: 0,
            action_count: 7
        }
    );
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
    assert_eq!(
        st,
        AuthorityState {
            epoch_id: 20_180,
            spent_in_epoch: 0,
            action_count: 0
        }
    );
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
    assert_eq!(
        st,
        AuthorityState {
            epoch_id: 0,
            spent_in_epoch: 0,
            action_count: 0
        }
    );
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

    let a = crate::encoding::action_id(
        &env,
        &agent,
        &recipient,
        750_000_000,
        &nullifier,
        3_000_000_000,
    );
    let b = crate::encoding::action_id(
        &env,
        &agent,
        &recipient,
        750_000_000,
        &nullifier,
        3_000_000_000,
    );
    assert_eq!(a, b, "CAP-0075 Poseidon hash must be deterministic");

    let c = crate::encoding::action_id(
        &env,
        &agent,
        &recipient,
        760_000_000,
        &nullifier,
        3_000_000_000,
    );
    assert_ne!(a, c, "changing an input must change the hash");
}

// ---- authorize_action (ZP-03) ----
//
// The happy path uses the authorize_fixtures proof: a REAL Groth16 proof whose
// public signals bind fixed strkeys, recreated here with `Address::from_str` +
// `env.register_at`. The asset address is proof-bound (public signal 8 and the
// commitment opening), so a minimal token contract is registered AT the fixed
// asset address to observe settlement. Error paths use typed errors to prove
// each check fires before proof verification (most run with the valid fixture
// proof, so the rejection cannot be blamed on the proof itself).

/// Minimal SEP-41-shaped token registered at the fixture's fixed asset address.
#[contract]
pub struct MockToken;

#[contracttype]
#[derive(Clone)]
pub enum MockTokenKey {
    Balance(Address),
}

#[contractimpl]
impl MockToken {
    fn get(env: &Env, k: &MockTokenKey) -> i128 {
        env.storage().persistent().get(k).unwrap_or(0)
    }

    pub fn mint(env: Env, to: Address, amount: i128) {
        let k = MockTokenKey::Balance(to);
        let b = Self::get(&env, &k);
        env.storage().persistent().set(&k, &(b + amount));
    }

    pub fn balance(env: Env, id: Address) -> i128 {
        Self::get(&env, &MockTokenKey::Balance(id))
    }

    pub fn transfer(env: Env, from: Address, to: Address, amount: i128) {
        from.require_auth();
        let fk = MockTokenKey::Balance(from);
        let tk = MockTokenKey::Balance(to);
        let fb = Self::get(&env, &fk);
        assert!(fb >= amount, "insufficient balance");
        env.storage().persistent().set(&fk, &(fb - amount));
        env.storage()
            .persistent()
            .set(&tk, &(Self::get(&env, &tk) + amount));
    }
}

struct AuthzTest<'a> {
    client: ZentraVerifierClient<'a>,
    token: MockTokenClient<'a>,
    agent: Address,
    recipient: Address,
    asset: Address,
    verifier: Address,
    commit: BytesN<32>,
    nullifier: BytesN<32>,
    invoice: BytesN<32>,
    proof: Bytes,
}

/// Recreate the fixture's fixed environment: ledger time, verifier + token at
/// their proof-bound addresses. Does NOT register the policy.
fn authz_setup<'a>(env: &Env) -> AuthzTest<'a> {
    env.mock_all_auths();
    env.ledger().set_timestamp(afx::TIMESTAMP);
    let verifier = Address::from_str(env, afx::VERIFIER_CONTRACT);
    let asset = Address::from_str(env, afx::ASSET);
    env.register_at(&verifier, ZentraVerifier, ());
    env.register_at(&asset, MockToken, ());
    AuthzTest {
        client: ZentraVerifierClient::new(env, &verifier),
        token: MockTokenClient::new(env, &asset),
        agent: Address::from_str(env, afx::AGENT),
        recipient: Address::from_str(env, afx::RECIPIENT),
        asset,
        verifier,
        commit: BytesN::from_array(env, &afx::POLICY_COMMITMENT),
        nullifier: BytesN::from_array(env, &afx::NULLIFIER),
        invoice: BytesN::from_array(env, &afx::INVOICE_HASH),
        proof: Bytes::from_array(env, &afx::PROOF_BYTES),
    }
}

fn register_fixture_policy(env: &Env, t: &AuthzTest) {
    t.client.register_policy(
        &t.agent,
        &t.commit,
        &BytesN::from_array(env, &afx::RECIPIENT_ROOT),
        &afx::EPOCH_SECONDS,
    );
}

type TryAuthzResult =
    Result<Result<(), soroban_sdk::ConversionError>, Result<Error, soroban_sdk::InvokeError>>;

/// authorize_action with the fixture's canonical arguments except the ones
/// under test.
fn try_authorize(
    t: &AuthzTest,
    proof: &Bytes,
    amount: i128,
    prev: (u64, i128, u64),
) -> TryAuthzResult {
    t.client.try_authorize_action(
        &t.agent,
        &t.commit,
        proof,
        &t.recipient,
        &amount,
        &t.asset,
        &t.invoice,
        &t.nullifier,
        &prev.0,
        &prev.1,
        &prev.2,
    )
}

const FIXTURE_PRIOR: (u64, i128, u64) =
    (afx::PREV_EPOCH_ID, afx::PREV_SPENT, afx::PREV_ACTION_COUNT);

fn nullifier_used(env: &Env, t: &AuthzTest) -> bool {
    env.as_contract(&t.verifier, || {
        env.storage()
            .persistent()
            .has(&DataKey::Nullifier(t.nullifier.clone()))
    })
}

/// Failure must leave the world untouched: nullifier unconsumed, authority
/// state at its registration value, and zero tokens moved.
fn assert_untouched(env: &Env, t: &AuthzTest) {
    assert!(
        !nullifier_used(env, t),
        "nullifier must not be consumed on failure"
    );
    assert_eq!(
        t.client.authority_state(&t.agent, &t.commit),
        AuthorityState {
            epoch_id: afx::PREV_EPOCH_ID,
            spent_in_epoch: 0,
            action_count: 0
        },
        "authority state must be unchanged on failure"
    );
    assert_eq!(
        t.token.balance(&t.recipient),
        0,
        "no tokens may move on failure"
    );
}

#[test]
fn authorize_rejects_nonpositive_amounts() {
    let env = Env::default();
    let t = authz_setup(&env);
    register_fixture_policy(&env, &t);
    t.token.mint(&t.agent, &afx::AMOUNT);

    for amount in [0i128, -1, i128::MIN] {
        let res = try_authorize(&t, &t.proof, amount, FIXTURE_PRIOR);
        assert_eq!(
            res,
            Err(Ok(Error::InvalidAmount)),
            "amount {} must return Error::InvalidAmount",
            amount
        );
    }
    assert_untouched(&env, &t);
    assert_eq!(t.token.balance(&t.agent), afx::AMOUNT);
}

#[test]
fn authorize_rejects_unknown_policy() {
    let env = Env::default();
    let t = authz_setup(&env);
    // Policy never registered.
    let res = try_authorize(&t, &t.proof, afx::AMOUNT, FIXTURE_PRIOR);
    assert_eq!(res, Err(Ok(Error::PolicyNotFound)));
    assert!(!nullifier_used(&env, &t));
    assert_eq!(t.token.balance(&t.recipient), 0);
}

#[test]
fn authorize_rejects_revoked_policy() {
    let env = Env::default();
    let t = authz_setup(&env);
    register_fixture_policy(&env, &t);
    t.client.revoke_policy(&t.agent, &t.commit);

    // Even a fully valid proof must be rejected once the policy is revoked.
    let res = try_authorize(&t, &t.proof, afx::AMOUNT, FIXTURE_PRIOR);
    assert_eq!(res, Err(Ok(Error::PolicyRevoked)));
    assert_untouched(&env, &t);
}

#[test]
fn authorize_rejects_prev_state_mismatch_per_component() {
    let env = Env::default();
    let t = authz_setup(&env);
    register_fixture_policy(&env, &t);

    // Each prev_* component individually off by one must trip StateMismatch,
    // even with a valid proof (the agent cannot lie about prior state).
    let (e, s, c) = FIXTURE_PRIOR;
    for prev in [(e + 1, s, c), (e, s + 1, c), (e, s, c + 1)] {
        let res = try_authorize(&t, &t.proof, afx::AMOUNT, prev);
        assert_eq!(
            res,
            Err(Ok(Error::StateMismatch)),
            "prev state {:?} must return Error::StateMismatch",
            prev
        );
    }
    assert_untouched(&env, &t);
}

#[test]
fn authorize_rejects_used_nullifier() {
    let env = Env::default();
    let t = authz_setup(&env);
    register_fixture_policy(&env, &t);

    // Seed the nullifier as already consumed.
    env.as_contract(&t.verifier, || {
        env.storage()
            .persistent()
            .set(&DataKey::Nullifier(t.nullifier.clone()), &true);
    });

    let res = try_authorize(&t, &t.proof, afx::AMOUNT, FIXTURE_PRIOR);
    assert_eq!(res, Err(Ok(Error::NullifierUsed)));
    assert_eq!(
        t.client.authority_state(&t.agent, &t.commit),
        AuthorityState {
            epoch_id: afx::PREV_EPOCH_ID,
            spent_in_epoch: 0,
            action_count: 0
        }
    );
    assert_eq!(t.token.balance(&t.recipient), 0);
}

#[test]
fn authorize_rejects_overflowing_epoch_spend() {
    let env = Env::default();
    let t = authz_setup(&env);
    register_fixture_policy(&env, &t);

    // Authority state at i128::MAX spend: prev_spent + amount must not wrap.
    env.as_contract(&t.verifier, || {
        env.storage().persistent().set(
            &DataKey::Authority(t.agent.clone(), t.commit.clone()),
            &AuthorityState {
                epoch_id: afx::PREV_EPOCH_ID,
                spent_in_epoch: i128::MAX,
                action_count: 0,
            },
        );
    });

    let res = try_authorize(
        &t,
        &t.proof,
        afx::AMOUNT,
        (afx::PREV_EPOCH_ID, i128::MAX, 0),
    );
    assert_eq!(res, Err(Ok(Error::Overflow)));
    assert!(!nullifier_used(&env, &t));
    assert_eq!(t.token.balance(&t.recipient), 0);
}

#[test]
fn authorize_rejects_wrong_length_proof_blob() {
    let env = Env::default();
    let t = authz_setup(&env);
    register_fixture_policy(&env, &t);

    // All pre-verification checks pass; the malformed blob is the failure.
    let buf = [0u8; 257];
    for len in [0usize, 64, 255, 257] {
        let raw = Bytes::from_slice(&env, &buf[..len]);
        let res = try_authorize(&t, &raw, afx::AMOUNT, FIXTURE_PRIOR);
        assert_eq!(
            res,
            Err(Ok(Error::MalformedProof)),
            "a {}-byte proof blob must return Error::MalformedProof",
            len
        );
    }
    assert_untouched(&env, &t);
}

#[test]
fn authorize_rejects_garbage_proof_bytes() {
    let env = Env::default();
    let t = authz_setup(&env);
    register_fixture_policy(&env, &t);
    t.token.mint(&t.agent, &afx::AMOUNT);

    // 256 bytes of garbage parse structurally but are not valid curve points;
    // the host rejects them during verification (error, never success).
    let raw = Bytes::from_array(&env, &[0xA5u8; 256]);
    let res = try_authorize(&t, &raw, afx::AMOUNT, FIXTURE_PRIOR);
    assert!(res.is_err(), "garbage proof bytes must never authorize");
    assert_untouched(&env, &t);
    assert_eq!(t.token.balance(&t.agent), afx::AMOUNT);
}

#[test]
fn authorize_rejects_valid_proof_for_wrong_statement() {
    let env = Env::default();
    let t = authz_setup(&env);
    register_fixture_policy(&env, &t);
    t.token.mint(&t.agent, &afx::AMOUNT);

    // The committed payment fixture is a valid proof of a DIFFERENT statement
    // (valid curve points, wrong public inputs): typed InvalidProof.
    let mut blob = [0u8; 256];
    blob[..64].copy_from_slice(&fx::PROOF_A);
    blob[64..192].copy_from_slice(&fx::PROOF_B);
    blob[192..].copy_from_slice(&fx::PROOF_C);
    let res = try_authorize(
        &t,
        &Bytes::from_array(&env, &blob),
        afx::AMOUNT,
        FIXTURE_PRIOR,
    );
    assert_eq!(res, Err(Ok(Error::InvalidProof)));
    assert_untouched(&env, &t);
    assert_eq!(t.token.balance(&t.agent), afx::AMOUNT);
}

#[test]
fn authorize_settles_payment_updates_state_and_emits_receipt() {
    let env = Env::default();
    let t = authz_setup(&env);
    register_fixture_policy(&env, &t);
    t.token.mint(&t.agent, &(10 * afx::AMOUNT));

    t.client.authorize_action(
        &t.agent,
        &t.commit,
        &t.proof,
        &t.recipient,
        &afx::AMOUNT,
        &t.asset,
        &t.invoice,
        &t.nullifier,
        &afx::PREV_EPOCH_ID,
        &afx::PREV_SPENT,
        &afx::PREV_ACTION_COUNT,
    );

    // Receipt event, asserted first: events().all() covers only the last
    // invocation. new_spent == AMOUNT because prev_spent was 0.
    let expected = ActionReceipt {
        agent: t.agent.clone(),
        policy: t.commit.clone(),
        recipient: t.recipient.clone(),
        amount: afx::AMOUNT,
        asset: t.asset.clone(),
        nullifier: t.nullifier.clone(),
        epoch_id: afx::PREV_EPOCH_ID,
        new_action_count: 1,
        action_id: crate::encoding::action_id(
            &env,
            &t.agent,
            &t.recipient,
            afx::AMOUNT,
            &t.nullifier,
            afx::AMOUNT,
        ),
    };
    assert_eq!(
        env.events().all(),
        std::vec![expected.to_xdr(&env, &t.verifier)],
        "exactly the ActionReceipt must be emitted"
    );

    // Real settlement: tokens moved agent -> recipient.
    assert_eq!(t.token.balance(&t.agent), 9 * afx::AMOUNT);
    assert_eq!(t.token.balance(&t.recipient), afx::AMOUNT);

    // Authority state advanced and the nullifier is consumed.
    assert_eq!(
        t.client.authority_state(&t.agent, &t.commit),
        AuthorityState {
            epoch_id: afx::PREV_EPOCH_ID,
            spent_in_epoch: afx::AMOUNT,
            action_count: 1
        }
    );
    assert!(nullifier_used(&env, &t));

    // Replay with the UPDATED prior state passes the state check but must hit
    // the consumed nullifier.
    let res = try_authorize(
        &t,
        &t.proof,
        afx::AMOUNT,
        (afx::PREV_EPOCH_ID, afx::AMOUNT, 1),
    );
    assert_eq!(res, Err(Ok(Error::NullifierUsed)));
}

#[test]
fn verifies_authorize_fixture_proof() {
    let env = Env::default();
    let id = env.register(ZentraVerifier, ());
    let client = ZentraVerifierClient::new(&env, &id);
    let proof = Proof::from_bytes(&Bytes::from_array(&env, &afx::PROOF_BYTES))
        .expect("fixture proof blob must parse");
    let res = client.verify_proof(&proof, &signals_from(&env, &afx::PUB_SIGNALS));
    assert!(res, "the authorize fixture proof must verify standalone");
}
