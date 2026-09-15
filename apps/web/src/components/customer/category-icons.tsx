import { categoryGroup, type BusinessCategory, type CategoryGroup } from "@tor-now/domain";
import type { ReactNode } from "react";

/**
 * ponytail: one icon per group, not per Category — nine drawings instead of
 * eighty-six. Give a Category its own when the strip shows two that look alike.
 */
const GROUP_PATHS: Readonly<Record<CategoryGroup, ReactNode>> = {
  hair: (
    <>
      <circle cx="6" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M8.2 7.8 20 19.5M8.2 16.2 20 4.5" />
    </>
  ),
  beauty: (
    <>
      <rect x="7" y="10" width="10" height="11" rx="2.5" />
      <path d="M10 10V4.5a2 2 0 0 1 4 0V10" />
    </>
  ),
  wellness: <path d="M5 19C5 10 11 4.5 20 4.5 20 13 14.5 19 5 19ZM5 19l8.5-8.5" />,
  health: (
    <>
      <rect x="4" y="4" width="16" height="16" rx="4" />
      <path d="M12 8.5v7M8.5 12h7" />
    </>
  ),
  pets: (
    <>
      <circle cx="6.5" cy="9" r="1.8" />
      <circle cx="10" cy="5.5" r="1.8" />
      <circle cx="14" cy="5.5" r="1.8" />
      <circle cx="17.5" cy="9" r="1.8" />
      <path d="M12 11c-3 0-5.5 3.8-5.5 6.3 0 1.8 1.5 2.4 2.8 1.7 1-.5 1.7-.8 2.7-.8s1.7.3 2.7.8c1.3.7 2.8.1 2.8-1.7C17.5 14.8 15 11 12 11Z" />
    </>
  ),
  lessons: <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5Zm0 15V5.5M8 7.5h8" />,
  professional: (
    <>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M3 13h18" />
    </>
  ),
  repairs: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4l-5.8 5.8a1.5 1.5 0 0 0 2 2l5.8-5.8a4 4 0 0 0 5.4-5.4l-2.5 2.5-2-.5-.5-2Z" />,
  spaces: <path d="M4 20V8l8-4 8 4v12M9 20v-6h6v6" />,
};

const Glyph = ({ size, children }: { size: number; children: ReactNode }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    style={{ display: "block", flexShrink: 0 }}
  >
    {children}
  </svg>
);

export const CategoryIcon = ({ category, size = 15 }: { category: BusinessCategory; size?: number }) => (
  <Glyph size={size}>{GROUP_PATHS[categoryGroup(category)]}</Glyph>
);

export const AllCategoriesIcon = ({ size = 15 }: { size?: number }) => (
  <Glyph size={size}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.5" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.5" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.5" />
  </Glyph>
);
