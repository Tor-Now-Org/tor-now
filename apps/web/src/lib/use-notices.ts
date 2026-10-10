"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import type { BusinessDto, NoticeBoardDto, NoticeDto } from "@/lib/api/types.ts";

/** The Notice the board says stands as the banner, found in its list. */
export const bannerOf = (
  board: NoticeBoardDto | null,
): { readonly notice: NoticeDto; readonly othersUnread: number } | null => {
  if (board === null || board.banner === null) return null;
  const { noticeId, othersUnread } = board.banner;
  const notice = board.notices.find((candidate) => candidate.id === noticeId);
  return notice === undefined ? null : { notice, othersUnread };
};

/** What the pay-today banner already says, as a Notice. */
const SAID_BY_PAY_BANNER: readonly string[] = ["PAYMENT_DUE", "PAYMENT_LATE", "TRIAL_ENDING"];

/** The pay-today banner says what these Notices say, so not both. */
export const bannerBeside = <Banner extends { readonly notice: NoticeDto }>(
  banner: Banner | null,
  payBannerShown: boolean,
): Banner | null =>
  payBannerShown && banner !== null && SAID_BY_PAY_BANNER.includes(banner.notice.facts.kind) ? null : banner;

export const unreadOf = (board: NoticeBoardDto | null): number =>
  (board?.notices ?? []).filter((notice) => !notice.read).length;

/**
 * The owner's Notices for the Business on screen (ADR 0020). Billing is the
 * OWNER's alone (ADR 0016), so for anybody else — and for a Business that is
 * switched off, whose screen is a sheet saying so — there is no board at all.
 *
 * A Notice is a courtesy, never a gate: a read that fails leaves the board as
 * it was rather than breaking the screen the owner came to use.
 */
export const useNotices = (token: string | null, business: BusinessDto | null) => {
  const [board, setBoard] = useState<NoticeBoardDto | null>(null);
  const owns = business !== null && business.active && (business.role ?? "OWNER") === "OWNER";
  const businessId = business?.id ?? null;

  useEffect(() => {
    if (token === null || businessId === null || !owns) {
      setBoard(null);
      return;
    }
    let stale = false;
    api
      .notices(token, businessId)
      .then((next) => {
        if (!stale) setBoard(next);
      })
      .catch(() => {
        if (!stale) setBoard(null);
      });
    return () => {
      stale = true;
    };
  }, [token, businessId, owns]);

  const update = useCallback(
    async (change: (token: string, businessId: string) => Promise<NoticeBoardDto>) => {
      if (token === null || businessId === null) return;
      try {
        setBoard(await change(token, businessId));
      } catch {
        // Left as it was: the next visit reads it again.
      }
    },
    [token, businessId],
  );

  return {
    board,
    banner: bannerOf(board),
    unread: unreadOf(board),
    /** The list was opened: everything in it is read. */
    markAllRead: useCallback(() => update(api.readNotices), [update]),
    /** "Got it" on the banner. */
    acknowledge: useCallback(
      (noticeId: string) => update((t, id) => api.acknowledgeNotice(t, id, noticeId)),
      [update],
    ),
  };
};
