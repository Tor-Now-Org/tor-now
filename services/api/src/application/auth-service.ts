import {
  DomainError,
  forbidden,
  instant,
  parseLocalDate,
  unauthenticated,
  type Clock,
  type LocalDate,
  type User,
} from "@tor-now/domain";
import { VERIFICATION } from "../config.ts";
import type { TokenIssuer } from "../ports/tokens.ts";
import type {
  CodeGenerator,
  CodeHasher,
  VerificationCodeRepository,
  VerificationSender,
} from "../ports/verification.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { requireUser } from "./authorization.ts";

/**
 * ADR 0004: registering, logging in and confirming a booking are the same act.
 * An unrecognised number becomes a new User; a recognised one is logged in.
 */

export type AuthDependencies = {
  readonly unitOfWork: UnitOfWork;
  readonly codes: VerificationCodeRepository;
  readonly sender: VerificationSender;
  readonly hasher: CodeHasher;
  readonly generator: CodeGenerator;
  readonly tokens: TokenIssuer;
  readonly clock: Clock;
  /** Development only; the configuration refuses this beside a real transport. */
  readonly exposeCode: boolean;
};

export type RequestCodeResult = {
  readonly expiresInSeconds: number;
  /** Present only when the deployment is configured to expose it. */
  readonly code?: string;
};

export type SignInResult = {
  readonly token: string;
  readonly user: User;
  /** False when the number was already known, which the interface uses to skip asking for a name. */
  readonly isNewUser: boolean;
};

const MILLISECONDS = 1000;

export const authService = (dependencies: AuthDependencies) => ({
  /**
   * Issues a code. ADR 0004 narrows rate limiting to issuance and checking,
   * which is what the window below enforces — an unthrottled endpoint here is
   * both a cost and a way to harass a phone number.
   */
  async requestCode(phone: string): Promise<RequestCodeResult> {
    const now = dependencies.clock.now();
    const windowStart = instant(
      now - VERIFICATION.issuanceWindowSeconds * MILLISECONDS,
    );
    const issued = await dependencies.codes.countIssuedSince(phone, windowStart);
    if (issued >= VERIFICATION.maxCodesPerPhonePerWindow) {
      throw new DomainError(
        "RATE_LIMITED",
        "Too many codes have been requested for this number. Try again shortly.",
      );
    }

    const code = dependencies.generator.generate(VERIFICATION.codeLength);
    const codeHash = await dependencies.hasher.hash(phone, code);
    await dependencies.codes.issue({
      phone,
      codeHash,
      expiresAt: instant(now + VERIFICATION.lifetimeSeconds * MILLISECONDS),
    });

    await dependencies.sender.send(phone, code);

    return {
      expiresInSeconds: VERIFICATION.lifetimeSeconds,
      ...(dependencies.exposeCode ? { code } : {}),
    };
  },

  /**
   * Checks a code and returns a session. A wrong code is counted against the
   * code itself rather than the number, so a live code cannot be brute-forced
   * and a legitimate holder is not locked out by someone else's guessing.
   */
  async verifyCode(
    phone: string,
    code: string,
    name: string | null,
  ): Promise<SignInResult> {
    const record = await dependencies.codes.latestLiveFor(phone);
    if (record === null) {
      throw new DomainError(
        "VERIFICATION_FAILED",
        "That code has expired. Ask for a new one.",
      );
    }
    if (record.attempts >= VERIFICATION.maxAttemptsPerCode) {
      throw new DomainError(
        "VERIFICATION_FAILED",
        "Too many attempts on this code. Ask for a new one.",
      );
    }

    const matches = await dependencies.hasher.verify(phone, code, record.codeHash);
    if (!matches) {
      await dependencies.codes.recordAttempt(record.id);
      throw new DomainError("VERIFICATION_FAILED", "That code is not correct");
    }
    await dependencies.codes.consume(record.id);

    return dependencies.unitOfWork.run({ kind: "ANONYMOUS" }, async ({ repositories }) => {
      const existing = await repositories.users.findByPhone(phone);

      if (existing !== null && existing.deletedAt !== null) {
        // ADR 0008: the row is retained and keeps the phone, so this number
        // cannot simply register again. Recovery needs an operator.
        throw forbidden(
          "This account has been closed. Contact support to reopen it.",
        );
      }

      const user =
        existing ??
        (await repositories.users.create({
          phone,
          name: (name ?? "").trim() || "אורח",
          birthDate: null,
        }));

      // ADR 0010: the flag alone is not sufficient — the number must also
      // appear on the allowlist, so a mistakenly set flag or a stolen session
      // does not by itself confer administrator access.
      const isAdministrator =
        user.isAdministrator &&
        (await repositories.administratorAllowlist.contains(phone));

      const token = await dependencies.tokens.issue({
        userId: user.id,
        phone: user.phone,
        isAdministrator,
      });

      return { token, user, isNewUser: existing === null };
    });
  },
});

export type ProfileDependencies = { readonly unitOfWork: UnitOfWork };

export const profileService = ({ unitOfWork }: ProfileDependencies) => ({
  async me(actor: Actor): Promise<User> {
    const userId = requireUser(actor);
    return unitOfWork.run(actor, async ({ repositories }) => {
      const user = await repositories.users.findById(userId);
      if (user === null) throw unauthenticated("This session no longer exists");
      return user;
    });
  },

  async updateProfile(
    actor: Actor,
    changes: { name?: string; birthDate?: string | null },
  ): Promise<User> {
    const userId = requireUser(actor);
    const birthDate: LocalDate | null | undefined =
      changes.birthDate === undefined
        ? undefined
        : changes.birthDate === null
          ? null
          : parseLocalDate(changes.birthDate);

    return unitOfWork.run(actor, ({ repositories }) =>
      repositories.users.update(userId, {
        ...(changes.name === undefined ? {} : { name: changes.name }),
        ...(birthDate === undefined ? {} : { birthDate }),
      }),
    );
  },

  /**
   * ADR 0008: a soft delete. Appointments, statistics and audit history are
   * unaffected, and the account can be restored if the customer changes their
   * mind. It does not satisfy a formal erasure request; nothing here does yet.
   */
  async deleteAccount(actor: Actor): Promise<void> {
    const userId = requireUser(actor);
    await unitOfWork.run(actor, async ({ repositories }) => {
      const owned = await repositories.memberships.listForUser(userId);
      if (owned.some((membership) => membership.role === "OWNER")) {
        throw forbidden(
          "A business owner cannot close their account while the business exists",
        );
      }
      await repositories.users.softDelete(userId);
    });
  },
});
