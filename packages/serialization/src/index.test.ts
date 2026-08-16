import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  FR_MODULUS,
  PUBLIC_INPUT_ORDER,
  addressToField,
  amountToField,
  be32,
  bytes32ToField,
  effectivePrior,
  encodePublicInputs,
  fieldToBytes32,
  g1ToBytes,
  g2ToBytes,
  proofToBytes,
  toHex,
  vkToBytes,
  type PublicInputName,
} from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(readFileSync(resolve(here, "../golden-vectors.json"), "utf8"));

describe("field <-> bytes32", () => {
  it("matches the golden vectors (big-endian, 32 bytes)", () => {
    for (const { dec, hex } of golden.fieldToBytes32) {
      expect(toHex(fieldToBytes32(dec))).toBe(hex);
    }
  });

  it("produces exactly 32 bytes", () => {
    expect(fieldToBytes32(0n).length).toBe(32);
    expect(fieldToBytes32(FR_MODULUS - 1n).length).toBe(32);
  });

  it("reduces modulo the BN254 scalar field", () => {
    expect(toHex(fieldToBytes32(FR_MODULUS))).toBe(toHex(fieldToBytes32(0n)));
    expect(toHex(fieldToBytes32(FR_MODULUS + 5n))).toBe(toHex(fieldToBytes32(5n)));
  });

  it("round-trips bytes32ToField ∘ fieldToBytes32", () => {
    for (const x of [0n, 1n, 33n, 750000000n, FR_MODULUS - 1n]) {
      expect(bytes32ToField(fieldToBytes32(x))).toBe(x);
    }
  });

  it("rejects non-32-byte input to bytes32ToField", () => {
    expect(() => bytes32ToField(new Uint8Array(31))).toThrow();
  });
});

describe("amountToField", () => {
  it("passes through non-negative i128-range amounts", () => {
    expect(amountToField(750000000n)).toBe(750000000n);
    expect(amountToField(0n)).toBe(0n);
  });
  it("rejects negative amounts", () => {
    expect(() => amountToField(-1n)).toThrow();
  });
});

describe("addressToField", () => {
  it("reduces a 32-byte address payload into the field", () => {
    const raw = new Uint8Array(32).fill(0);
    raw[31] = 7;
    expect(addressToField(raw)).toBe(7n);
  });
  it("rejects payloads that are not 32 bytes", () => {
    expect(() => addressToField(new Uint8Array(20))).toThrow();
  });
});

describe("public input ordering", () => {
  it("matches the canonical order (14 inputs, no erc8004AgentId)", () => {
    expect([...PUBLIC_INPUT_ORDER]).toEqual(golden.publicInputOrder);
    expect(PUBLIC_INPUT_ORDER.length).toBe(14);
  });

  it("encodePublicInputs emits 14 x 32-byte arrays in order", () => {
    const values = Object.fromEntries(
      PUBLIC_INPUT_ORDER.map((n, i) => [n, BigInt(i + 1)]),
    ) as Record<PublicInputName, bigint>;
    const out = encodePublicInputs(values);
    expect(out.length).toBe(14);
    out.forEach((b, i) => {
      expect(b.length).toBe(32);
      expect(bytes32ToField(b)).toBe(BigInt(i + 1));
    });
  });

  it("throws when a public input is missing", () => {
    expect(() => encodePublicInputs({} as Record<PublicInputName, bigint>)).toThrow();
  });
});

describe("be32 (raw big-endian, strict)", () => {
  it("does NOT reduce modulo Fr (G1/G2 coordinates are Fp values)", () => {
    // FR_MODULUS itself must round-trip verbatim, not collapse to zero.
    expect(toHex(be32(FR_MODULUS))).toBe(
      "30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001",
    );
  });

  it("rejects negative values", () => {
    expect(() => be32(-1n)).toThrow(/negative/);
    expect(() => be32("-42")).toThrow(/negative/);
  });

  it("rejects values wider than 32 bytes", () => {
    expect(() => be32(1n << 256n)).toThrow(/exceeds 32 bytes/);
  });

  it("accepts the 32-byte maximum", () => {
    expect(toHex(be32((1n << 256n) - 1n))).toBe("f".repeat(64));
  });
});

describe("G1/G2 point serialization", () => {
  it("g1ToBytes is be(X) || be(Y), 64 bytes", () => {
    const b = g1ToBytes(["1", "2", "1"]);
    expect(b.length).toBe(64);
    expect(b[31]).toBe(1); // X
    expect(b[63]).toBe(2); // Y
  });

  it("g2ToBytes pins c1-before-c0 ordering (EIP-197 imaginary first)", () => {
    // snarkjs layout: [[x_c0, x_c1], [y_c0, y_c1]]; serialized layout must be
    // be(x_c1) || be(x_c0) || be(y_c1) || be(y_c0).
    const b = g2ToBytes([
      ["1", "2"],
      ["3", "4"],
    ]);
    expect(b.length).toBe(128);
    expect(b[31]).toBe(2); // x_c1 first
    expect(b[63]).toBe(1); // then x_c0
    expect(b[95]).toBe(4); // y_c1
    expect(b[127]).toBe(3); // then y_c0
  });
});

describe("proofToBytes against the committed circuit fixtures", () => {
  // Expected bytes copied (as hex) from contracts/zentra-verifier/src/
  // payment_fixtures.rs — PROOF_A / PROOF_B / PROOF_C, themselves generated
  // from circuits/payment-policy/proof.json. This pins the TS codec to the
  // exact bytes the Soroban verifier tests consume.
  const FIXTURE_PROOF_A =
    "2bf5490d9ccba718f6ef8b56bad0926602795d4d0b4aa35526b1e1f0d486b1bf24b249d37e0acdc6ec8924843faf83d88d2423b85240d3d3b94aa5c24bb3ba00";
  const FIXTURE_PROOF_B =
    "19e56422e10381403f3218fac0967742b177c9e623f9ee8457c4345f6effed052da97429450e5a21cd0ca04b43859756afceb050bf95612480e40457240e9bfa2c9f00b840f6edb11acc2a93556bbd121e4aa81f250acc8980a30d20389f80c92b643c9fff5d314d518ae418da3dddf4694beeb33e27cd9e70cb86e5b611765e";
  const FIXTURE_PROOF_C =
    "0affee1926160f25b9fe9701afcf21eaaed2a8823883492f813cbf7fd299379710089daa586878fcbaf4ec41fcd3a40ce649a500fd5c3cc50d2caaf5297d7533";

  const proof = JSON.parse(
    readFileSync(resolve(here, "../../../circuits/payment-policy/proof.json"), "utf8"),
  );

  it("serializes the committed proof.json byte-for-byte to the Rust fixture", () => {
    const bytes = proofToBytes(proof);
    expect(bytes.length).toBe(256);
    expect(toHex(bytes)).toBe(FIXTURE_PROOF_A + FIXTURE_PROOF_B + FIXTURE_PROOF_C);
  });

  it("g1/g2 pieces match the fixture individually", () => {
    expect(toHex(g1ToBytes(proof.pi_a))).toBe(FIXTURE_PROOF_A);
    expect(toHex(g2ToBytes(proof.pi_b))).toBe(FIXTURE_PROOF_B);
    expect(toHex(g1ToBytes(proof.pi_c))).toBe(FIXTURE_PROOF_C);
  });
});

describe("vkToBytes against the committed verification key", () => {
  const vk = JSON.parse(
    readFileSync(resolve(here, "../../../circuits/payment-policy/verification_key.json"), "utf8"),
  );

  it("emits soroban-sdk-shaped pieces (64B G1, 128B G2, 15 IC points)", () => {
    const b = vkToBytes(vk);
    expect(b.alpha.length).toBe(64);
    expect(b.beta.length).toBe(128);
    expect(b.gamma.length).toBe(128);
    expect(b.delta.length).toBe(128);
    expect(b.ic.length).toBe(15); // 14 public inputs + 1
    for (const p of b.ic) expect(p.length).toBe(64);
  });
});

describe("effectivePrior (mirrors the Rust unit tests in lib.rs)", () => {
  // Rust: effective_prior_same_epoch_is_unchanged
  it("same epoch is unchanged", () => {
    const s = { epochId: 5n, spentInEpoch: 300n, actionCount: 7n };
    expect(effectivePrior(s, 100, 550)).toEqual(s); // 550 / 100 == 5
  });

  // Rust: effective_prior_rollover_resets_spend_keeps_count
  it("rollover resets spend, keeps count", () => {
    const s = { epochId: 5n, spentInEpoch: 300n, actionCount: 7n };
    expect(effectivePrior(s, 100, 650)).toEqual({
      epochId: 6n, // 650 / 100 == 6 != 5
      spentInEpoch: 0n,
      actionCount: 7n,
    });
  });

  it("floors fractional wall-clock seconds like the contract's integer division", () => {
    const s = { epochId: 5n, spentInEpoch: 1n, actionCount: 1n };
    expect(effectivePrior(s, 100, 599.9).epochId).toBe(5n);
  });

  it("rejects a non-positive epoch length", () => {
    const s = { epochId: 0n, spentInEpoch: 0n, actionCount: 0n };
    expect(() => effectivePrior(s, 0, 100)).toThrow(/epochSeconds/);
  });
});
