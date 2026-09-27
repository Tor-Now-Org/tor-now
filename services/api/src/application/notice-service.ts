import { bannerOf, notFound, type BusinessId, type Clock, type Notice, type NoticeId } from "@tor-now/domain";
import { NOTICES } from "../config.ts";
import type { Repositories } from "../ports/repositories.ts";
import type { Actor, UnitOfWork } from "../ports/unit-of-work.ts";
import { loadOwnedBusiness } from "./authorization.ts";

/**
 * The owner's Notices (ADR 0020): the list behind the bell, and the one banner
 * that stands above every screen. Billing is the OWNER's alone (ADR 0016), so a
 * manager or worker sees neither.
 */

export type NoticeBoard = {
  /** The newest first. */
  readonly notices: readonly Notice[];
  /** The one banner to show, when one stands. */
  readonly banner: { readonly noticeId: NoticeId; readonly othersUnread: number } | null;
};

const boardOf = async (repositories: Repositories, businessId: BusinessId): Promise<NoticeBoard> => {
  const notices = await repositories.notices.listForBusiness(businessId, NOTICES.listLimit);
  const banner = bannerOf(notices);
  return {
    notices,
    banner: banner === null ? null : { noticeId: banner.notice.id, othersUnread: banner.othersUnread },
  };
};

export const noticeService = ({ unitOfWork, clock }: { unitOfWork: UnitOfWork; clock: Clock }) => ({
  async board(actor: Actor, businessId: BusinessId): Promise<NoticeBoard> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      return boardOf(repositories, businessId);
    });
  },

  /** The owner opened the list: everything in it has now been seen. */
  async markAllRead(actor: Actor, businessId: BusinessId): Promise<NoticeBoard> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      await repositories.notices.markAllRead(businessId, clock.now());
      return boardOf(repositories, businessId);
    });
  },

  /** "Got it" on a banner: it stops standing, and stays in the list. */
  async acknowledge(actor: Actor, businessId: BusinessId, noticeId: NoticeId): Promise<NoticeBoard> {
    return unitOfWork.run(actor, async ({ repositories }) => {
      await loadOwnedBusiness(repositories, actor, businessId);
      const acknowledged = await repositories.notices.acknowledge(businessId, noticeId, clock.now());
      if (acknowledged === null) throw notFound("Notice", noticeId);
      return boardOf(repositories, businessId);
    });
  },
});
