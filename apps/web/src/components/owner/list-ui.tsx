"use client";

import type { CSSProperties, ReactNode } from "react";

/**
 * The one list design the business's lists share — services, calendars, team
 * and customers. A header with the count and the way to add; one card of rows;
 * each row a mark, a name, one line under it, a tag where there is something
 * to say, and a chevron when it opens. What used to be buttons on every row is
 * in the sheet a row opens, once, for the row that was tapped.
 */

export const ListHead = ({
  id,
  title,
  count,
  countLabel,
  action,
}: {
  id: string;
  title: string;
  count?: number | undefined;
  /** "שירותים: 5", for a screen reader that hears the number alone otherwise. */
  countLabel?: string | undefined;
  action?: { label: string; onClick: () => void } | undefined;
}) => (
  <div className="list-head">
    <h2 id={id}>
      {title}
      {count !== undefined && (
        <span className="list-count" aria-label={countLabel}>
          {count}
        </span>
      )}
    </h2>
    {action !== undefined && (
      <button type="button" className="list-add" onClick={action.onClick}>
        <PlusMark />
        {action.label}
      </button>
    )}
  </div>
);

export const ListCard = ({ labelledBy, children }: { labelledBy: string; children: ReactNode }) => (
  <ul className="list-card" aria-labelledby={labelledBy}>
    {children}
  </ul>
);

/** A letter or a month the rows under it share: a heading for the eye, not a row. */
export const ListDivider = ({ text }: { text: string }) => (
  <li className="list-divider" aria-hidden="true">
    {text}
  </li>
);

export const ListRow = ({
  title,
  titleExtra,
  line,
  leading,
  tags,
  rail,
  muted = false,
  onClick,
  label,
  dataId,
  tone,
}: {
  title: string;
  /** Beside the name: "את/ה" on your own row. */
  titleExtra?: ReactNode;
  line?: ReactNode;
  /** The mark before the name: a calendar's colour, a person's initial. */
  leading?: ReactNode;
  tags?: ReactNode;
  /** A service's colour, drawn as the row's edge the way its appointments are. */
  rail?: string | undefined;
  /** Hidden from customers: the row recedes, and its tag says why. */
  muted?: boolean;
  /** Absent for a row that opens nothing — your own, say. */
  onClick?: (() => void) | undefined;
  label?: string | undefined;
  dataId?: string | undefined;
  /** The one row that takes something away, in the colour that says so. */
  tone?: "danger" | undefined;
}) => {
  const style = rail === undefined ? undefined : ({ "--rail": rail } as CSSProperties);
  const className = `list-row${rail === undefined ? "" : " railed"}${muted ? " muted" : ""}${tone === "danger" ? " danger" : ""}`;
  const body = (
    <>
      {leading !== undefined && <span className="list-lead">{leading}</span>}
      <span className="list-text">
        <span className="list-title">
          <span>{title}</span>
          {titleExtra}
        </span>
        {line !== undefined && line !== null && <span className="list-line">{line}</span>}
      </span>
      {tags !== undefined && <span className="list-tags">{tags}</span>}
      {onClick !== undefined && <Chevron />}
    </>
  );
  return (
    <li data-id={dataId}>
      {onClick === undefined ? (
        <div className={className} style={style}>
          {body}
        </div>
      ) : (
        <button type="button" className={className} style={style} onClick={onClick} aria-label={label}>
          {body}
        </button>
      )}
    </li>
  );
};

export const ListTag = ({ text, tone = "neutral" }: { text: string; tone?: "neutral" | "caution" | "critical" }) => (
  <span className={`list-tag ${tone}`}>{text}</span>
);

/** A person's first letter, the way the header's account circle draws it. */
export const Initial = ({ name, pending = false, size }: { name: string; pending?: boolean; size?: "big" }) => (
  <span className={`list-initial${pending ? " pending" : ""}${size === "big" ? " big" : ""}`} aria-hidden="true">
    {name.trim().charAt(0) || "?"}
  </span>
);

/** Who or what a sheet is about, said the way its row said it. */
export const SheetIdentity = ({
  id,
  title,
  line,
  leading,
  rail,
}: {
  id: string;
  title: string;
  line?: ReactNode;
  leading?: ReactNode;
  rail?: string | undefined;
}) => (
  <div
    className={`sheet-identity${rail === undefined ? "" : " railed"}`}
    style={rail === undefined ? undefined : ({ "--rail": rail } as CSSProperties)}
  >
    {leading}
    <span className="list-text">
      <h2 id={id}>{title}</h2>
      {line !== undefined && <span className="list-line">{line}</span>}
    </span>
  </div>
);

export const SheetRows = ({ children }: { children: ReactNode }) => <div className="sheet-rows">{children}</div>;

/** One thing to do in a sheet: what it is, what it is now, and that it opens. */
export const SheetRow = ({
  label,
  value,
  onClick,
}: {
  label: string;
  value?: string | undefined;
  onClick: () => void;
}) => (
  <button type="button" className="sheet-row" onClick={onClick}>
    <span className="sheet-row-label">{label}</span>
    {value !== undefined && <span className="sheet-row-value">{value}</span>}
    <Chevron />
  </button>
);

/** On or off, said as a switch: the standing of a service or a calendar. */
export const ToggleRow = ({
  id,
  label,
  hint,
  checked,
  disabled = false,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string | undefined;
  checked: boolean;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}) => (
  <div className="sheet-row toggle-row">
    <span className="sheet-row-label">
      <label htmlFor={id}>{label}</label>
      {hint !== undefined && <small id={`${id}-hint`}>{hint}</small>}
    </span>
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-describedby={hint === undefined ? undefined : `${id}-hint`}
      disabled={disabled}
      className="toggle"
      onClick={() => onChange(!checked)}
    >
      <span aria-hidden="true" />
    </button>
  </div>
);

/** The one action that takes something away: last, apart, and asking first. */
export const DangerRow = ({ label, onClick }: { label: string; onClick: () => void }) => (
  <button type="button" className="danger-row" onClick={onClick}>
    {label}
  </button>
);

/** Points the way the reader goes: left in Hebrew, right in English. */
export const Chevron = () => (
  <svg className="list-chevron" width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="m9 6 6 6-6 6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

const PlusMark = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />
  </svg>
);
