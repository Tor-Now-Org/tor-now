import { asId, type UserId } from "@tor-now/domain";
import { jwtVerify, SignJWT } from "jose";
import { SESSION_LIFETIME_SECONDS } from "../../config.ts";
import type {
  SessionClaims,
  TokenIssuer,
  TokenVerifier,
} from "../../ports/tokens.ts";

/**
 * ADR 0007 has the Edge Function verify a Supabase JWT; tokens are therefore
 * signed with the project's own JWT secret and carry the claims Supabase's
 * conventions expect — `sub` and `role` — so the same token satisfies both this
 * service and Row Level Security.
 *
 * ADR 0009 fixes the lifetime at thirty days for every role, decided in exactly
 * one place: `SESSION_LIFETIME_SECONDS`.
 */
const ALGORITHM = "HS256";
const ISSUER = "tor-now";

/**
 * The secret handed to this adapter is never used as the signing key directly.
 * HKDF separates it into a key that exists only for signing sessions, so a key
 * that also has another job — the service role key, when no dedicated JWT
 * secret is provisioned — is not the thing that signs tokens.
 */
const KEY_INFO = new TextEncoder().encode("tor-now/session-signing-key/v1");

const derived = new Map<string, Promise<Uint8Array>>();

const keyFor = (secret: string): Promise<Uint8Array> => {
  const cached = derived.get(secret);
  if (cached !== undefined) return cached;

  const deriving = (async () => {
    const material = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      "HKDF",
      false,
      ["deriveBits"],
    );
    const bits = await crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(0), info: KEY_INFO },
      material,
      256,
    );
    return new Uint8Array(bits);
  })();

  derived.set(secret, deriving);
  return deriving;
};

export const jwtIssuer = (secret: string): TokenIssuer => ({
  async issue(claims: SessionClaims) {
    const now = Math.floor(Date.now() / 1000);
    return new SignJWT({
      role: "authenticated",
      phone: claims.phone,
      is_administrator: claims.isAdministrator,
    })
      .setProtectedHeader({ alg: ALGORITHM })
      .setSubject(claims.userId)
      .setIssuer(ISSUER)
      .setIssuedAt(now)
      .setExpirationTime(now + SESSION_LIFETIME_SECONDS)
      .sign(await keyFor(secret));
  },
});

export const jwtVerifier = (secret: string): TokenVerifier => ({
  async verify(token: string) {
    try {
      const { payload } = await jwtVerify(token, await keyFor(secret), {
        algorithms: [ALGORITHM],
        issuer: ISSUER,
      });
      if (typeof payload.sub !== "string" || typeof payload["phone"] !== "string") {
        return null;
      }
      return {
        userId: asId(payload.sub) as UserId,
        phone: payload["phone"],
        isAdministrator: payload["is_administrator"] === true,
      };
    } catch {
      // An unreadable, expired or wrongly signed token is not an error the
      // caller can act on differently — it is simply not a session.
      return null;
    }
  },
});
