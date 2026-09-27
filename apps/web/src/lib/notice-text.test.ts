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
