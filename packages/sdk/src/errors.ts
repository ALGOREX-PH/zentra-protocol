// Typed SDK errors. Every failure the SDK surfaces is a ZentraError subclass,
// so callers can branch on `instanceof` (or `code` for contract failures)
// instead of parsing raw JSON/XDR strings.

/** Base class for every error thrown by the Zentra SDK. */
export class ZentraError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = new.target.name;
  }
}

/**
 * Contract error codes, mirroring the `Error` enum in
 * contracts/zentra-verifier/src/lib.rs (keep in sync with that file):
 *
 *   MalformedVerifyingKey = 1,
 *   PolicyNotFound        = 2,
 *   PolicyRevoked         = 3,
 *   InvalidProof          = 4,
 *   StateMismatch         = 5,
 *   NullifierUsed         = 6,
 *   InvalidAmount         = 7,
 *   Overflow              = 8,
 */
export const CONTRACT_ERROR_NAMES: Record<number, string> = {
  1: "MalformedVerifyingKey",
  2: "PolicyNotFound",
  3: "PolicyRevoked",
  4: "InvalidProof",
  5: "StateMismatch",
  6: "NullifierUsed",
  7: "InvalidAmount",
  8: "Overflow",
};

/** What the agent should do about each contract error. */
const CONTRACT_ERROR_HINTS: Record<number, string> = {
  1: "the deployed contract's verification key is malformed — redeploy with a vk.rs regenerated from the current zkey",
  2: "no policy is registered for this (agent, commitment) — run register_policy (CLI: zentra policy commit) first",
  3: "the policy has been revoked — register a new policy before submitting actions",
  4: "the proof did not verify — the prover's circuit artifacts likely mismatch the deployed verification key, or a public input differs from the submitted arguments",
  5: "the proof's prev_* state does not match the on-chain AuthorityState — re-read authority_state and prove again against fresh state",
  6: "this action's nullifier was already consumed — each proof settles once; generate a new proof with a fresh nonce",
  7: "amount must be positive",
  8: "spend or action-count arithmetic overflowed",
};

/**
 * A Soroban simulation/submission failure. When the failure is a contract
 * error of shape `Error(Contract, #n)`, `code`/`errorName` carry the decoded
 * verifier error.
 */
export class ContractInvokeError extends ZentraError {
  constructor(
    /** Which stage failed: transaction simulation, submission, or confirmation. */
    readonly phase: "simulate" | "send" | "confirm",
    message: string,
    /** Decoded contract error code (`Error(Contract, #n)`), if present. */
    readonly code?: number,
    /** Verifier error name for `code`, e.g. "NullifierUsed". */
    readonly errorName?: string,
    /** Raw diagnostic detail (simulation error string, errorResult XDR, ...). */
    readonly detail?: string,
  ) {
    super(message);
  }
}

/** Extract `Error(Contract, #n)` from a Soroban diagnostic string, if present. */
export function parseContractErrorCode(detail: string): number | undefined {
  const m = /Error\(Contract, #(\d+)\)/.exec(detail);
  return m ? Number(m[1]) : undefined;
}

/** Build a ContractInvokeError from a raw Soroban failure string. */
export function contractInvokeError(
  phase: "simulate" | "send" | "confirm",
  detail: string,
): ContractInvokeError {
  const code = parseContractErrorCode(detail);
  if (code !== undefined) {
    const name = CONTRACT_ERROR_NAMES[code] ?? `UnknownContractError${code}`;
    const hint = CONTRACT_ERROR_HINTS[code];
    const message = `contract rejected the call with ${name} (#${code})${hint ? `: ${hint}` : ""}`;
    return new ContractInvokeError(phase, message, code, name, detail);
  }
  return new ContractInvokeError(phase, `${phase} failed: ${detail}`, undefined, undefined, detail);
}

/** An RPC call exceeded its deadline. */
export class RpcTimeoutError extends ZentraError {
  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(
      `${operation} timed out after ${timeoutMs}ms — the Soroban RPC endpoint is slow or unreachable; retry or point the client at another rpcUrl`,
    );
  }
}

/** Proof generation failed (policy pre-validation or witness/proving failure). */
export class ProveError extends ZentraError {}
