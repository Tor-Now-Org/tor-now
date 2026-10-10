"use client";

import { useState } from "react";
import type { AppointmentDto } from "@/lib/api/types.ts";
import { formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Chevron } from "../list-ui.tsx";
import { upcomingShown } from "../list-model.ts";
import { dayAndTime, dayOfMonth, shortMonth, timeOnly, weekdayShort } from "./record-dates.ts";

/**
 * A customer's appointments still to come: the next one first and large, the
 * rest as dated rows under it — all of them up to three, and past three the
 * first three with "עוד N" to open the rest in place. Every one opens the
 * appointment's own sheet, the one the calendar opens.
 */
export const UpcomingCard = ({
  upcoming,
  zone,
  onOpen,
}: {
  /** In date order. */
  upcoming: readonly AppointmentDto[];
  zone: string;
  onOpen: (appointment: AppointmentDto) => void;
}) => {
  const words = useCopy("lists");
  const owner = useCopy("owner");
  const { language } = useLanguage();
  const [open, setOpen] = useState(false);
  const shown = upcomingShown(upcoming, open);
  if (shown.next === null) return null;
  const next = shown.next;
  const detail = (appointment: AppointmentDto) =>
    [appointment.serviceName, appointment.resourceName, formatPrice(appointment.priceMinor, language, owner.free)]
      .filter((part): part is string => part !== undefined && part !== null && part !== "")
      .join(" · ");

  return (
    <section className="card upcoming-card" aria-labelledby="upcoming-title">
      <h2 id="upcoming-title" className="upcoming-label">
        {words.nextAppointment}
      </h2>
      <button type="button" className="upcoming-next" onClick={() => onOpen(next)}>
        <span className="list-text">
          <span className="upcoming-when">{dayAndTime(next.startAt, zone, language)}</span>
          <span className="list-line">{detail(next)}</span>
        </span>
        <Chevron />
      </button>
      {shown.rest.length > 0 && (
        <ul className="upcoming-rest" id="upcoming-rest">
          {shown.rest.map((appointment) => (
            <li key={appointment.id}>
              <button type="button" className="dated-row" onClick={() => onOpen(appointment)}>
                <span className="dated-day" aria-hidden="true">
                  <b>{dayOfMonth(appointment.startAt, zone, language)}</b>
                  <small>{shortMonth(appointment.startAt, zone, language)}</small>
                </span>
                <span className="list-text">
                  <span className="list-title">{appointment.serviceName}</span>
                  <span className="list-line">
                    {[weekdayShort(appointment.startAt, zone, language), timeOnly(appointment.startAt, zone, language), appointment.resourceName]
                      .filter((part) => part !== undefined && part !== null && part !== "")
                      .join(" · ")}
                  </span>
                </span>
                <Chevron />
              </button>
            </li>
          ))}
        </ul>
      )}
      {shown.foldable && (
        <button
          type="button"
          className={`upcoming-toggle${open ? " open" : ""}`}
          aria-expanded={open}
          aria-controls="upcoming-rest"
          onClick={() => setOpen(!open)}
        >
          {open
            ? words.fewer
            : shown.folded === 1
              ? words.moreUpcomingOne
              : fillText(words.moreUpcoming, { n: String(shown.folded) })}
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <path d="m6 9 6 6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      )}
    </section>
  );
};
