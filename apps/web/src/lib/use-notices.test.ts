import { describe, expect, it } from "vitest";
import { parseLocalDate } from "@tor-now/domain";
import type { NoticeBoardDto, NoticeDto } from "@/lib/api/types.ts";
import { bannerOf, unreadOf } from "./use-notices.ts";

const aNotice = (id: string, read: boolean): NoticeDto => ({
  id,
  kind: "PAYMENT_RECORDED",
  tone: "good",
  facts: { kind: "PAYMENT_RECORDED", paidThrough: parseLocalDate("2026-11-23") },
  createdAt: "2026-10-19T06:00:00.000Z",
  read,
  standing: false,
});

describe("the board on screen", () => {
  const board: NoticeBoardDto = {
    notices: [aNotice("a", false), aNotice("b", true), aNotice("c", false)],
    banner: { noticeId: "c", othersUnread: 1 },
  };

  it("finds the banner's Notice in the list", () => {
    expect(bannerOf(board)).toEqual({ notice: board.notices[2], othersUnread: 1 });
  });

  it("shows no banner when none stands, or the one named is not in the list", () => {
    expect(bannerOf(null)).toBeNull();
    expect(bannerOf({ ...board, banner: null })).toBeNull();
    expect(bannerOf({ ...board, banner: { noticeId: "gone", othersUnread: 0 } })).toBeNull();
  });

  it("counts what is unread", () => {
    expect(unreadOf(board)).toBe(2);
    expect(unreadOf(null)).toBe(0);
  });
});
