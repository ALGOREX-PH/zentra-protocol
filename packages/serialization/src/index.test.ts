import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  FR_MODULUS,
  PUBLIC_INPUT_ORDER,
  addressToField,
  amountToField,
  bytes32ToField,
  encodePublicInputs,
  fieldToBytes32,
  toHex,
  type PublicInputName,
} from "./index";

const here = dirname(fileURLToPath(import.meta.url));
const golden = JSON.parse(
  readFileSync(resolve(here, "../golden-vectors.json"), "utf8"),
);

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
