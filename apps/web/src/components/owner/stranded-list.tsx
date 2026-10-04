"use client";

import type { ClosureImpactDto } from "@/lib/api/types.ts";
import { whenIn } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";

/**
 * The appointments a change would leave standing in hours that are no longer
 * worked, by name and hour — "2 appointments" is not a decision, "Dana at
 * 13:30" is — with the one question about them: call them off and tell the
 * customers, or keep them and talk to them yourself.
 */
export const StrandedList = ({
  appointments,
  timeZone,
  language,
  showCalendar,
  when,
  upcoming,
  onUpcoming,
}: {
  appointments: ClosureImpactDto["appointments"];
  timeZone: string;
  language: "he" | "en";
  /** Whose chair each one is in, when the change touches more than one. */
  showCalendar: boolean;
  /** "in these hours", "on these days": what the count is about. */
  when: string;
  upcoming: "CANCEL" | "KEEP";
  onUpcoming: (upcoming: "CANCEL" | "KEEP") => void;
}) => {
  const copy = useCopy("change");
  const count = appointments.length;
  if (count === 0) {
    return (
      <p className="hint" style={{ margin: 0 }}>
        {copy.noneBooked} {when}.
      </p>
    );
  }
  const one = count === 1;
  return (
    <div className="change-booked">
      <b id="change-booked-title">
        {one ? copy.oneBooked : fillText(copy.manyBooked, { count: String(count) })} {when}
      </b>
      <ul aria-labelledby="change-booked-title" className="scroll" style={{ maxHeight: 190 }}>
        {appointments.map((appointment) => (
          <li key={appointment.id}>
            <span>
              {appointment.customerName}
              <small>
                {" · "}
                {appointment.serviceName}
                {showCalendar && appointment.resourceName !== "" ? ` · ${appointment.resourceName}` : ""}
              </small>
            </span>
            <span className="tab">{whenIn(appointment.startAt, timeZone, language)}</span>
          </li>
        ))}
      </ul>
      <div role="radiogroup" aria-labelledby="change-booked-title" style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {(["CANCEL", "KEEP"] as const).map((answer) => (
          <button
            key={answer}
            type="button"
            role="radio"
            aria-checked={upcoming === answer}
            className={upcoming === answer ? "change-answer on" : "change-answer"}
            onClick={() => onUpcoming(answer)}
          >
            <span className="change-dot" aria-hidden="true" />
            {answer === "CANCEL" ? (one ? copy.cancelIt : copy.cancelThem) : one ? copy.keepIt : copy.keepThem}
          </button>
        ))}
      </div>
    </div>
  );
};
