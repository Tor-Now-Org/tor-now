import { describe, expect, it } from "vitest";
import type { ChangeDto } from "@/lib/api/types.ts";
import { change as words } from "@/lib/i18n/change-copy.ts";
import {
  calendarPhrase,
  datesPhrase,
  draftFor,
  hoursText,
  markOf,
  mayChange,
  problemsOf,
  quickChips,
  rowOf,
  saveLabel,
  scopeOptions,
  sentenceOf,
  withOutcome,
  withUsual,
  type Draft,
  type Who,
} from "./change-model.ts";

const he = words.he;
const en = words.en;
const TODAY = "2026-10-04";
const A = { id: "a", name: "יומן א" };
const B = { id: "b", name: "שימי" };
const owner: Who = { manages: true, calendars: [A, B] };
const worker: Who = { manages: false, calendars: [B] };
const workerOnTwo: Who = { manages: false, calendars: [A, B] };
const alone: Who = { manages: true, calendars: [A] };

const aChange = (overrides: Partial<ChangeDto> = {}): ChangeDto => ({
  id: "blocks:g1",
  scope: { kind: "CALENDAR", resourceId: "a" },
  outcome: "OFF_PART",
  fromDate: "2026-10-06",
  toDate: "2026-10-06",
  days: [{ date: "2026-10-06", ranges: [{ start: "13:00", end: "15:00" }] }],
  ranges: [{ start: "13:00", end: "15:00" }],
  note: "רופא שיניים",
  ...overrides,
});

describe("for whom a change can be", () => {
  it("offers an owner every calendar and the whole business", () => {
    expect(scopeOptions(owner)).toEqual([
      { kind: "CALENDAR", resourceId: "a", name: "יומן א" },
      { kind: "CALENDAR", resourceId: "b", name: "שימי" },
      { kind: "BUSINESS" },
    ]);
  });

  it("offers a worker only their own calendars, never the business", () => {
    expect(scopeOptions(worker)).toEqual([{ kind: "CALENDAR", resourceId: "b", name: "שימי" }]);
    expect(scopeOptions(workerOnTwo).map((option) => option.kind)).toEqual(["CALENDAR", "CALENDAR"]);
  });

  it("asks nothing about the business when there is one calendar", () => {
    expect(scopeOptions(alone)).toEqual([{ kind: "CALENDAR", resourceId: "a", name: "יומן א" }]);
  });
});

describe("what each door fills in", () => {
  it("days chosen on the month: those days, the calendar on screen, nothing else", () => {
    expect(draftFor({ kind: "days", from: "2026-10-07", to: "2026-10-08", resourceId: "a" }, owner, TODAY)).toMatchObject({
      fromDate: "2026-10-07",
      toDate: "2026-10-08",
      scope: { kind: "CALENDAR", resourceId: "a" },
      outcome: null,
      ranges: [],
      note: "",
      upcoming: "CANCEL",
      replacing: null,
      typing: false,
    });
  });

  it("days chosen with every calendar on screen: nobody chosen yet for a shop of several", () => {
    expect(draftFor({ kind: "days", from: "2026-10-07", to: "2026-10-07", resourceId: null }, owner, TODAY).scope).toBeNull();
  });

  it("the only calendar there is, chosen without asking", () => {
    expect(draftFor({ kind: "days", from: "2026-10-07", to: "2026-10-07", resourceId: null }, alone, TODAY).scope).toEqual({
      kind: "CALENDAR",
      resourceId: "a",
    });
    expect(draftFor({ kind: "days", from: "2026-10-07", to: "2026-10-07", resourceId: null }, worker, TODAY).scope).toEqual({
      kind: "CALENDAR",
      resourceId: "b",
    });
  });

  it("never a calendar the person cannot change", () => {
    expect(draftFor({ kind: "days", from: "2026-10-07", to: "2026-10-07", resourceId: "a" }, worker, TODAY).scope).toEqual({
      kind: "CALENDAR",
      resourceId: "b",
    });
  });

  it("a free stretch: its day, its calendar, and its hours ready for part of the day", () => {
    const draft = draftFor({ kind: "stretch", date: "2026-10-06", resourceId: "a", start: "13:00", end: "15:00" }, owner, TODAY);
    expect(draft).toMatchObject({ fromDate: "2026-10-06", toDate: "2026-10-06", scope: { kind: "CALENDAR", resourceId: "a" }, outcome: null });
    expect(withOutcome(draft, "OFF_PART", []).ranges).toEqual([{ start: "13:00", end: "15:00" }]);
  });

  it("the schedule: today, typed, for the scope chosen there", () => {
    expect(draftFor({ kind: "typed", date: TODAY, scope: { kind: "BUSINESS" } }, owner, TODAY)).toMatchObject({
      fromDate: TODAY,
      toDate: TODAY,
      scope: { kind: "BUSINESS" },
      typing: true,
    });
  });

  it("the schedule never hands a worker the business", () => {
    expect(draftFor({ kind: "typed", date: TODAY, scope: { kind: "BUSINESS" } }, worker, TODAY).scope).toEqual({
      kind: "CALENDAR",
      resourceId: "b",
    });
  });

  it("an existing change: everything it says, and the id it replaces", () => {
    expect(draftFor({ kind: "edit", change: aChange() }, owner, TODAY)).toMatchObject({
      fromDate: "2026-10-06",
      toDate: "2026-10-06",
      scope: { kind: "CALENDAR", resourceId: "a" },
      outcome: "OFF_PART",
      ranges: [{ start: "13:00", end: "15:00" }],
      note: "רופא שיניים",
      replacing: "blocks:g1",
    });
  });

  it("an existing change that began before today starts from today", () => {
    const draft = draftFor({ kind: "edit", change: aChange({ fromDate: "2026-10-01", toDate: "2026-10-09" }) }, owner, TODAY);
    expect(draft.fromDate).toBe(TODAY);
    expect(draft.toDate).toBe("2026-10-09");
  });

  it("an existing change at different hours each day starts from the first day still to come", () => {
    const draft = draftFor({
      kind: "edit",
      change: aChange({
        fromDate: "2026-10-03",
        toDate: "2026-10-05",
        ranges: null,
        days: [
          { date: "2026-10-03", ranges: [{ start: "09:00", end: "10:00" }] },
          { date: "2026-10-05", ranges: [{ start: "11:00", end: "12:00" }] },
        ],
      }),
    }, owner, TODAY);
    expect(draft.ranges).toEqual([{ start: "11:00", end: "12:00" }]);
  });
});

describe("choosing what happens", () => {
  const opened: Draft = draftFor({ kind: "days", from: "2026-10-09", to: "2026-10-09", resourceId: "a" }, owner, TODAY);
  const usual = [{ start: "09:00", end: "19:00" }];

  it("a day off keeps no hours", () => {
    expect(withOutcome({ ...opened, ranges: [{ start: "10:00", end: "11:00" }] }, "OFF_ALL_DAY", usual).ranges).toEqual([]);
  });

  it("other hours open on the usual day, so a short Friday is one change of the closing time", () => {
    expect(withOutcome(opened, "OTHER_HOURS", usual).ranges).toEqual(usual);
  });

  it("other hours on a day nobody usually works open on a working day's hours", () => {
    expect(withOutcome(opened, "OTHER_HOURS", []).ranges).toEqual([{ start: "09:00", end: "17:00" }]);
  });

  it("part of the day opens on an hour from the start of the usual day", () => {
    expect(withOutcome(opened, "OFF_PART", usual).ranges).toEqual([{ start: "09:00", end: "10:00" }]);
    expect(withOutcome(opened, "OFF_PART", []).ranges).toEqual([{ start: "12:00", end: "13:00" }]);
  });

  it("keeps hours the owner set when switching between the two that have them", () => {
    const set = { ...withOutcome(opened, "OFF_PART", usual), ranges: [{ start: "14:00", end: "16:00" }], touchedHours: true };
    expect(withOutcome(set, "OTHER_HOURS", usual).ranges).toEqual([{ start: "14:00", end: "16:00" }]);
  });

  it("fills other hours in when the usual day arrives late, unless the owner already typed some", () => {
    const early = withOutcome(opened, "OTHER_HOURS", []);
    expect(withUsual(early, usual).ranges).toEqual(usual);
    expect(withUsual({ ...early, touchedHours: true }, usual).ranges).toEqual(early.ranges);
    expect(withUsual(withOutcome(opened, "OFF_PART", []), usual).ranges).toEqual([{ start: "12:00", end: "13:00" }]);
  });
});

describe("the quick hours", () => {
  const usual = [{ start: "09:00", end: "19:00" }];

  it("offers lengths from the start of the stretch, and the rest of the day", () => {
    const chips = quickChips("OFF_PART", usual);
    expect(chips.map((chip) => chip.label)).toEqual(["quick30", "quick60", "quick120", "quickToEnd"]);
    expect(chips.map((chip) => chip.apply([{ start: "13:00", end: "15:00" }]))).toEqual([
      [{ start: "13:00", end: "13:30" }],
      [{ start: "13:00", end: "14:00" }],
      [{ start: "13:00", end: "15:00" }],
      [{ start: "13:00", end: "19:00" }],
    ]);
  });

  it("runs to midnight when the day has no usual end", () => {
    const toEnd = quickChips("OFF_PART", []).at(-1)!;
    expect(toEnd.apply([{ start: "20:00", end: "21:00" }])).toEqual([{ start: "20:00", end: "23:59" }]);
  });

  it("does not run a length past midnight", () => {
    const [, , twoHours] = quickChips("OFF_PART", []);
    expect(twoHours!.apply([{ start: "23:00", end: "23:30" }])).toEqual([{ start: "23:00", end: "23:59" }]);
  });

  it("offers a short day, a late start and the usual hours for other hours", () => {
    const chips = quickChips("OTHER_HOURS", usual);
    expect(chips.map((chip) => [chip.label, chip.time ?? null])).toEqual([
      ["quickUntil", "13:00"],
      ["quickFrom", "12:00"],
      ["quickUsual", null],
    ]);
    expect(chips[0]!.apply(usual)).toEqual([{ start: "09:00", end: "13:00" }]);
    expect(chips[1]!.apply(usual)).toEqual([{ start: "12:00", end: "19:00" }]);
    expect(chips[2]!.apply([{ start: "10:00", end: "11:00" }])).toEqual(usual);
  });

  it("offers no usual hours on a day nobody usually works", () => {
    expect(quickChips("OTHER_HOURS", []).map((chip) => chip.label)).toEqual(["quickUntil", "quickFrom"]);
  });

  it("offers nothing for a day off, or before any outcome", () => {
    expect(quickChips("OFF_ALL_DAY", usual)).toEqual([]);
    expect(quickChips(null, usual)).toEqual([]);
  });
});

describe("what holds saving back", () => {
  const ready: Draft = {
    ...draftFor({ kind: "days", from: "2026-10-06", to: "2026-10-06", resourceId: "a" }, owner, TODAY),
    outcome: "OFF_PART",
    ranges: [{ start: "13:00", end: "15:00" }],
  };

  it("nothing, once both questions are answered", () => {
    expect(problemsOf(ready, TODAY)).toEqual([]);
  });

  it("nobody chosen, or nothing chosen", () => {
    expect(problemsOf({ ...ready, scope: null }, TODAY)).toContain("NO_SCOPE");
    expect(problemsOf({ ...ready, outcome: null }, TODAY)).toContain("NO_OUTCOME");
  });

  it("an end before its start, or at it", () => {
    expect(problemsOf({ ...ready, ranges: [{ start: "15:00", end: "13:00" }] }, TODAY)).toEqual(["END_BEFORE_START"]);
    expect(problemsOf({ ...ready, ranges: [{ start: "13:00", end: "13:00" }] }, TODAY)).toEqual(["END_BEFORE_START"]);
  });

  it("a time half typed", () => {
    expect(problemsOf({ ...ready, ranges: [{ start: "13:00", end: "" }] }, TODAY)).toEqual(["MISSING_HOURS"]);
  });

  it("hours that overlap", () => {
    expect(problemsOf({ ...ready, ranges: [{ start: "10:00", end: "12:00" }, { start: "11:00", end: "13:00" }] }, TODAY)).toEqual(["OVERLAP"]);
  });

  it("no hours where hours are the answer", () => {
    expect(problemsOf({ ...ready, ranges: [] }, TODAY)).toEqual(["NO_HOURS"]);
    expect(problemsOf({ ...ready, outcome: "OFF_ALL_DAY", ranges: [] }, TODAY)).toEqual([]);
  });

  it("a day that has passed, dates the wrong way round, more than a year", () => {
    expect(problemsOf({ ...ready, fromDate: "2026-10-03" }, TODAY)).toEqual(["PAST_DAY"]);
    expect(problemsOf({ ...ready, fromDate: "2026-10-08", toDate: "2026-10-06" }, TODAY)).toEqual(["DATES_REVERSED"]);
    expect(problemsOf({ ...ready, toDate: "2027-10-07" }, TODAY)).toEqual(["TOO_LONG"]);
    expect(problemsOf({ ...ready, fromDate: "", toDate: "" }, TODAY)).toEqual(["DATES_REVERSED"]);
  });
});

describe("what the button says it will do", () => {
  const draft = (scope: Draft["scope"], outcome: Draft["outcome"], days = 1): Draft => ({
    ...draftFor({ kind: "days", from: "2026-10-06", to: days === 1 ? "2026-10-06" : "2026-10-07", resourceId: "a" }, owner, TODAY),
    scope,
    outcome,
  });

  it("asks for what is missing first", () => {
    expect(saveLabel(draft(null, "OFF_PART"), 0)).toEqual({ key: "chooseWho" });
    expect(saveLabel(draft({ kind: "BUSINESS" }, null), 0)).toEqual({ key: "chooseWhat" });
  });

  it("saves the change", () => {
    expect(saveLabel(draft({ kind: "CALENDAR", resourceId: "a" }, "OFF_PART"), 0)).toEqual({ key: "save" });
  });

  it("names the appointments it cancels, and drops them when they are kept", () => {
    const withTwo = draft({ kind: "CALENDAR", resourceId: "a" }, "OFF_PART");
    expect(saveLabel(withTwo, 2)).toEqual({ key: "saveAndCancel", count: 2 });
    expect(saveLabel(withTwo, 1)).toEqual({ key: "saveAndCancelOne", count: 1 });
    expect(saveLabel({ ...withTwo, upcoming: "KEEP" }, 2)).toEqual({ key: "save" });
  });

  it("says closing the business out loud, for one day or several", () => {
    expect(saveLabel(draft({ kind: "BUSINESS" }, "OFF_ALL_DAY"), 0)).toEqual({ key: "closeDay" });
    expect(saveLabel(draft({ kind: "BUSINESS" }, "OFF_ALL_DAY", 2), 0)).toEqual({ key: "closeDays" });
    expect(saveLabel(draft({ kind: "BUSINESS" }, "OFF_ALL_DAY"), 3)).toEqual({ key: "closeAndCancel", count: 3 });
    expect(saveLabel(draft({ kind: "BUSINESS" }, "OFF_ALL_DAY"), 1)).toEqual({ key: "closeAndCancelOne", count: 1 });
    expect(saveLabel({ ...draft({ kind: "BUSINESS" }, "OFF_ALL_DAY"), upcoming: "KEEP" }, 3)).toEqual({ key: "closeDay" });
  });
});

describe("the sentence under the choice", () => {
  const names = { a: "יומן א", b: "שימי", r: "רן" };

  it("says a calendar by its name the way it reads", () => {
    expect(calendarPhrase("יומן א", he)).toBe("ביומן א");
    expect(calendarPhrase("רן", he)).toBe("ביומן של רן");
    expect(calendarPhrase("Ran", en)).toBe("on Ran's calendar");
  });

  it("says one day, two days, and a run of them", () => {
    expect(datesPhrase("2026-10-06", "2026-10-06", "he", he)).toBe("ב־6 באוקטובר");
    expect(datesPhrase("2026-10-07", "2026-10-08", "he", he)).toBe("ב־7 וב־8 באוקטובר");
    expect(datesPhrase("2026-10-07", "2026-10-09", "he", he)).toBe("בין 7 ל־9 באוקטובר");
    expect(datesPhrase("2026-09-30", "2026-10-02", "he", he)).toBe("בין 30 בספטמבר ל־2 באוקטובר");
    expect(datesPhrase("2026-09-30", "2026-10-01", "he", he)).toBe("ב־30 בספטמבר וב־1 באוקטובר");
    expect(datesPhrase("2026-10-07", "2026-10-08", "en", en)).toBe("On 7 and 8 October");
    expect(datesPhrase("2026-10-07", "2026-10-09", "en", en)).toBe("From 7 to 9 October");
  });

  const say = (input: Parameters<typeof sentenceOf>[0], language: "he" | "en" = "he") =>
    sentenceOf(input, language === "he" ? he : en, language, names);

  it("a calendar not working all day, the others as usual", () => {
    expect(say({ scope: { kind: "CALENDAR", resourceId: "a" }, outcome: "OFF_ALL_DAY", fromDate: "2026-10-07", toDate: "2026-10-08", ranges: [], usual: [], calendars: 2 }))
      .toMatchObject({ text: "ב־7 וב־8 באוקטובר אין תורים ביומן א. שאר היומנים עובדים כרגיל.", filled: ["ב־7 וב־8 באוקטובר", "ביומן א"] });
  });

  it("says nothing of others when there are none", () => {
    expect(say({ scope: { kind: "CALENDAR", resourceId: "a" }, outcome: "OFF_ALL_DAY", fromDate: "2026-10-07", toDate: "2026-10-07", ranges: [], usual: [], calendars: 1 })!.text)
      .toBe("ב־7 באוקטובר אין תורים ביומן א.");
  });

  it("part of a calendar's day, with its hours", () => {
    expect(say({ scope: { kind: "CALENDAR", resourceId: "r" }, outcome: "OFF_PART", fromDate: "2026-10-06", toDate: "2026-10-06", ranges: [{ start: "13:00", end: "15:00" }], usual: [], calendars: 1 }))
      .toMatchObject({ text: "ב־6 באוקטובר אין תורים ביומן של רן בין 13:00–15:00. שאר היום כרגיל.", filled: ["ב־6 באוקטובר", "ביומן של רן", "13:00–15:00"] });
  });

  it("a calendar's other hours, instead of the usual", () => {
    expect(say({ scope: { kind: "CALENDAR", resourceId: "a" }, outcome: "OTHER_HOURS", fromDate: "2026-10-09", toDate: "2026-10-09", ranges: [{ start: "09:00", end: "13:00" }], usual: [{ start: "09:00", end: "19:00" }], calendars: 1 })!.text)
      .toBe("ב־9 באוקטובר עובדים ביומן א רק 09:00–13:00, במקום 09:00–19:00.");
  });

  it("other hours on a day nobody usually works say no 'instead of'", () => {
    expect(say({ scope: { kind: "BUSINESS" }, outcome: "OTHER_HOURS", fromDate: "2026-10-10", toDate: "2026-10-10", ranges: [{ start: "10:00", end: "12:00" }], usual: [], calendars: 2 })!.text)
      .toBe("ב־10 באוקטובר העסק פתוח רק 10:00–12:00.");
  });

  it("the business closed, in words", () => {
    expect(say({ scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY", fromDate: "2026-10-14", toDate: "2026-10-14", ranges: [], usual: [], calendars: 2 })!.text)
      .toBe("ב־14 באוקטובר העסק סגור. אף יומן לא מקבל תורים.");
  });

  it("the business not working part of the day", () => {
    expect(say({ scope: { kind: "BUSINESS" }, outcome: "OFF_PART", fromDate: "2026-10-06", toDate: "2026-10-06", ranges: [{ start: "13:00", end: "14:00" }, { start: "16:00", end: "17:00" }], usual: [], calendars: 2 })!.text)
      .toBe("ב־6 באוקטובר אין תורים בכל העסק בין 13:00–14:00, 16:00–17:00. שאר היום כרגיל.");
  });

  it("hours that differ day to day", () => {
    expect(say({ scope: { kind: "BUSINESS" }, outcome: "OFF_PART", fromDate: "2026-10-06", toDate: "2026-10-07", ranges: null, usual: [], calendars: 2 })!.text)
      .toBe("ב־6 וב־7 באוקטובר אין תורים בכל העסק בשעות שונות בכל יום. שאר היום כרגיל.");
  });

  it("in English", () => {
    expect(say({ scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY", fromDate: "2026-10-14", toDate: "2026-10-14", ranges: [], usual: [], calendars: 2 }, "en")!.text)
      .toBe("On 14 October the business is closed. No calendar takes appointments.");
  });

  it("nothing until both questions are answered", () => {
    expect(say({ scope: null, outcome: "OFF_ALL_DAY", fromDate: "2026-10-14", toDate: "2026-10-14", ranges: [], usual: [], calendars: 2 })).toBeNull();
    expect(say({ scope: { kind: "BUSINESS" }, outcome: null, fromDate: "2026-10-14", toDate: "2026-10-14", ranges: [], usual: [], calendars: 2 })).toBeNull();
  });
});

describe("a change in a list, on the month and in the day", () => {
  it("is marked by what happens", () => {
    expect(markOf(aChange({ outcome: "OFF_ALL_DAY" }))).toBe("CLOSED");
    expect(markOf(aChange({ outcome: "OFF_PART" }))).toBe("PART");
    expect(markOf(aChange({ outcome: "OTHER_HOURS" }))).toBe("HOURS");
  });

  it("says its hours plainly", () => {
    expect(hoursText([{ start: "13:00", end: "15:00" }, { start: "16:00", end: "17:00" }])).toBe("13:00–15:00, 16:00–17:00");
  });

  it("reads as a short row", () => {
    expect(rowOf(aChange(), he, "he")).toEqual({ when: "6 באוק׳", what: "לא עובדים 13:00–15:00", note: "רופא שיניים" });
    expect(rowOf(aChange({ outcome: "OFF_ALL_DAY", ranges: [], fromDate: "2026-10-07", toDate: "2026-10-08", note: null, days: [{ date: "2026-10-07", ranges: [] }, { date: "2026-10-08", ranges: [] }] }), he, "he"))
      .toEqual({ when: "7–8 באוק׳", what: "לא עובדים כל היום · 2 ימים", note: null });
    expect(rowOf(aChange({ scope: { kind: "BUSINESS" }, outcome: "OFF_ALL_DAY", ranges: [] }), he, "he").what).toBe("סגור כל היום");
    expect(rowOf(aChange({ outcome: "OTHER_HOURS", ranges: [{ start: "09:00", end: "13:00" }] }), he, "he").what).toBe("עובדים 09:00–13:00");
    expect(rowOf(aChange({ ranges: null }), he, "he").what).toBe("לא עובדים בשעות שונות בכל יום");
  });

  it("spans months in a row as both ends", () => {
    expect(rowOf(aChange({ fromDate: "2026-09-30", toDate: "2026-10-01" }), he, "he").when).toBe("30 בספט׳–1 באוק׳");
  });
});

describe("who may change a change", () => {
  it("lets an owner change anything", () => {
    expect(mayChange(aChange({ scope: { kind: "BUSINESS" } }), owner)).toBe(true);
    expect(mayChange(aChange(), owner)).toBe(true);
  });

  it("lets a worker change their own calendar's, never the business's", () => {
    expect(mayChange(aChange({ scope: { kind: "CALENDAR", resourceId: "b" } }), worker)).toBe(true);
    expect(mayChange(aChange({ scope: { kind: "BUSINESS" } }), worker)).toBe(false);
    expect(mayChange(aChange({ scope: { kind: "CALENDAR", resourceId: "a" } }), worker)).toBe(false);
  });
});
