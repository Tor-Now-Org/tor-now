import qrcode from "qrcode-generator";

/**
 * A QR code for a business's page, with room in the middle for the logo.
 *
 * Made at the highest error correction (H), which survives about 30% of the
 * code being unreadable. The logo covers far less than that — a square a fifth
 * of the code's side, so about 4% of it — and the modules under it are left
 * light rather than drawn and covered, so a scanner sees a clean hole instead
 * of half a module peeking out from behind the picture.
 */

/** The logo's share of the code's side. */
export const LOGO_SHARE = 0.2;

/** Light modules around a code, which a scanner needs to find its edge. */
export const QUIET_ZONE = 4;

export type QrMatrix = {
  /** Modules per side. */
  readonly size: number;
  readonly dark: (row: number, column: number) => boolean;
  /** The modules the logo sits on, inclusive, the same along both axes. */
  readonly hole: { readonly from: number; readonly to: number };
};

/** The modules a centred square of `share` of the side covers. */
export const holeOf = (size: number, share: number): { from: number; to: number } => {
  const span = Math.max(1, Math.ceil(size * share));
  // Kept odd so it centres on the middle module exactly.
  const odd = span % 2 === 1 ? span : span + 1;
  const from = Math.floor((size - odd) / 2);
  return { from, to: from + odd - 1 };
};

export const qrMatrix = (text: string, share: number = LOGO_SHARE): QrMatrix => {
  const code = qrcode(0, "H");
  code.addData(text, "Byte");
  code.make();
  const size = code.getModuleCount();
  const hole = holeOf(size, share);
  const inHole = (row: number, column: number) =>
    share > 0 && row >= hole.from && row <= hole.to && column >= hole.from && column <= hole.to;
  return {
    size,
    hole,
    dark: (row, column) => !inHole(row, column) && code.isDark(row, column),
  };
};

/**
 * The code as one SVG path, a square per dark module, in module units with the
 * quiet zone around it — for drawing in the page, where it scales with no blur.
 */
export const qrPath = (matrix: QrMatrix): string => {
  const parts: string[] = [];
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.dark(row, column)) parts.push(`M${column + QUIET_ZONE} ${row + QUIET_ZONE}h1v1h-1z`);
    }
  }
  return parts.join("");
};
