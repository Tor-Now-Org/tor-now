import { describe, expect, it } from "vitest";
import {
  businessUrl,
  cardFileName,
  daysText,
  firstAndMore,
  hoursGroups,
  kindLine,
  nameLanguage,
  namedOnly,
  rangesText,
  sharedOf,
  whatsappShareLink,
} from "./live-summary.ts";
import { emptyWeek, type DayHours } from "./week.ts";

const HE_DAYS = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"];
const closed: DayHours = { open: false, ranges: [{ start: "09:00", end: "17:00" }] };
const open = (...ranges: [string, string][]): DayHours => ({
  open: true,
  ranges: ranges.map(([start, end]) => ({ start, end })),
});

describe("the first few and how many more", () => {
  it("shows them all when there are no more than asked for", () => {
    expect(firstAndMore(["a", "b"], 3)).toEqual({ shown: ["a", "b"], more: 0 });
    expect(firstAndMore(["a", "b", "c"], 3)).toEqual({ shown: ["a", "b", "c"], more: 0 });
  });
  it("counts the rest", () => {
    expect(firstAndMore(["a", "b", "c", "d", "e"], 3)).toEqual({ shown: ["a", "b", "c"], more: 2 });
    expect(firstAndMore(["a", "b"], 1)).toEqual({ shown: ["a"], more: 1 });
  });
  it("survives an empty list and a nonsense count", () => {
    expect(firstAndMore([], 3)).toEqual({ shown: [], more: 0 });
    expect(firstAndMore(["a"], 0)).toEqual({ shown: [], more: 1 });
    expect(firstAndMore(["a"], -2)).toEqual({ shown: [], more: 1 });
  });
});

describe("the names that were saved", () => {
  it("drops the blank rows and trims the rest, keeping the order", () => {
    expect(namedOnly(["  דנה ", "", "   ", "רון"])).toEqual(["דנה", "רון"]);
    expect(namedOnly([])).toEqual([]);
  });
});

describe("the week, grouped by the hours days keep", () => {
  it("puts the usual week in one group", () => {
    expect(hoursGroups(emptyWeek())).toEqual([
      { days: [0, 1, 2, 3, 4], ranges: [{ start: "09:00", end: "17:00" }] },
    ]);
  });

  it("keeps a short Friday apart, after the week", () => {
    const week = [...emptyWeek().slice(0, 5), open(["09:00", "14:00"]), closed];
    expect(hoursGroups(week)).toEqual([
      { days: [0, 1, 2, 3, 4], ranges: [{ start: "09:00", end: "17:00" }] },
      { days: [5], ranges: [{ start: "09:00", end: "14:00" }] },
    ]);
  });

  it("orders groups by their first day, not by size", () => {
    const week = [open(["10:00", "12:00"]), open(["09:00", "17:00"]), open(["09:00", "17:00"]), open(["09:00", "17:00"]), closed, closed, closed];
    expect(hoursGroups(week).map((group) => group.days)).toEqual([[0], [1, 2, 3]]);
  });

  it("joins days that are not next to each other when their hours match", () => {
    const week = [open(["09:00", "13:00"]), open(["09:00", "17:00"]), open(["09:00", "13:00"]), closed, closed, closed, closed];
    expect(hoursGroups(week)).toEqual([
      { days: [0, 2], ranges: [{ start: "09:00", end: "13:00" }] },
      { days: [1], ranges: [{ start: "09:00", end: "17:00" }] },
    ]);
  });

  it("keeps a break as two stretches, and matches days by both", () => {
    const split = open(["09:00", "13:00"], ["16:00", "20:00"]);
    const week = [split, split, open(["09:00", "13:00"]), closed, closed, closed, closed];
    expect(hoursGroups(week)).toEqual([
      { days: [0, 1], ranges: [{ start: "09:00", end: "13:00" }, { start: "16:00", end: "20:00" }] },
      { days: [2], ranges: [{ start: "09:00", end: "13:00" }] },
    ]);
  });

  it("reads hours the way they are stored: overlapping and touching stretches merged, out of order sorted", () => {
    const messy = open(["13:00", "17:00"], ["09:00", "13:00"]);
    const tidy = open(["09:00", "17:00"]);
    const week = [messy, tidy, closed, closed, closed, closed, closed];
    expect(hoursGroups(week)).toEqual([{ days: [0, 1], ranges: [{ start: "09:00", end: "17:00" }] }]);
  });

  it("has nothing to say for a closed week, or for a day open with no stretches", () => {
    expect(hoursGroups(Array.from({ length: 7 }, () => closed))).toEqual([]);
    expect(hoursGroups([{ open: true, ranges: [] }, closed, closed, closed, closed, closed, closed])).toEqual([]);
  });

  it("says seven different days as seven groups", () => {
    const week = Array.from({ length: 7 }, (_unused, day) => open([`0${day + 1}:00`, "18:00"]));
    expect(hoursGroups(week).map((group) => group.days)).toEqual([[0], [1], [2], [3], [4], [5], [6]]);
  });
});

describe("the days of a group", () => {
  it("says three or more days running as a span", () => {
    expect(daysText([0, 1, 2, 3, 4], HE_DAYS)).toBe("א׳–ה׳");
    expect(daysText([0, 1, 2, 3, 4, 5, 6], HE_DAYS)).toBe("א׳–ש׳");
    expect(daysText([2, 3, 4], HE_DAYS)).toBe("ג׳–ה׳");
  });
  it("lists one or two", () => {
    expect(daysText([5], HE_DAYS)).toBe("ו׳");
    expect(daysText([0, 1], HE_DAYS)).toBe("א׳, ב׳");
    expect(daysText([0, 2], HE_DAYS)).toBe("א׳, ג׳");
  });
  it("mixes spans and single days", () => {
    expect(daysText([0, 1, 2, 4, 6], HE_DAYS)).toBe("א׳–ג׳, ה׳, ש׳");
    expect(daysText([0, 2, 3, 4, 6], ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"])).toBe("Sun, Tue–Thu, Sat");
  });
  it("does not care about order or repeats", () => {
    expect(daysText([4, 0, 2, 1, 3, 3], HE_DAYS)).toBe("א׳–ה׳");
  });
  it("is empty for no days", () => {
    expect(daysText([], HE_DAYS)).toBe("");
  });
});

describe("the hours of a group", () => {
  it("joins stretches with a comma", () => {
    expect(rangesText([{ start: "09:00", end: "13:00" }, { start: "16:00", end: "20:00" }])).toBe("09:00–13:00, 16:00–20:00");
    expect(rangesText([])).toBe("");
  });
});

describe("the language the printed card speaks", () => {
  it("is Hebrew for a name in Hebrew letters, whatever the app is in", () => {
    expect(nameLanguage("מספרת דנה", "en")).toBe("he");
    expect(nameLanguage("מספרת דנה 2", "he")).toBe("he");
    expect(nameLanguage("ספרות ״דנה״", "en")).toBe("he");
  });
  it("is English for a name in Latin letters, whatever the app is in", () => {
    expect(nameLanguage("Dana's Barbershop", "he")).toBe("en");
    expect(nameLanguage("Café Noir", "he")).toBe("en");
  });
  it("follows the app for a name with both, or with neither", () => {
    expect(nameLanguage("Studio דנה", "he")).toBe("he");
    expect(nameLanguage("Studio דנה", "en")).toBe("en");
    expect(nameLanguage("777", "en")).toBe("en");
    expect(nameLanguage("777", "he")).toBe("he");
    expect(nameLanguage("", "he")).toBe("he");
  });
});

describe("the links", () => {
  it("is the business's own page, with no doubled slash", () => {
    expect(businessUrl("https://tor-panuy.vercel.app", "b-1")).toBe("https://tor-panuy.vercel.app/business/b-1");
    expect(businessUrl("http://localhost:3100/", "b-1")).toBe("http://localhost:3100/business/b-1");
  });
  it("opens WhatsApp with the message written and nobody chosen", () => {
    const link = whatsappShareLink("אפשר לקבוע:\nhttps://x.test/business/1?a=1&b=2");
    expect(link.startsWith("https://wa.me/?text=")).toBe(true);
    expect(decodeURIComponent(link.slice("https://wa.me/?text=".length))).toBe("אפשר לקבוע:\nhttps://x.test/business/1?a=1&b=2");
  });
});

describe("the card's file name", () => {
  it("keeps letters in any script and joins words with a dash", () => {
    expect(cardFileName("מספרת דנה")).toBe("qr-מספרת-דנה.png");
    expect(cardFileName("Dana's Barbershop")).toBe("qr-Dana-s-Barbershop.png");
    expect(cardFileName("Café Noir")).toBe("qr-Café-Noir.png");
  });
  it("drops what a file system or printer would choke on", () => {
    expect(cardFileName("a/b\\c:d*e?f\"g<h>i|j")).toBe("qr-a-b-c-d-e-f-g-h-i-j.png");
    expect(cardFileName("  --hi--  ")).toBe("qr-hi.png");
  });
  it("still has a name when nothing usable is left", () => {
    expect(cardFileName("!!!")).toBe("qr-business.png");
    expect(cardFileName("")).toBe("qr-business.png");
  });
  it("stays short", () => {
    expect(cardFileName("א".repeat(200)).length).toBeLessThanOrEqual("qr-.png".length + 40);
  });
});

describe("the line under the name", () => {
  it("is the main category and the address, in the language asked for", () => {
    expect(kindLine("barbershop", "הרצל 1, תל אביב", "he")).toBe("מספרה / ספר · הרצל 1, תל אביב");
    expect(kindLine("barbershop", "1 Herzl, Tel Aviv", "en")).toBe("Barbershop · 1 Herzl, Tel Aviv");
  });
  it("leaves out what the business does not have, and trims what it does", () => {
    expect(kindLine(null, "הרצל 1", "he")).toBe("הרצל 1");
    expect(kindLine("barbershop", null, "he")).toBe("מספרה / ספר");
    expect(kindLine("barbershop", "   ", "he")).toBe("מספרה / ספר");
    expect(kindLine("barbershop", "  הרצל 1  ", "he")).toBe("מספרה / ספר · הרצל 1");
    expect(kindLine(null, null, "en")).toBe("");
  });
});

describe("a business as a share hands it on", () => {
  const business = { id: "b-1", name: "מספרת דנה", address: "הרצל 1", category: "barbershop" as const };

  it("links to the business's page and keeps its name", () => {
    expect(sharedOf(business, "https://tor-panuy.vercel.app", "en")).toMatchObject({
      url: "https://tor-panuy.vercel.app/business/b-1",
      name: "מספרת דנה",
    });
  });
  it("sets the card in the name's language, and its line in that language too", () => {
    expect(sharedOf(business, "https://x.test", "en")).toMatchObject({ cardLanguage: "he", kind: "מספרה / ספר · הרצל 1" });
    expect(sharedOf({ ...business, name: "Dana's" }, "https://x.test", "he")).toMatchObject({
      cardLanguage: "en",
      kind: "Barbershop · הרצל 1",
    });
  });
  it("follows the app for a name in both scripts, and survives a business with no category or address", () => {
    expect(sharedOf({ ...business, name: "Studio דנה" }, "https://x.test", "en").cardLanguage).toBe("en");
    expect(sharedOf({ id: "b-2", name: "x", address: null, category: null }, "https://x.test/", "he")).toEqual({
      url: "https://x.test/business/b-2",
      name: "x",
      cardLanguage: "en",
      kind: "",
    });
  });
});
