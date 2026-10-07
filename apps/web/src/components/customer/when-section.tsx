"use client";

import { useState } from "react";
import type { BusinessDto, SlotDto } from "@/lib/api/types.ts";
import type { PartOfDay } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { spanOfDays, spanOfMinutes } from "@/lib/span-text.ts";
import { SlotGrid } from "../slot-grid.tsx";
import { Spinner } from "../ui.tsx";
import { DayStrip } from "./day-strip.tsx";
import { MonthSheet } from "./month-sheet.tsx";
import type { useChoosingDay } from "./use-choosing-day.ts";

/** From a day's notice on, the window says so above the days (ADR 0026). */
const NOTICE_LINE_FROM_MINUTES = 24 * 60;

/**
 * "בוחרים שעה": the days and what each holds, the month, and the times of the
 * day being looked at. ADR 0026.
 */
export const WhenSection = ({
  business,
  chooser,
  hasService,
  selectedSlot,
  onSelectSlot,
  onWaitFor,
  waitingFor,
  waitingList,
}: {
  business: BusinessDto;
  chooser: ReturnType<typeof useChoosingDay>;
  hasService: boolean;
  selectedSlot: string | null;
  onSelectSlot: (slot: SlotDto) => void;
  onWaitFor: ((part: PartOfDay | null) => void) | undefined;
  waitingFor: readonly PartOfDay[];
  /** Whether this business offers a waiting list at all (ADR 0019). */
  waitingList: boolean;
}) => {
  const copy = useCopy("customer");
  const words = useCopy("days");
  const [monthOpen, setMonthOpen] = useState(false);

  const noneSoonBody = [
    chooser.showsMonth
      ? words.noneSoonMonth
      : fillText(words.noneSoonOpening, { span: spanOfDays(business.bookingHorizonDays, words) }),
    waitingList ? words.noneSoonWait : null,
  ]
    .filter((sentence): sentence is string => sentence !== null)
    .join(" ");

  return (
    <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {/* The month sits by the heading, in sight, not at the end of the strip's scroll. */}
      <div className="when-head">
        <span className="label">{copy.chooseTime}</span>
        {chooser.showsMonth && (
          <button type="button" className="month-link" onClick={() => setMonthOpen(true)} aria-haspopup="dialog">
            <svg viewBox="0 0 20 20" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
              <rect x="3" y="4.5" width="14" height="12.5" rx="2.5" />
              <path d="M3 8.5h14M7 2.5v4M13 2.5v4" />
            </svg>
            {words.wholeMonth}
          </button>
        )}
      </div>
      {business.minimumNoticeMinutes >= NOTICE_LINE_FROM_MINUTES && (
        <p className="note" style={{ margin: 0 }}>
          {fillText(words.noticeLine, { notice: spanOfMinutes(business.minimumNoticeMinutes, words) })}{" "}
          <a href={`tel:${business.phone}`} style={{ fontWeight: 600 }}>
            {words.callLink}
          </a>
          .
        </p>
      )}
      {/* Compact on purpose: the chosen day says its own reason right below. */}
      {chooser.noneSoon && (
        <div className="none-soon" role="status">
          <b>{chooser.showsMonth ? words.noneSoonTitle : words.noneInWindowTitle}</b>
          <span>{noneSoonBody}</span>
        </div>
      )}
      <DayStrip
        dates={chooser.strip}
        marks={chooser.marks}
        today={chooser.today}
        selected={chooser.date}
        onSelect={chooser.choose}
        nextOpening={chooser.nextOpening}
      />
      {chooser.day === undefined ? (
        hasService ? <Spinner /> : null
      ) : (
        <SlotGrid
          day={chooser.day}
          timeZone={business.timeZone}
          selected={selectedSlot}
          onSelect={onSelectSlot}
          labels={{
            morning: copy.morning,
            noon: copy.noon,
            evening: copy.evening,
            noTimes: copy.noTimes,
            noTimesBody: copy.noTimesBody,
            callBusiness: copy.callBusiness,
            waitForPart: copy.waitForPart,
            waitForDay: copy.waitForDay,
            waitingForPart: copy.waitingForPart,
            waitingForDay: copy.waitingForDay,
          }}
          businessPhone={business.phone}
          onWaitFor={onWaitFor}
          waitingFor={waitingFor}
          bookingWindow={{
            today: chooser.today,
            horizonDays: business.bookingHorizonDays,
            noticeMinutes: business.minimumNoticeMinutes,
          }}
        />
      )}
      {chooser.showsMonth && (
        <MonthSheet
          open={monthOpen}
          onClose={() => setMonthOpen(false)}
          today={chooser.today}
          lastDay={chooser.lastDay}
          selected={chooser.date}
          days={chooser.days}
          timeZone={business.timeZone}
          horizonDays={business.bookingHorizonDays}
          ensure={chooser.ensure}
          onPick={(date) => {
            chooser.choose(date);
            setMonthOpen(false);
          }}
        />
      )}
    </section>
  );
};
