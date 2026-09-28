"use client";

import type { NoticeKind, NoticeTone } from "@tor-now/domain";
import type { NoticeDto } from "@/lib/api/types.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { noticeDay, noticeText, type NoticeAction, type NoticeContext } from "@/lib/notice-text.ts";
import { localDateOf } from "@/components/owner/day-filter.ts";
import { Button, Sheet } from "@/components/ui.tsx";
import { BILLING_ICONS as ICONS, iconSvg as svg } from "@/components/billing-icons.tsx";

/**
 * The owner's Notices on screen (ADR 0020): a bell beside the account button,
 * one banner above whatever tab is open, and the list the bell opens.
 */

const ICON_OF: Readonly<Record<NoticeKind, keyof typeof ICONS>> = {
  TRIAL_STARTED: "spark",
  TRIAL_ENDING: "clock",
  PAYMENT_LATE: "alert",
  DEACTIVATED: "alert",
  PAYMENT_RECORDED: "check",
  PLAN_CHANGED: "swap",
  MOVE_SCHEDULED: "swap",
  MOVE_SOON: "clock",
  MOVE_APPLIED: "swap",
  CALENDARS_PAUSED: "pause",
  CALENDARS_RESUMED: "check",
  FEATURES_GRANTED: "gift",
  GRANT_EXTENDED: "gift",
  GRANT_ENDING: "clock",
  GRANT_ENDED: "gift",
  EDITION_ANNOUNCED: "clock",
  EDITION_SOON: "clock",
  EDITION_APPLIED: "swap",
  EDITION_CANCELLED: "check",
  PLAN_IMPROVED: "spark",
};

/** A banner has no green: good news reads in the calm blue, and only warnings are warm. */
const bannerTone = (tone: NoticeTone): Exclude<NoticeTone, "good"> => (tone === "good" ? "info" : tone);

/** How a Notice is worded, for the Business's own today. */
export const useNoticeContext = (timeZone: string): NoticeContext & { timeZone: string } => {
  const words = useCopy("notices");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  return { words, billing, language, today: localDateOf(new Date().toISOString(), timeZone), timeZone };
};

export const NoticeBell = ({ unread, onOpen }: { unread: number; onOpen: () => void }) => {
  const words = useCopy("notices");
  return (
    <button
      type="button"
      className="notice-bell"
      onClick={onOpen}
      aria-label={
        unread === 0 ? words.bell : unread === 1 ? words.unreadOne : fillText(words.unread, { n: String(unread) })
      }
    >
      {svg(
        <>
          <path d="M6 16V11a6 6 0 1 1 12 0v5l1.5 2h-15z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M10 20.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
        </>,
        18,
      )}
      {unread > 0 && (
        <span className="count tab" aria-hidden="true">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </button>
  );
};

export const NoticeBanner = ({
  notice,
  othersUnread,
  context,
  onGotIt,
  onAction,
}: {
  notice: NoticeDto;
  othersUnread: number;
  context: NoticeContext;
  onGotIt: () => void;
  onAction: (action: NoticeAction) => void;
}) => {
  const text = noticeText(notice.facts, context);
  const { action } = text;
  const { words } = context;
  return (
    <div className="notice-banner-wrap">
      <div className={`notice-banner ${bannerTone(notice.tone)}`} role="status">
        <div className="notice-banner-head">
          <span className="ico">{ICONS[ICON_OF[notice.kind]]}</span>
          <div>
            <strong>{text.title}</strong>
            <span>{text.body}</span>
          </div>
        </div>
        <div className="notice-banner-actions">
          <button type="button" className="ok" onClick={onGotIt}>
            {words.gotIt}
          </button>
          {action !== null && (
            <button type="button" className="go" onClick={() => onAction(action)}>
              {words.action[action]}
            </button>
          )}
        </div>
      </div>
      {othersUnread > 0 && (
        <p className="notice-more">
          {othersUnread === 1 ? words.moreOne : fillText(words.moreMany, { n: String(othersUnread) })}
        </p>
      )}
    </div>
  );
};

const NoticeRow = ({
  notice,
  fresh,
  context,
  onAction,
}: {
  notice: NoticeDto;
  fresh: boolean;
  context: NoticeContext & { timeZone: string };
  onAction: (action: NoticeAction) => void;
}) => {
  const text = noticeText(notice.facts, context);
  const { action } = text;
  return (
    <li className="notice-row">
      <span className={`ico ${notice.tone}`}>{ICONS[ICON_OF[notice.kind]]}</span>
      <span className="what">
        <strong>
          {fresh && <i aria-hidden="true" />}
          {text.title}
        </strong>
        <span>{text.body}</span>
        {action !== null && (
          <button type="button" className="link" onClick={() => onAction(action)}>
            {context.words.action[action]}
          </button>
        )}
      </span>
      <time dateTime={notice.createdAt}>{noticeDay(notice, context)}</time>
    </li>
  );
};

/**
 * The list the bell opens. `fresh` is what was unread when it opened: opening
 * marks everything read, and the list should not reshuffle under the owner's
 * eyes because of it.
 */
export const NoticeSheet = ({
  open,
  onClose,
  notices,
  fresh,
  context,
  onAction,
}: {
  open: boolean;
  onClose: () => void;
  notices: readonly NoticeDto[];
  fresh: ReadonlySet<string>;
  context: NoticeContext & { timeZone: string };
  onAction: (action: NoticeAction) => void;
}) => {
  const { words } = context;
  const newer = notices.filter((notice) => fresh.has(notice.id));
  const earlier = notices.filter((notice) => !fresh.has(notice.id));
  const group = (label: string, list: readonly NoticeDto[], isFresh: boolean) =>
    list.length === 0 ? null : (
      <section className="notice-group" aria-label={label}>
        <h3>{label}</h3>
        <ul>
          {list.map((notice) => (
            <NoticeRow key={notice.id} notice={notice} fresh={isFresh} context={context} onAction={onAction} />
          ))}
        </ul>
      </section>
    );

  return (
    <Sheet open={open} onClose={onClose} labelledBy="notices-title">
      <div className="notice-sheet">
        <h2 id="notices-title">{words.listTitle}</h2>
        {notices.length === 0 ? (
          <p className="hint">{words.empty}</p>
        ) : (
          <>
            {group(words.newer, newer, true)}
            {group(words.earlier, earlier, false)}
          </>
        )}
        <Button intent="quiet" onClick={onClose}>
          {words.close}
        </Button>
      </div>
    </Sheet>
  );
};
