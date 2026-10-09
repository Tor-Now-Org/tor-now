import jsQR from "jsqr";
import { describe, expect, it } from "vitest";
import { holeOf, LOGO_SHARE, QUIET_ZONE, qrMatrix, qrPath, type QrMatrix } from "./qr.ts";

/** The code as a scanner sees it: light paper, dark modules, the quiet zone around. */
const pixelsOf = (matrix: QrMatrix, scale = 6) => {
  const side = (matrix.size + QUIET_ZONE * 2) * scale;
  const data = new Uint8ClampedArray(side * side * 4).fill(255);
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (!matrix.dark(row, column)) continue;
      for (let y = 0; y < scale; y += 1) {
        for (let x = 0; x < scale; x += 1) {
          const at = (((row + QUIET_ZONE) * scale + y) * side + (column + QUIET_ZONE) * scale + x) * 4;
          data[at] = 0;
          data[at + 1] = 0;
          data[at + 2] = 0;
        }
      }
    }
  }
  return { data, side };
};

const read = (matrix: QrMatrix): string | null => {
  const { data, side } = pixelsOf(matrix);
  return jsQR(data, side, side)?.data ?? null;
};

const ID = "3f2b8c1e-4d5a-4e6f-9a7b-8c9d0e1f2a3b";

describe("the business's QR code", () => {
  it.each([
    ["a local address", `http://localhost:3100/business/${ID}`],
    ["the live address", `https://tor-panuy.vercel.app/business/${ID}`],
    ["a long preview address", `https://tor-now-web-git-dev-some-team-name.vercel.app/business/${ID}`],
    ["a short one", "https://t.co/b/1"],
  ])("still scans with the middle cleared for the logo: %s", (_name, url) => {
    expect(read(qrMatrix(url))).toBe(url);
  });

  it("clears the middle, and only the middle", () => {
    const matrix = qrMatrix(`https://tor-panuy.vercel.app/business/${ID}`);
    const { from, to } = matrix.hole;
    for (let row = from; row <= to; row += 1) {
      for (let column = from; column <= to; column += 1) {
        expect(matrix.dark(row, column)).toBe(false);
      }
    }
    // The same code without a hole has dark modules there: something really was cleared.
    const whole = qrMatrix(`https://tor-panuy.vercel.app/business/${ID}`, 0);
    let covered = 0;
    for (let row = from; row <= to; row += 1) {
      for (let column = from; column <= to; column += 1) {
        if (whole.dark(row, column)) covered += 1;
      }
    }
    expect(covered).toBeGreaterThan(0);
    // And outside the hole the two codes are the same module for module.
    for (let row = 0; row < matrix.size; row += 1) {
      for (let column = 0; column < matrix.size; column += 1) {
        const inHole = row >= from && row <= to && column >= from && column <= to;
        if (!inHole) expect(matrix.dark(row, column)).toBe(whole.dark(row, column));
      }
    }
  });

  it("keeps the cleared square well inside what high error correction recovers", () => {
    const matrix = qrMatrix(`https://tor-panuy.vercel.app/business/${ID}`);
    const side = matrix.hole.to - matrix.hole.from + 1;
    expect((side * side) / (matrix.size * matrix.size)).toBeLessThan(0.08);
    expect(LOGO_SHARE).toBeLessThanOrEqual(0.25);
  });

  it("centres the hole on the middle module, whatever the size", () => {
    for (const size of [21, 25, 49, 57, 177]) {
      const { from, to } = holeOf(size, LOGO_SHARE);
      expect((to - from + 1) % 2).toBe(1);
      expect(from + to).toBe(size - 1);
      expect(from).toBeGreaterThan(7); // clear of the finder patterns and their separators
    }
  });

  it("draws a dark square for each dark module, offset by the quiet zone", () => {
    const matrix = qrMatrix("hello");
    const path = qrPath(matrix);
    let dark = 0;
    for (let row = 0; row < matrix.size; row += 1) {
      for (let column = 0; column < matrix.size; column += 1) if (matrix.dark(row, column)) dark += 1;
    }
    expect(path.match(/M/g)?.length).toBe(dark);
    // The top-left finder pattern's corner is the first module drawn.
    expect(path.startsWith(`M${QUIET_ZONE} ${QUIET_ZONE}h1v1h-1z`)).toBe(true);
  });
});
