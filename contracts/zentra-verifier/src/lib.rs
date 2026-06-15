#![no_std]
//! Zentra Protocol — Soroban proof-of-compliance verifier and settlement layer.
//!
//! `authorize_action` is a verifiable state machine: it verifies a Groth16/BN254
//! proof that a proposed payment obeys a private policy, confirms the proof is
//! bound to the agent's authoritative on-chain state (so the agent cannot lie
//! about prior spend), enforces single-use nullifiers, then settles the USDC
//! payment and emits a Verifiable Action Receipt. No proof, no payment.

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype,
    crypto::bn254::Bn254Fr as Fr, token::Client as TokenClient, Address, Bytes, BytesN, Env, Vec,
};

mod encoding;
mod groth16;
mod vk;

pub use groth16::{Proof, VerificationKey};

#[cfg(test)]
mod payment_fixtures;
#[cfg(test)]
mod test;

const DAY_TTL: u32 = 17280; // ~1 day at 5s ledgers
const RETENTION_TTL: u32 = 518400; // ~30 days

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    MalformedVerifyingKey = 1,
    PolicyNotFound = 2,
    PolicyRevoked = 3,
    InvalidProof = 4,
    StateMismatch = 5,
    NullifierUsed = 6,
    InvalidAmount = 7,
    Overflow = 8,
}

/// Authoritative on-chain state per (agent, policy commitment).
#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct AuthorityState {
    pub epoch_id: u64,
    pub spent_in_epoch: i128,
    pub action_count: u64,
}

#[contracttype]
#[derive(Clone)]
pub struct PolicyRecord {
    pub recipient_root: BytesN<32>,
    pub epoch_seconds: u64,
    pub revoked: bool,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Policy(Address, BytesN<32>),
    Authority(Address, BytesN<32>),
    Nullifier(BytesN<32>),
}

/// Emitted on every successful authorization. The nullifier is the unique
/// action id. (A CAP-0075 Poseidon actionHash over these fields is a planned
/// enhancement; the nullifier already uniquely identifies the action.)
#[contractevent(topics = ["receipt"])]
pub struct ActionReceipt {
    pub agent: Address,
    pub policy: BytesN<32>,
    pub recipient: Address,
    pub amount: i128,
    pub asset: Address,
    pub nullifier: BytesN<32>,
    pub epoch_id: u64,
    pub new_action_count: u64,
    /// CAP-0075 Poseidon hash of the action's public fields (canonical receipt id).
    pub action_id: BytesN<32>,
}

/// Effective prior AuthorityState, applying epoch rollover: entering a new epoch
/// resets the in-epoch spend to zero while preserving the cumulative action count.
fn effective_prior(stored: &AuthorityState, epoch_seconds: u64, now: u64) -> AuthorityState {
    let cur = now / epoch_seconds;
    if cur != stored.epoch_id {
        AuthorityState { epoch_id: cur, spent_in_epoch: 0, action_count: stored.action_count }
    } else {
        stored.clone()
    }
}

#[contract]
pub struct ZentraVerifier;

#[contractimpl]
impl ZentraVerifier {
    /// Register (or update) a policy commitment + approved-recipient root for an agent.
    pub fn register_policy(
        env: Env,
        agent: Address,
        policy_commitment: BytesN<32>,
        recipient_root: BytesN<32>,
        epoch_seconds: u64,
    ) {
        agent.require_auth();
        assert!(epoch_seconds > 0, "epoch_seconds must be > 0");

        let pkey = DataKey::Policy(agent.clone(), policy_commitment.clone());
        env.storage().persistent().set(
            &pkey,
            &PolicyRecord { recipient_root, epoch_seconds, revoked: false },
        );
        env.storage().persistent().extend_ttl(&pkey, DAY_TTL, RETENTION_TTL);

        let akey = DataKey::Authority(agent, policy_commitment);
        if !env.storage().persistent().has(&akey) {
            let epoch = env.ledger().timestamp() / epoch_seconds;
            env.storage().persistent().set(
                &akey,
                &AuthorityState { epoch_id: epoch, spent_in_epoch: 0, action_count: 0 },
            );
        }
        env.storage().persistent().extend_ttl(&akey, DAY_TTL, RETENTION_TTL);
    }

    /// Read the stored AuthorityState for (agent, policy). Returns zeroed state if absent.
    pub fn authority_state(env: Env, agent: Address, policy: BytesN<32>) -> AuthorityState {
        env.storage()
            .persistent()
            .get(&DataKey::Authority(agent, policy))
            .unwrap_or(AuthorityState { epoch_id: 0, spent_in_epoch: 0, action_count: 0 })
    }

    /// Revoke a policy; no further actions can be authorized under it.
    pub fn revoke_policy(env: Env, agent: Address, policy: BytesN<32>) -> Result<(), Error> {
        agent.require_auth();
        let pkey = DataKey::Policy(agent, policy);
        let mut rec: PolicyRecord =
            env.storage().persistent().get(&pkey).ok_or(Error::PolicyNotFound)?;
        rec.revoked = true;
        env.storage().persistent().set(&pkey, &rec);
        env.storage().persistent().extend_ttl(&pkey, DAY_TTL, RETENTION_TTL);
        Ok(())
    }

    /// Verify a payment-policy Groth16 proof against the embedded verification key
    /// and the supplied public signals (canonical order). Read-only.
    pub fn verify_proof(env: Env, proof: Proof, pub_signals: Vec<Fr>) -> Result<bool, Error> {
        groth16::verify(&env, vk::verification_key(&env), proof, pub_signals)
    }

    /// The core proof-gated, state-bound payment authorization.
    /// Nothing after the state + nullifier + proof checks runs unless they pass.
    #[allow(clippy::too_many_arguments)]
    pub fn authorize_action(
        env: Env,
        agent: Address,
        policy_commitment: BytesN<32>,
        proof_bytes: Bytes,
        recipient: Address,
        amount: i128,
        asset: Address,
        invoice_hash: BytesN<32>,
        nullifier: BytesN<32>,
        prev_epoch_id: u64,
        prev_spent: i128,
        prev_action_count: u64,
    ) -> Result<(), Error> {
        agent.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }

        // (1) Policy must exist and be active.
        let pkey = DataKey::Policy(agent.clone(), policy_commitment.clone());
        let policy: PolicyRecord =
            env.storage().persistent().get(&pkey).ok_or(Error::PolicyNotFound)?;
        if policy.revoked {
            return Err(Error::PolicyRevoked);
        }

        // (2) The proof's prev_* inputs must equal the effective prior state.
        let akey = DataKey::Authority(agent.clone(), policy_commitment.clone());
        let stored: AuthorityState = env
            .storage()
            .persistent()
            .get(&akey)
            .unwrap_or(AuthorityState { epoch_id: 0, spent_in_epoch: 0, action_count: 0 });
        let effective = effective_prior(&stored, policy.epoch_seconds, env.ledger().timestamp());
        if prev_epoch_id != effective.epoch_id
            || prev_spent != effective.spent_in_epoch
            || prev_action_count != effective.action_count
        {
            return Err(Error::StateMismatch);
        }

        // (3) Nullifier must be unused.
        let nkey = DataKey::Nullifier(nullifier.clone());
        if env.storage().persistent().has(&nkey) {
            return Err(Error::NullifierUsed);
        }

        // The circuit also enforces these state-transition relations.
        let new_spent = prev_spent.checked_add(amount).ok_or(Error::Overflow)?;
        let new_action_count = prev_action_count.checked_add(1).ok_or(Error::Overflow)?;

        // (4) Verify the proof against the reconstructed public inputs.
        let pub_inputs = encoding::build_public_inputs(
            &env,
            &policy_commitment,
            &policy.recipient_root,
            &recipient,
            amount,
            &invoice_hash,
            &nullifier,
            &agent,
            &asset,
            &env.current_contract_address(),
            prev_epoch_id,
            prev_spent,
            prev_action_count,
            new_spent,
            new_action_count,
        );
        let proof = Proof::from_bytes(&proof_bytes);
        if !groth16::verify(&env, vk::verification_key(&env), proof, pub_inputs)? {
            return Err(Error::InvalidProof);
        }

        // (5) Commit atomically: consume nullifier, write new state, settle, emit.
        env.storage().persistent().set(&nkey, &true);
        env.storage().persistent().extend_ttl(&nkey, DAY_TTL, RETENTION_TTL);

        env.storage().persistent().set(
            &akey,
            &AuthorityState {
                epoch_id: effective.epoch_id,
                spent_in_epoch: new_spent,
                action_count: new_action_count,
            },
        );
        env.storage().persistent().extend_ttl(&akey, DAY_TTL, RETENTION_TTL);

        TokenClient::new(&env, &asset).transfer(&agent, &recipient, &amount);

        let action_id =
            encoding::action_id(&env, &agent, &recipient, amount, &nullifier, new_spent);
        ActionReceipt {
            agent,
            policy: policy_commitment,
            recipient,
            amount,
            asset,
            nullifier,
            epoch_id: effective.epoch_id,
            new_action_count,
            action_id,
        }
        .publish(&env);

        Ok(())
    }
}
