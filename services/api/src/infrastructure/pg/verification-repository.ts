import { instant } from "@tor-now/domain";
import type {
  VerificationCodeRecord,
  VerificationCodeRepository,
} from "../../ports/verification.ts";
import type { Transaction } from "./client.ts";
import type { Row } from "./mappers.ts";

const toRecord = (row: Row): VerificationCodeRecord => ({
  id: String(row["id"]),
  phone: String(row["phone"]),
  codeHash: String(row["code_hash"]),
  expiresAt: instant(new Date(row["expires_at"] as string).getTime()),
  consumedAt:
    row["consumed_at"] === null
      ? null
      : instant(new Date(row["consumed_at"] as string).getTime()),
  attempts: Number(row["attempts"]),
  createdAt: instant(new Date(row["created_at"] as string).getTime()),
});

export const verificationCodeRepository = (
  tx: Transaction,
): VerificationCodeRepository => ({
  async issue({ phone, codeHash, expiresAt }) {
    const rows = await tx<Row[]>`
      insert into verification_code (phone, code_hash, expires_at)
      values (${phone}, ${codeHash}, ${new Date(expiresAt)})
      returning *`;
    const row = rows[0];
    if (row === undefined) throw new Error("Failed to issue a verification code");
    return toRecord(row);
  },

  async latestLiveFor(phone) {
    const rows = await tx<Row[]>`
      select * from verification_code
      where phone = ${phone} and consumed_at is null and expires_at > now()
      order by created_at desc
      limit 1`;
    const row = rows[0];
    return row === undefined ? null : toRecord(row);
  },

  async countIssuedSince(phone, since) {
    const rows = await tx<Row[]>`
      select count(*)::int as count from verification_code
      where phone = ${phone} and created_at >= ${new Date(since)}`;
    return Number(rows[0]?.["count"] ?? 0);
  },

  async recordAttempt(id) {
    await tx`update verification_code set attempts = attempts + 1 where id = ${id}`;
  },

  async consume(id) {
    await tx`update verification_code set consumed_at = now() where id = ${id}`;
  },
});
