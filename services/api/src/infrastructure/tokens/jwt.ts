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

const keyFor = (secret: string): Uint8Array => new TextEncoder().encode(secret);

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
      .sign(keyFor(secret));
  },
});

export const jwtVerifier = (secret: string): TokenVerifier => ({
  async verify(token: string) {
    try {
      const { payload } = await jwtVerify(token, keyFor(secret), {
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
