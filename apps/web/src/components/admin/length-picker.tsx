"use client";

import { endsAfter, GRANT_LENGTHS } from "@/lib/grant-length.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { Chip, Field } from "@/components/ui.tsx";

/**
 * How long something runs, as the Catalogue editor asks it: a month, two or
 * three, or a day of the administrator's own. Grants and Previews both ask it.
 */
export type Length = { readonly kind: "days"; readonly days: number } | { readonly kind: "date"; readonly date: string };

/** The last day a length gives, counted from `from`. */
export const lastDayOf = (length: Length, from: string): string =>
  length.kind === "days" ? endsAfter(from, length.days) : length.date;

export const LengthPicker = ({
  id,
  label,
  length,
  from,
  onChange,
  hint,
}: {
  id: string;
  label: string;
  length: Length;
  /** The day lengths count from: today for something new, its end for an extension. */
  from: string;
  onChange: (length: Length) => void;
  hint: string;
}) => {
  const words = useCopy("catalogue");
  return (
    <>
      <span className="label">{label}</span>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }} role="group" aria-label={label}>
        {GRANT_LENGTHS.map((days) => (
          <Chip
            key={days}
            selected={length.kind === "days" && length.days === days}
            onClick={() => onChange({ kind: "days", days })}
            style={{ minHeight: 38, padding: "0 13px", fontSize: 13 }}
          >
            {fillText(words.days, { n: String(days) })}
          </Chip>
        ))}
        <Chip
          selected={length.kind === "date"}
          onClick={() => onChange({ kind: "date", date: lastDayOf(length, from) })}
          style={{ minHeight: 38, padding: "0 13px", fontSize: 13 }}
        >
          {words.otherDate}
        </Chip>
      </div>
      {length.kind === "date" && (
        <Field
          id={id}
          type="date"
          label={words.endsOn}
          value={length.date}
          onChange={(event) => onChange({ kind: "date", date: event.target.value })}
        />
      )}
      <span className="hint" style={{ marginTop: -6 }}>
        {hint}
      </span>
    </>
  );
};

