import type { Language } from "@/lib/i18n/dictionaries.ts";
import { QUIET_ZONE, qrMatrix } from "./qr.ts";

/**
 * The card a business prints and stands by the till: the brand, the code with
 * the logo in it, the business's name under it, and three steps for anybody
 * who has never scanned one. A6 at 300 dots per inch.
 *
 * The layout is worked out here as numbers, apart from the canvas, so that what
 * decides where a long name breaks can be tested without one.
 */

export const CARD = Object.freeze({ width: 1240, height: 1748 });

const NAVY = "#0A2450";
const CYAN = "#22BFD4";
const INK = "#0A2450";
const MUTED = "#5B6B82";
const PAPER = "#FFFFFF";
const SUNKEN = "#EEF3F8";

const SIDE = 96;
const BAND = 290;
const QR_TOP = BAND + 56;
const QR_SPACE = 740;
const NAME_SIZES = [92, 80, 68, 58] as const;
const NAME_LINE = 1.15;
const KIND_SIZE = 40;
const FALLBACK_BAND = 112;

export type CardWords = {
  readonly lead: string;
  readonly trail: string;
  readonly tagline: string;
  readonly steps: readonly [string, string, string];
  readonly fallback: string;
};

export type CardInput = {
  readonly url: string;
  readonly name: string;
  /** The main category and the address, as one line under the name. */
  readonly kind: string;
  readonly language: Language;
  readonly words: CardWords;
};

export type Measure = (text: string) => number;

/**
 * A text broken into at most `maxLines` lines no wider than `maxWidth`, by
 * words; a word wider than a line on its own is cut by letters, and whatever
 * still does not fit ends the last line with an ellipsis.
 */
export const linesFor = (text: string, maxWidth: number, measure: Measure, maxLines: number): string[] => {
  const words = text.trim().split(/\s+/).filter((word) => word.length > 0);
  if (words.length === 0 || maxLines < 1) return [];

  const pieces = words.flatMap((word) => {
    if (measure(word) <= maxWidth) return [word];
    // A single word too long for a line is broken where it has to be.
    const cut: string[] = [];
    let current = "";
    for (const letter of Array.from(word)) {
      if (current !== "" && measure(current + letter) > maxWidth) {
        cut.push(current);
        current = letter;
      } else {
        current += letter;
      }
    }
    return current === "" ? cut : [...cut, current];
  });

  const lines: string[] = [];
  let line = "";
  pieces.forEach((piece) => {
    const joined = line === "" ? piece : `${line} ${piece}`;
    if (line !== "" && measure(joined) > maxWidth) {
      lines.push(line);
      line = piece;
    } else {
      line = joined;
    }
  });
  if (line !== "") lines.push(line);

  if (lines.length <= maxLines) return lines;
  const kept = lines.slice(0, maxLines);
  let last = `${kept[maxLines - 1] ?? ""}…`;
  while (measure(last) > maxWidth && last.length > 1) last = `${last.slice(0, -2)}…`;
  return [...kept.slice(0, -1), last];
};

/**
 * The largest name size that fits in two lines without cutting; the smallest
 * size, cut, when none does. A short name is set large and on one line.
 */
export const nameSetting = (
  name: string,
  maxWidth: number,
  measureAt: (size: number) => Measure,
): { size: number; lines: string[] } => {
  for (const size of NAME_SIZES) {
    const measure = measureAt(size);
    const lines = linesFor(name, maxWidth, measure, Number.POSITIVE_INFINITY);
    if (lines.length === 1 || (lines.length === 2 && size <= (NAME_SIZES[1] ?? size))) return { size, lines };
  }
  const smallest = NAME_SIZES.at(-1) ?? 58;
  return { size: smallest, lines: linesFor(name, maxWidth, measureAt(smallest), 2) };
};

/** The mark, as the app's icon draws it, for the canvas to load as a picture. */
const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="256" height="256" fill="none">
<path d="M11 2.6v3.2M18.5 2.6v3.2" stroke="#0A2450" stroke-width="2.6" stroke-linecap="round"/>
<rect x="3.4" y="5.2" width="21" height="19.6" rx="4.6" fill="#fff" stroke="#0A2450" stroke-width="2.2"/>
<path d="M4 11.4h19.8" stroke="#0A2450" stroke-width="1.7"/>
<rect x="7.4" y="14.4" width="6.6" height="6.6" rx="2.1" fill="#22BFD4"/>
<path d="M9.1 17.6l1.4 1.4 2.3-2.7" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="23.2" cy="22.2" r="7.4" fill="#fff"/>
<circle cx="23.2" cy="22.2" r="6.1" stroke="#1470AA" stroke-width="2.2"/>
<path d="M23.2 18.6v3.6l2.5 1.6" stroke="#0A2450" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export const LOGO_DATA_URL = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(LOGO_SVG)}`;

const loadLogo = async (): Promise<HTMLImageElement> => {
  const image = new Image();
  image.src = LOGO_DATA_URL;
  await image.decode();
  return image;
};

const roundedRect = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
  ctx.fill();
};

type Fonts = { readonly display: string; readonly body: string };

const drawBand = (ctx: CanvasRenderingContext2D, card: CardInput, logo: HTMLImageElement, fonts: Fonts) => {
  const { width } = CARD;
  ctx.fillStyle = NAVY;
  ctx.fillRect(0, 0, width, BAND);

  const tile = 104;
  const gap = 26;
  ctx.font = `700 76px ${fonts.display}`;
  const lead = ctx.measureText(card.words.lead).width;
  const space = ctx.measureText(" ").width;
  const trail = ctx.measureText(card.words.trail).width;
  const total = tile + gap + lead + space + trail;
  const rtl = card.language === "he";
  const start = (width - total) / 2;
  const middle = 112;

  // In reading order: the mark, then the two words — from the right in Hebrew.
  const tileX = rtl ? start + total - tile : start;
  ctx.fillStyle = PAPER;
  roundedRect(ctx, tileX, middle - tile / 2, tile, tile, 26);
  ctx.drawImage(logo, tileX + 12, middle - tile / 2 + 12, tile - 24, tile - 24);

  ctx.textBaseline = "middle";
  ctx.direction = "ltr";
  ctx.textAlign = "left";
  const leadX = rtl ? tileX - gap - lead : tileX + tile + gap;
  const trailX = rtl ? leadX - space - trail : leadX + lead + space;
  ctx.fillStyle = PAPER;
  ctx.fillText(card.words.lead, leadX, middle + 4);
  ctx.fillStyle = CYAN;
  ctx.fillText(card.words.trail, trailX, middle + 4);

  ctx.direction = rtl ? "rtl" : "ltr";
  ctx.textAlign = "center";
  ctx.fillStyle = "rgba(255,255,255,0.78)";
  ctx.font = `500 42px ${fonts.body}`;
  ctx.fillText(card.words.tagline, width / 2, 222);
};

const drawCode = (ctx: CanvasRenderingContext2D, card: CardInput, logo: HTMLImageElement): number => {
  const matrix = qrMatrix(card.url);
  const modules = matrix.size + QUIET_ZONE * 2;
  // Whole pixels per module, so no module is blurred across two.
  const unit = Math.floor(QR_SPACE / modules);
  const side = unit * modules;
  const left = Math.round((CARD.width - side) / 2);
  ctx.fillStyle = PAPER;
  ctx.fillRect(left, QR_TOP, side, side);
  ctx.fillStyle = INK;
  for (let row = 0; row < matrix.size; row += 1) {
    for (let column = 0; column < matrix.size; column += 1) {
      if (matrix.dark(row, column)) {
        ctx.fillRect(left + (column + QUIET_ZONE) * unit, QR_TOP + (row + QUIET_ZONE) * unit, unit, unit);
      }
    }
  }
  const hole = (matrix.hole.to - matrix.hole.from + 1) * unit;
  const holeX = left + (matrix.hole.from + QUIET_ZONE) * unit;
  const holeY = QR_TOP + (matrix.hole.from + QUIET_ZONE) * unit;
  const inset = Math.round(unit * 0.4);
  ctx.drawImage(logo, holeX + inset, holeY + inset, hole - inset * 2, hole - inset * 2);
  return QR_TOP + side;
};

const drawSteps = (ctx: CanvasRenderingContext2D, card: CardInput, top: number, fonts: Fonts) => {
  const columns = 3;
  const inner = CARD.width - SIDE * 2;
  const each = inner / columns;
  const rtl = card.language === "he";
  card.words.steps.forEach((label, index) => {
    // The first step sits where reading starts: on the right in Hebrew.
    const slot = rtl ? columns - 1 - index : index;
    const centre = SIDE + each * slot + each / 2;
    ctx.fillStyle = CYAN;
    ctx.beginPath();
    ctx.arc(centre, top + 34, 34, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = NAVY;
    ctx.font = `700 38px ${fonts.display}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(index + 1), centre, top + 36);
    ctx.fillStyle = INK;
    ctx.font = `600 36px ${fonts.body}`;
    const [line] = linesFor(label, each - 20, (text) => ctx.measureText(text).width, 1);
    ctx.fillText(line ?? "", centre, top + 114);
  });
};

/**
 * Draws the card onto `canvas`, sized to print. Waits for the page's fonts so
 * the name is not set in a fallback face.
 */
export const drawCard = async (canvas: HTMLCanvasElement, card: CardInput, fonts: Fonts): Promise<void> => {
  canvas.width = CARD.width;
  canvas.height = CARD.height;
  const ctx = canvas.getContext("2d");
  if (ctx === null) throw new Error("This browser cannot draw the card.");
  await document.fonts.ready;
  const logo = await loadLogo();

  ctx.fillStyle = PAPER;
  ctx.fillRect(0, 0, CARD.width, CARD.height);
  drawBand(ctx, card, logo, fonts);
  let y = drawCode(ctx, card, logo) + 40;

  const maxWidth = CARD.width - SIDE * 2;
  ctx.direction = card.language === "he" ? "rtl" : "ltr";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  const name = nameSetting(card.name, maxWidth, (size) => {
    ctx.font = `700 ${size}px ${fonts.display}`;
    return (text) => ctx.measureText(text).width;
  });
  ctx.font = `700 ${name.size}px ${fonts.display}`;
  ctx.fillStyle = INK;
  name.lines.forEach((line) => {
    ctx.fillText(line, CARD.width / 2, y);
    y += name.size * NAME_LINE;
  });

  ctx.font = `400 ${KIND_SIZE}px ${fonts.body}`;
  ctx.fillStyle = MUTED;
  linesFor(card.kind, maxWidth, (text) => ctx.measureText(text).width, 2).forEach((line) => {
    ctx.fillText(line, CARD.width / 2, y + 4);
    y += KIND_SIZE * 1.3;
  });

  // The steps sit in the middle of what is left, so a short name leaves no
  // hole above them and a long one never pushes them onto the bottom band.
  const STEPS_HEIGHT = 150;
  const room = CARD.height - FALLBACK_BAND - y;
  drawSteps(ctx, card, y + Math.max(24, (room - STEPS_HEIGHT) / 2), fonts);

  ctx.fillStyle = SUNKEN;
  ctx.fillRect(0, CARD.height - FALLBACK_BAND, CARD.width, FALLBACK_BAND);
  ctx.fillStyle = MUTED;
  ctx.font = `500 32px ${fonts.body}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.direction = card.language === "he" ? "rtl" : "ltr";
  const [fallback] = linesFor(card.words.fallback, maxWidth, (text) => ctx.measureText(text).width, 1);
  ctx.fillText(fallback ?? "", CARD.width / 2, CARD.height - FALLBACK_BAND / 2);
};

/** The canvas as a PNG file, for saving or sharing. */
export const cardFile = (canvas: HTMLCanvasElement, fileName: string): Promise<File> =>
  new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob === null) reject(new Error("The card could not be made into a picture."));
      else resolve(new File([blob], fileName, { type: "image/png" }));
    }, "image/png");
  });
