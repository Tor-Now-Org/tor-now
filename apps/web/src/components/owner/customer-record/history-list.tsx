"use client";

import type { AppointmentDto } from "@/lib/api/types.ts";
import { formatPrice } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { isCancelled, StatusTag } from "../appointment-sheet.tsx";
import { ListDivider } from "../list-ui.tsx";
import { withMonths } from "../list-model.ts";
import { dayOfMonth, monthAndYear, shortMonth, timeOnly } from "./record-dates.ts";

/**
 * What has already happened, newest first: one dated row each, what happened
 * said in a tag, and what it came to. Past a dozen visits the rows are split
 * by month, so "when were they last here" is always the first row.
 */
export const HistoryList = ({
  history,
  zone,
  onOpen,
}: {
  /** Newest first. */
  history: readonly AppointmentDto[];
  zone: string;
  onOpen: (appointment: AppointmentDto) => void;
}) => {
  const words = useCopy("lists");
  const owner = useCopy("owner");
  const { language } = useLanguage();

  return (
    <section className="history" aria-labelledby="history-title">
      <h2 id="history-title" className="history-title">
        {words.history}
      </h2>
      {history.length === 0 ? (
        <p className="list-foot">{words.noHistory}</p>
      ) : (
        <ul className="list-card">
          {withMonths(history, (appointment) => monthAndYear(appointment.startAt, zone, language)).map((entry) =>
            entry.kind === "month" ? (
              <ListDivider key={`month-${entry.text}`} text={entry.text} />
            ) : (
              <li key={entry.item.id}>
                <button type="button" className="dated-row list-row" onClick={() => onOpen(entry.item)}>
                  <span className="dated-day" aria-hidden="true">
                    <b>{dayOfMonth(entry.item.startAt, zone, language)}</b>
                    <small>{shortMonth(entry.item.startAt, zone, language)}</small>
                  </span>
                  <span className="list-text">
                    {/* The strike shows what the tag says, only for a cancellation. */}
                    <span className={`list-title${isCancelled(entry.item) ? " cancelled" : ""}`}>{entry.item.serviceName}</span>
                    <span className="list-line">
                      {timeOnly(entry.item.startAt, zone, language)}
                      {/* A cancelled appointment was never paid. */}
                      {isCancelled(entry.item) ? "" : ` · ${formatPrice(entry.item.priceMinor, language, owner.free)}`}
                    </span>
                  </span>
                  <span className="list-tags">
                    <StatusTag appointment={entry.item} copy={owner} />
                  </span>
                </button>
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  );
};
