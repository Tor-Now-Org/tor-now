"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { NumberField } from "../number-field.tsx";
import { bufferOf } from "./buffer.ts";

/**
 * A service's recovery time (the Buffer), chosen the way an owner thinks of it:
 * the same as the business, or a time of its own.
 *
 * It used to be a number box whose empty state said "default" — which default,
 * how long, and set where, were all left to guesswork. Now the business's own
 * number is on the choice, and what the minutes do to the calendar is drawn.
 * What is saved is unchanged: null follows the business, a number is the
 * service's own, and nought means none.
 */
export const BufferChoice = ({
  id,
  durationMinutes,
  value,
  businessDefault,
  onChange,
  footer,
  colour,
}: {
  id: string;
  durationMinutes: number;
  value: number | null;
  businessDefault: number;
  onChange: (value: number | null) => void;
  /** Where the business default is set, said in the place's own terms. */
  footer?: ReactNode;
  /** The service's own colour from the calendar, for the stretch it fills. */
  colour?: { readonly ground: string; readonly rail: string } | undefined;
}) => {
  const copy = useCopy("owner");
  // The last time of its own, so trying the business's and coming back does
  // not lose what was typed.
  const [ownBefore, setOwnBefore] = useState<number>(value ?? businessDefault);
  const buffer = bufferOf(value, businessDefault);
  const minutes = (n: number) => (n === 0 ? copy.bufferNone : `${n} ${copy.minutesShort}`);

  return (
    <div className="buffer-choice" role="group" aria-labelledby={`${id}-label`}>
      <span id={`${id}-label`} className="buffer-label">
        {copy.buffer}
      </span>
      <div className="buffer-options">
        <button
          type="button"
          aria-pressed={buffer.follows}
          onClick={() => {
            if (value !== null) setOwnBefore(value);
            onChange(null);
          }}
        >
          {copy.bufferFollows}
          <small>{minutes(businessDefault)}</small>
        </button>
        <button type="button" aria-pressed={!buffer.follows} onClick={() => onChange(value ?? ownBefore)}>
          {copy.bufferOwn}
          <small>{copy.bufferOwnSub}</small>
        </button>
      </div>
      {!buffer.follows && (
        <NumberField
          id={id}
          label={`${copy.buffer} (${copy.minutesShort})`}
          hint={copy.bufferOwnHint}
          value={value}
          fallback={0}
          onValue={(next) => onChange(next ?? 0)}
        />
      )}
      {/* What the calendar keeps, drawn to scale: the service, then its recovery. */}
      <div
        className="buffer-track"
        aria-hidden="true"
        style={colour === undefined ? undefined : ({ "--track-ground": colour.ground, "--track-rail": colour.rail } as CSSProperties)}
      >
        <span className="service" style={{ flexGrow: durationMinutes }}>
          {durationMinutes}
        </span>
        {buffer.minutes > 0 && (
          <span className="recovery" style={{ flexGrow: buffer.minutes }}>
            {buffer.minutes}
          </span>
        )}
      </div>
      <p className="buffer-sum">
        {buffer.minutes === 0
          ? fillText(copy.bufferCalendarNone, { service: String(durationMinutes) })
          : fillText(copy.bufferCalendar, {
              total: String(durationMinutes + buffer.minutes),
              service: String(durationMinutes),
            })}
      </p>
      {footer}
    </div>
  );
};

/** The time a service keeps, as its row in a list says it. */
export const BufferPill = ({ value, businessDefault }: { value: number | null; businessDefault: number }) => {
  const copy = useCopy("owner");
  const buffer = bufferOf(value, businessDefault);
  if (buffer.minutes === 0) return null;
  return (
    <span className={`buffer-pill${buffer.follows ? "" : " own"}`}>
      {fillText(buffer.follows ? copy.bufferPillBusiness : copy.bufferPill, { n: String(buffer.minutes) })}
    </span>
  );
};
