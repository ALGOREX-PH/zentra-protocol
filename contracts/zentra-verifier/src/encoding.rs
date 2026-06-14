//! Byte-exact encoding of the 14 public inputs, mirroring `@zentra/serialization`.
//! Field values come from the contract's own arguments / stored state, so the
//! proof is bound to the real recipient, asset, agent, and contract.

use soroban_sdk::{
    address_payload::AddressPayload, crypto::bn254::Bn254Fr as Fr, Address, Bytes, BytesN, Env,
    Vec, U256,
};

/// A 32-byte value that is already a valid field element (< r): Poseidon outputs
/// such as the policy commitment, recipient root, invoice hash, and nullifier.
fn fr_from_field_bytes(b: &BytesN<32>) -> Fr {
    Fr::from_bytes(b.clone())
}

/// Derive a field element from a Stellar address (ed25519 key or contract id),
/// reduced modulo the scalar field. Matches `addressToField` in the SDK.
fn fr_from_address(env: &Env, addr: &Address) -> Fr {
    let payload = addr.to_payload().expect("address has a 32-byte payload");
    let bytes: BytesN<32> = match payload {
        AddressPayload::AccountIdPublicKeyEd25519(k) => k,
        AddressPayload::ContractIdHash(c) => c,
    };
    let u = U256::from_be_bytes(env, &Bytes::from_array(env, &bytes.to_array()));
    Fr::from_u256(u)
}

/// Non-negative i128 (amount / spend) as a field element.
fn fr_from_i128(env: &Env, v: i128) -> Fr {
    let mut buf = [0u8; 32];
    buf[16..32].copy_from_slice(&(v as u128).to_be_bytes());
    Fr::from_bytes(BytesN::from_array(env, &buf))
}

/// u64 (epoch id / action count) as a field element.
fn fr_from_u64(env: &Env, v: u64) -> Fr {
    let mut buf = [0u8; 32];
    buf[24..32].copy_from_slice(&v.to_be_bytes());
    Fr::from_bytes(BytesN::from_array(env, &buf))
}

/// Build the public-input vector in the canonical order (see
/// `@zentra/serialization` PUBLIC_INPUT_ORDER):
/// policyCommitment, recipientRoot, recipient, amount, invoiceHash, nullifier,
/// agentAddress, assetId, contractAddress, prevEpochId, prevSpent,
/// prevActionCount, newSpent, newActionCount.
#[allow(clippy::too_many_arguments)]
pub fn build_public_inputs(
    env: &Env,
    policy_commitment: &BytesN<32>,
    recipient_root: &BytesN<32>,
    recipient: &Address,
    amount: i128,
    invoice_hash: &BytesN<32>,
    nullifier: &BytesN<32>,
    agent: &Address,
    asset: &Address,
    contract: &Address,
    prev_epoch_id: u64,
    prev_spent: i128,
    prev_action_count: u64,
    new_spent: i128,
    new_action_count: u64,
) -> Vec<Fr> {
    let mut v = Vec::new(env);
    v.push_back(fr_from_field_bytes(policy_commitment));
    v.push_back(fr_from_field_bytes(recipient_root));
    v.push_back(fr_from_address(env, recipient));
    v.push_back(fr_from_i128(env, amount));
    v.push_back(fr_from_field_bytes(invoice_hash));
    v.push_back(fr_from_field_bytes(nullifier));
    v.push_back(fr_from_address(env, agent));
    v.push_back(fr_from_address(env, asset));
    v.push_back(fr_from_address(env, contract));
    v.push_back(fr_from_u64(env, prev_epoch_id));
    v.push_back(fr_from_i128(env, prev_spent));
    v.push_back(fr_from_u64(env, prev_action_count));
    v.push_back(fr_from_i128(env, new_spent));
    v.push_back(fr_from_u64(env, new_action_count));
    v
}
