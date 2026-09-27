import {
  isAboutPaying,
  noticeKey,
  noticesCleared,
  type BusinessId,
  type Instant,
  type Notice,
  type NoticeFacts,
  type PaymentNoticeFacts,
} from "@tor-now/domain";
import { TEMPLATES } from "../ports/notifier.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Session } from "../ports/unit-of-work.ts";

/**
 * Telling a Business about its Subscription (ADR 0020), in the transaction of
 * whatever happened. Two doors, split by type, so a Notice about paying can
 * never be kept without its WhatsApp message: `tell` has no outbox and takes
 * only news, `announce` takes anything and sends what is about paying.
 */

/** Everything that is not about paying: kept in the list, never sent. */
export type NewsFacts = Exclude<NoticeFacts, PaymentNoticeFacts>;

type Telling<Facts extends NoticeFacts> = {
  readonly businessId: BusinessId;
  readonly facts: Facts;
  readonly at: Instant;
};

/**
 * Keeps the Notice, first ending whatever standing banner it makes moot. Null
 * when the same Notice was already kept — seen again by a daily run.
 */
const keep = async (repositories: Repositories, telling: Telling<NoticeFacts>): Promise<Notice | null> => {
  await repositories.notices.clear(telling.businessId, noticesCleared(telling.facts.kind), telling.at);
  return repositories.notices.post({
    businessId: telling.businessId,
    facts: telling.facts,
    key: noticeKey(telling.facts),
  });
};

export const tell = (repositories: Repositories, telling: Telling<NewsFacts>): Promise<Notice | null> =>
  keep(repositories, telling);

/**
 * The phone of whoever owns the Business: the first OWNER, as the directory
 * names them. Null for a Business nobody owns any more, which is told nothing.
 */
const ownerPhoneOf = async (repositories: Repositories, businessId: BusinessId): Promise<string | null> => {
  const [owner] = [...(await repositories.memberships.listForBusiness(businessId, "OWNER"))].sort(
    (a, b) => a.createdAt - b.createdAt,
  );
  if (owner === undefined) return null;
  return (await repositories.users.findById(owner.userId))?.phone ?? null;
};

export const announce = async (
  session: Pick<Session, "repositories" | "outbox">,
  telling: Telling<NoticeFacts>,
): Promise<Notice | null> => {
  const notice = await keep(session.repositories, telling);
  const { facts } = telling;
  // Sent once, with the Notice it belongs to: a Notice kept already was sent then.
  if (notice === null || !isAboutPaying(facts)) return notice;
  const [business, phone] = await Promise.all([
    session.repositories.businesses.findById(telling.businessId),
    ownerPhoneOf(session.repositories, telling.businessId),
  ]);
  if (business !== null && phone !== null) {
    await session.outbox.enqueue({
      businessId: telling.businessId,
      recipientPhone: phone,
      template: TEMPLATES.billingNotice,
      payload: { businessName: business.name, facts },
    });
  }
  return notice;
};
