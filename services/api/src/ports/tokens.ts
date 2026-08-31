import type { UserId } from "@tor-now/domain";

/**
 * ADR 0007 has the Edge Function verify a Supabase JWT and re-establish the
 * caller's identity per transaction. This port is what issues and reads those
 * tokens.
 */
export type SessionClaims = {
  readonly userId: UserId;
  readonly phone: string;
  readonly isAdministrator: boolean;
};

export type TokenIssuer = {
  /** Lifetime is ADR 0009's thirty days, decided in one place only. */
  issue(claims: SessionClaims): Promise<string>;
};

export type TokenVerifier = {
  /** Returns null for anything not a live, well-formed token of ours. */
  verify(token: string): Promise<SessionClaims | null>;
};
