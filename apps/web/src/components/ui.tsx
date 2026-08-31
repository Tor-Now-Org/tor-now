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

export const Field = ({
  label,
  hint,
  id,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) => (
  <label htmlFor={id} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
    <span className="label">{label}</span>
    <input {...rest} id={id} className="field" />
    {hint !== undefined && <span className="hint">{hint}</span>}
  </label>
);

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
