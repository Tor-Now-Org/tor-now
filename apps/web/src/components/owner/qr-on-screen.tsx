"use client";

import { LOGO_DATA_URL } from "./qr-card.ts";
import { QUIET_ZONE, qrMatrix, qrPath } from "./qr.ts";

/**
 * The business's code drawn in the page, for somebody to scan off the screen:
 * the same code as the printed card, the logo in the cleared middle, and
 * vector, so it is sharp at any size.
 */
export const QrOnScreen = ({ url, label }: { url: string; label: string }) => {
  const matrix = qrMatrix(url);
  const side = matrix.size + QUIET_ZONE * 2;
  const hole = matrix.hole.to - matrix.hole.from + 1;
  const at = matrix.hole.from + QUIET_ZONE;
  const inset = 0.4;
  return (
    <svg className="qr-on-screen" viewBox={`0 0 ${side} ${side}`} role="img" aria-label={label} shapeRendering="crispEdges">
      <rect width={side} height={side} fill="#fff" />
      <path d={qrPath(matrix)} fill="#0A2450" />
      <image href={LOGO_DATA_URL} x={at + inset} y={at + inset} width={hole - inset * 2} height={hole - inset * 2} />
    </svg>
  );
};
