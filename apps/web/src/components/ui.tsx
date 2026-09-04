"use client";

import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

/**
 * The canvas defines one button system: weight, depth and a real pressed state,
 * in three intents. These are those three, not a general-purpose button with a
 * dozen props — a component that can look like anything is a design system that
 * decides nothing.
 */
type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  intent?: "primary" | "quiet" | "danger";
  busy?: boolean;
};

export const Button = ({
  intent = "primary",
  busy = false,
  children,
  disabled,
  ...rest
}: ButtonProps) => (
  <button
    {...rest}
    className={intent}
    disabled={disabled === true || busy}
    aria-busy={busy}
  >
    {busy ? <span className="spinner" /> : children}
  </button>
);

export const Chip = ({
  selected = false,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { selected?: boolean }) => (
  <button
    {...rest}
    className="chip"
    aria-pressed={selected}
    style={{
      background: selected ? "var(--accent)" : "var(--raised)",
      color: selected ? "var(--on-accent)" : "var(--ink)",
      border: `1px solid ${selected ? "var(--accent)" : "var(--line)"}`,
      ...rest.style,
    }}
  >
    {children}
  </button>
);

export const Card = ({
  children,
  padded = true,
  ...rest
}: { children: ReactNode; padded?: boolean } & React.HTMLAttributes<HTMLDivElement>) => (
  <div {...rest} className="card" style={{ padding: padded ? 16 : 0, ...rest.style }}>
    {children}
  </div>
);

/**
 * A labelled input that can say what is wrong with it.
 *
 * The problem is shown under the field rather than collected at the top of the
 * form, because that is where the answer has to change, and it is tied to the
 * input by aria-describedby so it is announced rather than merely drawn. It
 * replaces the hint while it is showing: two lines of small grey text competing
 * under one field help nobody.
 */
export const Field = ({
  label,
  hint,
  problem,
  id,
  required = false,
  startAdornment,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  hint?: string;
  /** Already in the reader's language; see lib/i18n/field-problems.ts. */
  problem?: string | null;
  required?: boolean;
  /** Fixed content shown at the input's start, e.g. a country flag. */
  startAdornment?: ReactNode;
}) => {
  const wrong = problem !== undefined && problem !== null;
  const describedBy = wrong ? `${id ?? ""}-problem` : undefined;
  const input = (
    <input
      {...rest}
      id={id}
      className="field"
      aria-invalid={wrong ? true : undefined}
      aria-describedby={describedBy}
      style={{
        ...(startAdornment !== undefined && { paddingLeft: 92 }),
        ...rest.style,
        ...(wrong && { borderColor: "var(--critical)" }),
      }}
    />
  );
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="label">
        {label}
        {required && <span aria-hidden="true"> *</span>}
      </span>
      {startAdornment !== undefined ? (
        <span style={{ position: "relative" }}>
          <span
            aria-hidden="true"
            dir="ltr"
            style={{
              position: "absolute",
              left: 12,
              top: "50%",
              transform: "translateY(-50%)",
              display: "inline-flex",
              alignItems: "center",
              gap: 10,
              fontSize: 15,
              lineHeight: 1,
              whiteSpace: "nowrap",
              color: "var(--muted, #666)",
            }}
          >
            {startAdornment}
          </span>
          {input}
        </span>
      ) : (
        input
      )}
      {wrong ? (
        <span
          id={describedBy}
          style={{ fontSize: 12, color: "var(--critical)", lineHeight: 1.5 }}
        >
          {problem}
        </span>
      ) : (
        hint !== undefined && <span className="hint">{hint}</span>
      )}
    </label>
  );
};

/**
 * The same field, for text that runs to more than a line.
 *
 * It shares Field's label, hint and problem behaviour deliberately — a form
 * where the long answer is validated differently from the short ones teaches
 * the reader two rules instead of one.
 */
export const MultilineField = ({
  label,
  hint,
  problem,
  id,
  rows = 3,
  ...rest
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string;
  hint?: string;
  /** Already in the reader's language; see lib/i18n/field-problems.ts. */
  problem?: string | null;
}) => {
  const wrong = problem !== undefined && problem !== null;
  const describedBy = wrong ? `${id ?? ""}-problem` : undefined;
  return (
    <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span className="label">{label}</span>
      <textarea
        {...rest}
        id={id}
        rows={rows}
        className="field multiline"
        aria-invalid={wrong ? true : undefined}
        aria-describedby={describedBy}
        style={{ ...rest.style, ...(wrong && { borderColor: "var(--critical)" }) }}
      />
      {wrong ? (
        <span
          id={describedBy}
          style={{ fontSize: 12, color: "var(--critical)", lineHeight: 1.5 }}
        >
          {problem}
        </span>
      ) : (
        hint !== undefined && <span className="hint">{hint}</span>
      )}
    </label>
  );
};

export const Select = ({
  label,
  children,
  id,
  ...rest
}: React.SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
  children: ReactNode;
}) => (
  <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <span className="label">{label}</span>
    <select {...rest} id={id} className="field">
      {children}
    </select>
  </label>
);

export const Note = ({ children }: { children: ReactNode }) => (
  <p className="note" style={{ margin: 0 }}>
    {children}
  </p>
);

export const Warning = ({ children }: { children: ReactNode }) => (
  <p className="warn" style={{ margin: 0 }} role="status">
    {children}
  </p>
);

export const Critical = ({ children }: { children: ReactNode }) => (
  <p className="crit" style={{ margin: 0 }} role="alert">
    {children}
  </p>
);

export const Section = ({
  title,
  children,
  action,
}: {
  title?: string;
  children: ReactNode;
  action?: ReactNode;
}) => (
  <section style={{ display: "flex", flexDirection: "column", gap: 12 }}>
    {(title !== undefined || action !== undefined) && (
      <header style={{ display: "flex", alignItems: "center", gap: 10 }}>
        {title !== undefined && (
          <h2 style={{ fontSize: 16, flex: 1 }}>{title}</h2>
        )}
        {action}
      </header>
    )}
    {children}
  </section>
);

export const Empty = ({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) => (
  <div
    style={{
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      gap: 10,
      padding: "40px 20px",
      border: "1px dashed var(--line)",
      borderRadius: 18,
      textAlign: "center",
    }}
  >
    <p style={{ margin: 0, fontFamily: "Rubik, sans-serif", fontSize: 19 }}>
      {title}
    </p>
    {body !== undefined && (
      <p className="hint" style={{ margin: 0 }}>
        {body}
      </p>
    )}
    {action}
  </div>
);

export const Sheet = ({
  open,
  onClose,
  children,
  labelledBy,
}: {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  labelledBy?: string;
}) => {
  if (!open) return null;
  return (
    <div
      className="sheet-backdrop"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        {...(labelledBy === undefined ? {} : { "aria-labelledby": labelledBy })}
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
};

export const Spinner = () => (
  <div style={{ display: "grid", placeItems: "center", padding: 40 }}>
    <span className="spinner" />
  </div>
);

export const Rows = ({ children }: { children: ReactNode }) => (
  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
    {children}
  </div>
);

/**
 * A small pill that names a state.
 *
 * Shared rather than owned by one screen: an appointment's outcome and a
 * service's standing are the same idea to a reader — a word that says what this
 * row is, in a colour that says how much to worry about it.
 */
const TONES: Readonly<
  Record<string, { background: string; border: string; color: string }>
> = Object.freeze({
  positive: {
    background: "var(--positive-soft)",
    border: "1px solid oklch(58% 0.115 214/.28)",
    color: "var(--positive)",
  },
  caution: {
    background: "var(--caution-soft)",
    border: "1px solid oklch(63% 0.125 65/.3)",
    color: "var(--caution)",
  },
  critical: {
    background: "var(--critical-soft)",
    border: "1px solid oklch(55% 0.170 22/.25)",
    color: "var(--critical)",
  },
  neutral: {
    background: "var(--sunken)",
    border: "1px solid var(--line)",
    color: "var(--muted)",
  },
});

export const Tag = ({
  text,
  tone,
}: {
  text: string;
  tone: "caution" | "critical" | "neutral" | "positive";
}) => (
  <span
    style={{
      display: "inline-flex",
      padding: "4px 11px",
      borderRadius: 999,
      fontSize: 11.5,
      fontWeight: 500,
      whiteSpace: "nowrap",
      ...TONES[tone],
    }}
  >
    {text}
  </span>
);

