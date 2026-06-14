/**
 * @zentra/serialization — the single, canonical byte-exact codec for Zentra's
 * public inputs. The circuit, the Soroban contract, and the SDK all agree on
 * the encoding defined here; this is the one place the ordering or endianness
 * could be wrong, so it lives in exactly one module and is golden-vector tested
 * against the Rust side.
 *
 * Encoding rules:
 *   - Field elements are BN254 scalar-field (Fr) values, serialized as
 *     32-byte BIG-ENDIAN, reduced modulo the field order.
 *   - i128 amounts / u64 counters fit in Fr and are encoded the same way.
 *   - Stellar addresses (G... ed25519 key or C... contract id) are 32-byte
 *     payloads reduced modulo the field order. Identity itself is enforced
 *     on-chain via require_auth + argument comparison, never by this field.
 */

/** BN254 (alt_bn128) scalar field order r. */
export const FR_MODULUS =
  21888242871839275222246405745257275088548364400416034343698204186575808495617n;

/** Reduce into [0, FR_MODULUS). */
export function modFr(value: bigint): bigint {
  const r = value % FR_MODULUS;
  return r >= 0n ? r : r + FR_MODULUS;
}

/** Field element (bigint or decimal string) -> 32-byte big-endian Uint8Array. */
export function fieldToBytes32(value: bigint | string): Uint8Array {
  let n = modFr(typeof value === "string" ? BigInt(value) : value);
  const out = new Uint8Array(32);
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(n & 0xffn);
    n >>= 8n;
  }
  return out;
}

/** 32-byte big-endian Uint8Array -> field element (bigint), reduced mod r. */
export function bytes32ToField(be: Uint8Array): bigint {
  if (be.length !== 32) {
    throw new Error(`expected 32 bytes, got ${be.length}`);
  }
  let n = 0n;
  for (const b of be) n = (n << 8n) | BigInt(b);
  return modFr(n);
}

/** Validate and pass through a non-negative i128 amount as a field element. */
export function amountToField(amount: bigint): bigint {
  if (amount < 0n) throw new Error("amount must be non-negative");
  if (amount >= FR_MODULUS) throw new Error("amount exceeds field order");
  return amount;
}

/** 32-byte Stellar address payload (ed25519 key or contract id) -> field. */
export function addressToField(raw32: Uint8Array): bigint {
  if (raw32.length !== 32) {
    throw new Error(`expected 32-byte address payload, got ${raw32.length}`);
  }
  return bytes32ToField(raw32);
}

/** Lowercase hex (no 0x) of a byte array — used for golden vectors and logging. */
export function toHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}

/**
 * The canonical order of the proof's public inputs. The circuit declares its
 * public signals in exactly this order, and the contract reconstructs the same
 * vector from its arguments. (`erc8004AgentId` is deferred; `actionHash` is
 * derived on-chain by the contract, not a circuit public input.)
 */
export const PUBLIC_INPUT_ORDER = [
  "policyCommitment",
  "recipientRoot",
  "recipient",
  "amount",
  "invoiceHash",
  "nullifier",
  "agentAddress",
  "assetId",
  "contractAddress",
  "prevEpochId",
  "prevSpent",
  "prevActionCount",
  "newSpent",
  "newActionCount",
] as const;

export type PublicInputName = (typeof PUBLIC_INPUT_ORDER)[number];

/** Encode the public inputs into the ordered list of 32-byte field elements. */
export function encodePublicInputs(
  values: Record<PublicInputName, bigint>,
): Uint8Array[] {
  return PUBLIC_INPUT_ORDER.map((name) => {
    const v = values[name];
    if (v === undefined) throw new Error(`missing public input: ${name}`);
    return fieldToBytes32(v);
  });
}

/** The same public inputs as decimal strings, in order — for snarkjs `publicSignals`. */
export function publicInputsToDecimal(
  values: Record<PublicInputName, bigint>,
): string[] {
  return PUBLIC_INPUT_ORDER.map((name) => {
    const v = values[name];
    if (v === undefined) throw new Error(`missing public input: ${name}`);
    return modFr(v).toString();
  });
}
