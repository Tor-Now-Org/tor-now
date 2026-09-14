"use client";

import { laneColourOf } from "./event-colour.ts";

/**
 * Which calendar something belongs to, as a coloured initial.
 *
 * The colour comes from the calendar's position in the business's own list, so
 * the same chair is the same colour on the timeline, in the scope chip and in
 * the booking sheet. Decorative on its own — every place that draws one puts
 * the name beside it — so it is hidden from anybody being read to.
 */
export const Mark = ({
  name,
  index,
  size = 18,
}: {
  name: string;
  index: number;
  size?: number;
}) => (
  <span
    aria-hidden="true"
    style={{
      width: size,
      height: size,
      borderRadius: 999,
      flexShrink: 0,
      display: "grid",
      placeItems: "center",
      fontSize: size * 0.53,
      fontWeight: 600,
      fontFamily: "Rubik, sans-serif",
      background: laneColourOf(index),
      color: "var(--on-accent)",
    }}
  >
    {name.slice(0, 1)}
  </span>
);
