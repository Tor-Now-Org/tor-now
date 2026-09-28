import { describe, expect, it } from "vitest";
import { parseLocalDate, type NoticeFacts } from "@tor-now/domain";
import { DICTIONARIES } from "@/lib/i18n/dictionaries.ts";
import { noticeDay, noticeText, type NoticeContext } from "./notice-text.ts";

const context = (language: "he" | "en" = "en", today = "2026-10-19"): NoticeContext => ({
  words: DICTIONARIES.notices[language],
  billing: DICTIONARIES.billing[language],
  language,
  today,
});

const day = parseLocalDate;
const text = (facts: NoticeFacts, language: "he" | "en" = "en", today?: string) =>
  noticeText(facts, context(language, today));

describe("noticeText", () => {
  it("says when a Trial ends relative to today, and that it ended once it has", () => {
    const ending: NoticeFacts = { kind: "TRIAL_ENDING", trialEndsOn: day("2026-10-26") };
    expect(text(ending)).toEqual({
      title: "Your Trial ends in 7 days",
      body: expect.stringContaining("On 26 October. Without a payment by then"),
      action: "PAY",
    });
    expect(text(ending, "en", "2026-10-25").title).toBe("Your Trial ends tomorrow");
    expect(text(ending, "en", "2026-10-26").title).toBe("Your Trial ends today");
    expect(text(ending, "en", "2026-10-27").title).toBe("Your Trial has ended");
    expect(text(ending, "he").title).toBe("תקופת הניסיון נגמרת בעוד 7 ימים");
  });

  it("names the Trial's plan, length and end", () => {
    expect(text({ kind: "TRIAL_STARTED", plan: "TEAM", trialEndsOn: day("2026-10-26") }, "he")).toEqual({
      title: "תקופת הניסיון התחילה",
      body: "30 יום על מסלול צוות, עד 26 באוקטובר. כדי להמשיך אחריה, יש לשלם עד אז — נזכיר שבוע לפני.",
      action: "PLANS",
    });
  });

  it("points everything about paying at how to pay, except a payment received", () => {
    expect(text({ kind: "PAYMENT_LATE", graceEndsOn: day("2026-11-07") }).action).toBe("PAY");
    expect(text({ kind: "DEACTIVATED", on: day("2026-11-08") }).action).toBe("PAY");
    expect(text({ kind: "PAYMENT_RECORDED", paidThrough: day("2026-11-23") })).toEqual({
      title: "Payment received",
      body: "The subscription is paid through 23 November. Thank you!",
      action: null,
    });
  });

  it("says what a plan change gave and took, who made it, and the price", () => {
    const upgrade = text({
      kind: "PLAN_CHANGED",
      plan: "TEAM",
      by: "ADMINISTRATOR",
      priceMinor: 8900,
      resourceAllowance: 5,
      gained: ["CUSTOMER_HISTORY", "TEAM_ROLES"],
      lost: [],
    });
    expect(upgrade.title).toBe("We moved you to Team");
    expect(upgrade.body).toMatch(/^The plan includes up to 5 calendars\. Added: .+ and .+\. The price, ₪89 a month/);
    expect(upgrade.body).not.toContain("Removed");

    const downgrade = text({
      kind: "PLAN_CHANGED",
      plan: "SOLO",
      by: "OWNER",
      priceMinor: 4900,
      resourceAllowance: 1,
      gained: [],
      lost: ["TEAM_ROLES"],
    });
    expect(downgrade.title).toBe("You moved to Solo");
    expect(downgrade.body).toContain("The plan includes 1 calendar.");
    expect(downgrade.body).toContain("Removed:");
  });

  it("names the calendars a move pauses, joined as a sentence joins them", () => {
    const soon = text(
      { kind: "MOVE_SOON", plan: "SOLO", effectiveOn: day("2026-10-24"), pausing: ["דנה", "יוסי"] },
      "he",
    );
    expect(soon.title).toBe("עוברים ליחיד בעוד 5 ימים");
    expect(soon.body).toContain("דנה ויוסי יושהו באותו יום");
    expect(soon.action).toBe("CANCEL_MOVE");

    const scheduled = text({ kind: "MOVE_SCHEDULED", plan: "SOLO", by: "OWNER", effectiveOn: day("2026-10-24"), pausing: [] });
    expect(scheduled.body).toBe("It takes effect on 24 October, at renewal. Until then nothing changes.");

    expect(text({ kind: "MOVE_APPLIED", plan: "SOLO", paused: [] })).toEqual({
      title: "You moved to Solo",
      body: "The move took effect today.",
      action: null,
    });
    expect(text({ kind: "MOVE_APPLIED", plan: "SOLO", paused: ["Dana"] }).action).toBe("PLANS");
  });

  it("speaks of one calendar by name and of several by number", () => {
    expect(text({ kind: "CALENDARS_PAUSED", names: ["Dana"], resourceAllowance: 1 }).title).toBe("Dana is paused");
    const many = text({ kind: "CALENDARS_PAUSED", names: ["Dana", "Yossi"], resourceAllowance: 1 });
    expect(many.title).toBe("2 calendars paused");
    expect(many.body).toContain("Dana and Yossi take no new bookings, because your plan includes 1 calendar.");
    expect(text({ kind: "CALENDARS_RESUMED", names: ["Dana"] }).title).toBe("Dana is back");
    expect(text({ kind: "CALENDARS_RESUMED", names: ["Dana", "Yossi"] })).toEqual({
      title: "Your calendars are back",
      body: "Dana and Yossi take bookings again.",
      action: null,
    });
  });
});

describe("noticeText — Grants", () => {
  it("names one Feature given, and counts several", () => {
    expect(text({ kind: "FEATURES_GRANTED", features: ["TEAM_ROLES"], endsOn: day("2026-12-26") })).toEqual({
      title: "You received Managers and workers",
      body: "Managers and workers, until 26 December, at no extra cost.",
      action: "INCLUDED",
    });
    const several = text(
      { kind: "FEATURES_GRANTED", features: ["CUSTOMER_HISTORY", "CUSTOMER_BLOCKING"], endsOn: day("2026-12-26") },
      "he",
    );
    expect(several.title).toBe("קיבלתם 2 פיצ'רים");
    expect(several.body).toBe("היסטוריית לקוח וחסימת לקוחות, עד 26 בדצמבר, בלי תשלום נוסף.");
  });

  it("says when Grants end, relative to today, and points at the plans", () => {
    const ending = text({ kind: "GRANT_ENDING", features: ["TEAM_ROLES", "CUSTOMER_HISTORY"], endsOn: day("2026-10-26") });
    expect(ending.title).toBe("2 Features end in 7 days");
    expect(ending.action).toBe("PLANS");
    expect(text({ kind: "GRANT_ENDING", features: ["TEAM_ROLES"], endsOn: day("2026-10-20") }).title).toBe(
      "Managers and workers ends tomorrow",
    );
  });

  it("tells of an extension quietly, and of an early end with the way back", () => {
    expect(text({ kind: "GRANT_EXTENDED", feature: "WAITING_LIST", endsOn: day("2026-11-01") })).toEqual({
      title: "Waiting list was extended",
      body: "Now until 1 November, at no extra cost.",
      action: null,
    });
    expect(text({ kind: "GRANT_ENDED", feature: "TEAM_ROLES" }, "he")).toMatchObject({
      title: "מנהלים ועובדים הסתיים",
      action: "PLANS",
    });
  });
});

describe("noticeText — a Plan changing", () => {
  it("says what changes and from when, the price first", () => {
    const announced = text({
      kind: "EDITION_ANNOUNCED",
      plan: "SOLO",
      effectiveOn: day("2026-10-28"),
      priceFrom: 4900,
      priceTo: 5900,
      allowanceFrom: 1,
      allowanceTo: 1,
      gained: [],
      lost: ["REMINDERS"],
    });
    expect(announced.title).toBe("Solo changes on 28 October");
    expect(announced.body).toBe(
      "The price rises from ₪49 to ₪59 a month and Reminders is no longer included, from your renewal on 28 October. Until then nothing changes.",
    );
    expect(announced.action).toBe("PLANS");
  });

  it("reminds relative to today, and tells of landing and of cancelling", () => {
    expect(text({ kind: "EDITION_SOON", plan: "SOLO", effectiveOn: day("2026-10-26") }).title).toBe("Solo changes in 7 days");
    expect(text({ kind: "EDITION_APPLIED", plan: "SOLO" }, "he").title).toBe("מסלול יחיד התעדכן");
    expect(text({ kind: "EDITION_CANCELLED", plan: "TEAM" })).toEqual({
      title: "The change to Team is cancelled",
      body: "The plan stays exactly as it is.",
      action: null,
    });
  });

  it("says what got better, with nothing to do", () => {
    const improved = text({
      kind: "PLAN_IMPROVED",
      plan: "TEAM",
      priceFrom: 8900,
      priceTo: 8900,
      allowanceFrom: 5,
      allowanceTo: 8,
      gained: [],
    });
    expect(improved.title).toBe("Team got better");
    expect(improved.body).toBe("Up to 8 calendars instead of 5. It applies already, with nothing for you to do.");
  });
});

describe("noticeText — Previews", () => {
  it("offers a new Feature to try, and says when it stays or leaves", () => {
    expect(text({ kind: "PREVIEW_STARTED", feature: "CUSTOMER_HISTORY", endsOn: day("2026-12-26") })).toEqual({
      title: "Customer history — new to try",
      body: "In Preview until 26 December, at no extra cost.",
      action: "INCLUDED",
    });
    expect(text({ kind: "PREVIEW_KEPT", feature: "WAITING_LIST", plan: "TEAM" }, "he").title).toBe("רשימת המתנה נשאר אצלכם");
    expect(
      text({ kind: "PREVIEW_LEAVING", feature: "WAITING_LIST", plan: "SOLO", endsOn: day("2026-11-25"), addonPriceMinor: null }),
    ).toMatchObject({
      title: "Waiting list leaves Solo on 25 November",
      action: "PLANS",
    });
    expect(
      text({ kind: "PREVIEW_LEAVING", feature: "WAITING_LIST", plan: "SOLO", endsOn: day("2026-11-25"), addonPriceMinor: 1500 }).body,
    ).toContain("You can keep it as an Add-on for");
    expect(text({ kind: "PREVIEW_ENDING", feature: "WAITING_LIST", endsOn: day("2026-10-26") }).title).toBe(
      "Waiting list ends in 7 days",
    );
  });
});

describe("an Add-on's Notices", () => {
  it("says what it costs and from when, and whose act it was", () => {
    const added = text({
      kind: "ADDON_ADDED",
      feature: "CUSTOMER_HISTORY",
      by: "OWNER",
      priceMinor: 1900,
      paysFrom: day("2026-11-27"),
      owedMinor: 950,
    });
    expect(added.title).toBe("You added Customer history");
    expect(added.body).toContain("from your payment on 27 November");
    expect(added.body).toContain("as you had it before");
    expect(text({ kind: "ADDON_ADDED", feature: "CUSTOMER_HISTORY", by: "ADMINISTRATOR", priceMinor: 1900, paysFrom: day("2026-11-27"), owedMinor: 0 }).body).not.toContain(
      "as you had it before",
    );
    expect(text({ kind: "ADDON_CANCELLED", feature: "CUSTOMER_HISTORY", by: "ADMINISTRATOR", endsOn: day("2026-11-26") }).title).toBe(
      "We cancelled Customer history for you",
    );
  });

  it("names the Add-on, never the Feature alone, so Hebrew agrees with it", () => {
    expect(
      text({ kind: "ADDON_PRICE_RISING", feature: "REMINDERS", priceFrom: 1900, priceTo: 2400, effectiveOn: day("2026-11-27") }, "he").title,
    ).toMatch(/^התוספת תזכורות עולה ל/);
    expect(text({ kind: "ADDON_PRICE_SOON", feature: "CUSTOMER_HISTORY", priceTo: 2400, effectiveOn: day("2026-10-26") }).title).toContain(
      "in 7 days",
    );
    expect(text({ kind: "ADDON_INCLUDED", feature: "CUSTOMER_HISTORY", plan: "TEAM" }).title).toBe("Customer history is now included in Team");
    expect(text({ kind: "ADDON_OFFERED", feature: "CUSTOMER_HISTORY", priceMinor: 1900 }).action).toBe("PLANS");
    expect(text({ kind: "ADDON_RISE_CANCELLED", feature: "CUSTOMER_HISTORY", priceMinor: 1900 }).action).toBeNull();
    expect(text({ kind: "ADDON_PRICE_LOWERED", feature: "CUSTOMER_HISTORY", priceFrom: 1900, priceTo: 1500 }).body).toContain("from now");
  });
});

describe("noticeDay", () => {
  const at = (createdAt: string, today = "2026-10-19") =>
    noticeDay({ createdAt }, { ...context("en", today), timeZone: "Asia/Jerusalem" });

  it("says today and yesterday in words, and anything older as a date", () => {
    expect(at("2026-10-19T05:00:00.000Z")).toBe("Today");
    expect(at("2026-10-18T05:00:00.000Z")).toBe("Yesterday");
    expect(at("2026-10-12T05:00:00.000Z")).toBe("12/10");
  });

  it("reads the day in the Business's zone, not the server's", () => {
    // 22:30 UTC on the 18th is already the 19th in Israel.
    expect(at("2026-10-18T22:30:00.000Z")).toBe("Today");
  });
});
