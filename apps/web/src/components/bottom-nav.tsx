"use client";

import type { ReactNode } from "react";

/**
 * The canvas makes the bottom navigation read as controls rather than a row of
 * words: the icon sits in a pill that fills when the tab is current.
 */
export type NavItem = {
  readonly id: string;
  readonly label: string;
  readonly icon: ReactNode;
};

export const BottomNav = ({
  items,
  current,
  onSelect,
}: {
  items: readonly NavItem[];
  current: string;
  onSelect: (id: string) => void;
}) => (
  <nav className="bottom-nav" aria-label="Sections">
    {items.map((item) => {
      const active = item.id === current;
      return (
        <button
          key={item.id}
          className={active ? "navbtn on" : "navbtn"}
          onClick={() => onSelect(item.id)}
          aria-current={active ? "page" : undefined}
          style={{ color: active ? "var(--accent-strong)" : "var(--faint)" }}
        >
          <span className="navico">{item.icon}</span>
          <span className="lbl">{item.label}</span>
        </button>
      );
    })}
  </nav>
);

const stroke = { fill: "none", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };

export const SearchIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke} stroke="currentColor">
    <circle cx="11" cy="11" r="7" />
    <path d="m16.5 16.5 4 4" />
  </svg>
);

export const CalendarIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke} stroke="currentColor">
    <rect x="3" y="5" width="18" height="16" rx="3" />
    <path d="M3 10h18M8 3v4M16 3v4" />
  </svg>
);

export const ClockIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke} stroke="currentColor">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const PeopleIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke} stroke="currentColor">
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c.7-3 3-4.6 5.5-4.6S13.8 16 14.5 19" />
    <path d="M16 6.2a3 3 0 0 1 0 5.6M17.5 19c-.3-1.7-1-3-2-3.9" />
  </svg>
);

export const SettingsIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke} stroke="currentColor">
    <circle cx="12" cy="12" r="3" />
    <path d="M12 3v2.2M12 18.8V21M4.2 7.5l1.9 1.1M17.9 15.4l1.9 1.1M4.2 16.5l1.9-1.1M17.9 8.6l1.9-1.1" />
  </svg>
);

export const BuildingIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke} stroke="currentColor">
    <path d="M4 21V6l7-3 7 3v15" />
    <path d="M9 21v-5h6v5M9 9h1.5M13.5 9H15M9 12.5h1.5M13.5 12.5H15" />
  </svg>
);

export const ShieldIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke} stroke="currentColor">
    <path d="M12 3l7 3v6c0 4-3 7.4-7 9-4-1.6-7-5-7-9V6z" />
  </svg>
);

export const ListIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" {...stroke} stroke="currentColor">
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
