import { describe, expect, it } from "vitest";
import {
  CONTRACT_ERROR_NAMES,
  ContractInvokeError,
  ProveError,
  RpcTimeoutError,
  ZentraError,
  contractInvokeError,
  parseContractErrorCode,
} from "./errors";

describe("contract error mapping (contracts/zentra-verifier/src/lib.rs Error enum)", () => {
  it("maps every code 1..8 to the verifier's error name", () => {
    expect(CONTRACT_ERROR_NAMES).toEqual({
      1: "MalformedVerifyingKey",
      2: "PolicyNotFound",
      3: "PolicyRevoked",
      4: "InvalidProof",
      5: "StateMismatch",
      6: "NullifierUsed",
      7: "InvalidAmount",
      8: "Overflow",
    });
  });

  it("parses Error(Contract, #n) out of a Soroban diagnostic string", () => {
    const detail =
      'host invocation failed: HostError: Error(Contract, #6)\nDebugInfo not available';
    expect(parseContractErrorCode(detail)).toBe(6);
    expect(parseContractErrorCode("transaction simulation failed: no luck")).toBeUndefined();
  });

  it("builds a decoded, actionable ContractInvokeError", () => {
    const err = contractInvokeError("simulate", "HostError: Error(Contract, #6)");
    expect(err).toBeInstanceOf(ContractInvokeError);
    expect(err).toBeInstanceOf(ZentraError);
    expect(err.code).toBe(6);
    expect(err.errorName).toBe("NullifierUsed");
    expect(err.phase).toBe("simulate");
    expect(err.message).toMatch(/NullifierUsed/);
    expect(err.message).toMatch(/fresh nonce/);
    expect(err.detail).toContain("Error(Contract, #6)");
  });

  it("keeps unknown contract codes decodable", () => {
    const err = contractInvokeError("send", "Error(Contract, #42)");
    expect(err.code).toBe(42);
    expect(err.errorName).toBe("UnknownContractError42");
  });

  it("falls back to the raw detail when no contract code is present", () => {
    const err = contractInvokeError("confirm", "tx abc failed on-chain: AAAA...");
    expect(err.code).toBeUndefined();
    expect(err.message).toContain("confirm failed");
    expect(err.detail).toContain("AAAA");
  });
});

describe("error classes", () => {
  it("RpcTimeoutError names the operation and deadline", () => {
    const err = new RpcTimeoutError("simulate", 25000);
    expect(err).toBeInstanceOf(ZentraError);
    expect(err.operation).toBe("simulate");
    expect(err.timeoutMs).toBe(25000);
    expect(err.message).toMatch(/simulate timed out after 25000ms/);
  });

  it("subclasses carry their own names for logs", () => {
    expect(new ProveError("x").name).toBe("ProveError");
    expect(new RpcTimeoutError("y", 1).name).toBe("RpcTimeoutError");
    expect(contractInvokeError("send", "z").name).toBe("ContractInvokeError");
  });
});
