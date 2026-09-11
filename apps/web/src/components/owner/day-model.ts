/**
 * The geometry of a day drawn as a timeline.
 *
 * Two rules decide everything here, and both were learned by getting them
 * wrong. Nothing is ever drawn longer than it lasts — an element with a minimum
 * height climbs onto its neighbour, and a ten-minute gap painted twenty-two
 * pixels tall sits on top of the next appointment. And empty time folds rather
 * than scrolls, so a twelve-hour day fits on a phone; a fold is a change to the
 * scale itself, shared by the hour rail and every lane, which is what keeps ten
 * o'clock level across three calendars.
 */

export const MINUTES_IN_A_DAY = 24 * 60;
/** A minute is a pixel, so a twenty-minute appointment is legible as drawn. */
export const PIXELS_PER_MINUTE = 1;
/** What a folded stretch is worth on screen, however long it really is. */
export const FOLD_HEIGHT = 32;
/** Shorter than this and folding costs more than it saves. */
export const FOLD_OVER_MINUTES = 90;
/** Under this a free stretch is a seam between two things, not a box. */
export const BOX_MINIMUM = 18;
/** Under this the box has room for minutes but not for words. */
export const WORDS_MINIMUM = 34;

export type Span = { readonly start: number; readonly end: number };

export const minutesOf = (clock: string): number => {
  const [hour, minute] = clock.split(":").map(Number);
  return (hour ?? 0) * 60 + (minute ?? 0);
};

export const clockOf = (minutes: number): string => {
  const held = Math.max(0, Math.min(MINUTES_IN_A_DAY, Math.round(minutes)));
  const hour = String(Math.floor(held / 60) % 24).padStart(2, "0");
  return `${hour}:${String(held % 60).padStart(2, "0")}`;
};

/** The window the timeline covers: the hours worked, with an hour either side. */
export const windowOf = (
  open: readonly { start: string; end: string }[],
  items: readonly Span[],
): Span => {
  const edges = [
    ...open.flatMap((range) => [minutesOf(range.start), minutesOf(range.end)]),
    ...items.flatMap((item) => [item.start, item.end]),
  ];
  if (edges.length === 0) return { start: 9 * 60, end: 17 * 60 };
  const first = Math.min(...edges);
  const last = Math.max(...edges);
  return {
    start: Math.max(0, Math.floor((first - 60) / 60) * 60),
    end: Math.min(MINUTES_IN_A_DAY, Math.ceil((last + 60) / 60) * 60),
  };
};

/**
 * Stretches where nobody at all is busy.
 *
 * Only these may fold: a fold covers every lane, so folding a stretch where one
 * calendar is free would hide another calendar's appointment behind it.
 */
export const sharedFree = (window: Span, busy: readonly Span[]): Span[] => {
  const ordered = [...busy].sort((left, right) => left.start - right.start);
  const free: Span[] = [];
  let cursor = window.start;
  ordered.forEach((item) => {
    if (item.start > cursor) free.push({ start: cursor, end: item.start });
    cursor = Math.max(cursor, item.end);
  });
  if (cursor < window.end) free.push({ start: cursor, end: window.end });
  return free;
};

export const foldsIn = (
  window: Span,
  busy: readonly Span[],
  opened: readonly number[],
): Span[] =>
  sharedFree(window, busy).filter(
    (gap) => gap.end - gap.start > FOLD_OVER_MINUTES && !opened.includes(gap.start),
  );

/**
 * One mapping from minutes to pixels for the whole screen.
 *
 * Folding is a change to this mapping rather than something done to a column,
 * which is what keeps the rail and every lane agreeing about where ten o'clock
 * is.
 */
export const scaleOf = (window: Span, folds: readonly Span[]) => {
  const ordered = [...folds].sort((left, right) => left.start - right.start);
  const y = (minute: number): number => {
    let pixels = 0;
    let cursor = window.start;
    for (const fold of ordered) {
      if (minute <= fold.start) break;
      pixels += (Math.min(minute, fold.start) - cursor) * PIXELS_PER_MINUTE;
      cursor = Math.min(minute, fold.start);
      const inside = Math.min(minute, fold.end) - fold.start;
      if (inside > 0) {
        pixels += (inside / (fold.end - fold.start)) * FOLD_HEIGHT;
        cursor = Math.min(minute, fold.end);
      }
    }
    return pixels + (minute - cursor) * PIXELS_PER_MINUTE;
  };
  return { y, height: y(window.end), folds: ordered };
};

export const swallowedBy = (folds: readonly Span[], minute: number): boolean =>
  folds.some((fold) => minute > fold.start && minute < fold.end);

export type Band<T> =
  | { readonly kind: "free"; readonly start: number; readonly end: number }
  | { readonly kind: "item"; readonly start: number; readonly end: number; readonly item: T };

/** One lane's contents in order, with the holes between them named. */
export const bandsOf = <T extends Span>(window: Span, items: readonly T[]): Band<T>[] => {
  const ordered = [...items].sort((left, right) => left.start - right.start);
  const out: Band<T>[] = [];
  let cursor = window.start;
  ordered.forEach((item) => {
    if (item.start > cursor) out.push({ kind: "free", start: cursor, end: item.start });
    out.push({ kind: "item", start: item.start, end: item.end, item });
    cursor = Math.max(cursor, item.end);
  });
  if (cursor < window.end) out.push({ kind: "free", start: cursor, end: window.end });
  return out;
};

/**
 * Where a band is drawn.
 *
 * An item keeps its own length, always. Free space is clamped to the next thing
 * along, because a gap drawn taller than it lasts climbs onto its neighbour —
 * and where there is too little room, the caller changes the form rather than
 * the size.
 *
 * Items are deliberately not clamped: two of them can overlap — a blockage
 * across a whole day and the appointments inside it — and clamping made a day
 * off end wherever the next appointment began, which is a plain lie about how
 * long it lasts. Overlap is answered by sharing the width instead, which is
 * what a calendar has always done.
 */
export const placeOf = <T>(
  bands: readonly Band<T>[],
  index: number,
  scale: ReturnType<typeof scaleOf>,
): { readonly top: number; readonly height: number } => {
  const band = bands[index];
  if (band === undefined) return { top: 0, height: 0 };
  const top = scale.y(band.start);
  const wanted = scale.y(band.end) - top - 2;
  if (band.kind === "item") return { top, height: Math.max(wanted, 1) };

  const next = bands[index + 1];
  const until = next === undefined ? scale.height : scale.y(next.start);
  return { top, height: Math.max(Math.min(wanted, until - top - 2), 1) };
};

/**
 * Which column of its lane an item is drawn in.
 *
 * Things that overlap in time share the width between them, so a day off and
 * the appointment inside it are both visible and both the right length. Items
 * that do not overlap anything keep the whole width.
 */
export const columnsOf = <T extends Span>(
  items: readonly T[],
): Map<T, { column: number; columns: number }> => {
  const ordered = [...items].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  );
  const placed = new Map<T, { column: number; columns: number }>();

  let cluster: T[] = [];
  let clusterEnds = -1;

  const settle = () => {
    if (cluster.length === 0) return;
    const columns: number[] = [];
    cluster.forEach((item) => {
      // The first column whose last item has finished by the time this starts.
      let column = columns.findIndex((endsAt) => endsAt <= item.start);
      if (column < 0) {
        column = columns.length;
        columns.push(item.end);
      } else {
        columns[column] = item.end;
      }
      placed.set(item, { column, columns: 0 });
    });
    cluster.forEach((item) => {
      const at = placed.get(item);
      if (at !== undefined) placed.set(item, { ...at, columns: columns.length });
    });
    cluster = [];
    clusterEnds = -1;
  };

  ordered.forEach((item) => {
    if (cluster.length > 0 && item.start >= clusterEnds) settle();
    cluster.push(item);
    clusterEnds = Math.max(clusterEnds, item.end);
  });
  settle();
  return placed;
};

/**
 * The hours a day keeps, with one stretch taken out of them.
 *
 * Closing the shop for an hour in the middle of the day is not a new kind of
 * thing: it is the day kept either side of that hour — a special day with a
 * break in it, which is exactly what ADR 0002 stores and what the week editor
 * already says in those words.
 */
export const withoutSpan = (
  open: readonly { start: string; end: string }[],
  span: Span,
): { start: string; end: string }[] =>
  open.flatMap((range) => {
    const from = minutesOf(range.start);
    const to = minutesOf(range.end);
    if (span.end <= from || span.start >= to) return [range];
    const kept: { start: string; end: string }[] = [];
    if (from < span.start) kept.push({ start: range.start, end: clockOf(span.start) });
    if (span.end < to) kept.push({ start: clockOf(span.end), end: range.end });
    return kept;
  });

/** A length of time as somebody would say it. */
export const spokenLength = (
  minutes: number,
  words: { hour: string; twoHours: string; hours: string; andHalf: string; minutes: string },
): string => {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} ${words.minutes}`;
  const said =
    hours === 1 ? words.hour : hours === 2 ? words.twoHours : `${hours} ${words.hours}`;
  if (rest === 0) return said;
  if (rest === 30) return `${said} ${words.andHalf}`;
  return `${said} · ${rest} ${words.minutes}`;
};
