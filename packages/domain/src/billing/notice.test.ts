import { describe, expect, it } from "vitest";
import { asId } from "../model/ids.ts";
import { instant } from "../time/instant.ts";
import { parseLocalDate } from "../time/local-date.ts";
import {
  bannerOf,
  goesToWhatsApp,
  isSentOnWhatsApp,
  isStanding,
  NOTICE_KINDS,
  noticeKey,
  noticesCleared,
  noticesDue,
  noticeTone,
  parseNoticeFacts,
  standsAsBanner,
  type Notice,
  type NoticeFacts,
} from "./notice.ts";

const day = parseLocalDate;
const today = day("2026-10-19");

let sequence = 0;
const aNotice = (facts: NoticeFacts, overrides: Partial<Notice> = {}): Notice => {
  sequence += 1;
  return {
    id: asId(`notice-${sequence}`),
    businessId: asId("business"),
    facts,
    createdAt: instant(1_000_000 + sequence),
    readAt: null,
    clearedAt: null,
    ...overrides,
  };
};

describe("what goes to WhatsApp", () => {
  it("is exactly what is about paying", () => {
    expect(NOTICE_KINDS.filter(goesToWhatsApp)).toEqual([
      "TRIAL_ENDING",
      "PAYMENT_LATE",
      "DEACTIVATED",
      "PAYMENT_RECORDED",
      "EDITION_ANNOUNCED",
      "EDITION_CANCELLED",
      "PREVIEW_LEAVING",
      "ADDON_PRICE_RISING",
      "ADDON_RISE_CANCELLED",
    ]);
  });

  it("narrows a Notice's facts to one sent on WhatsApp", () => {
    expect(isSentOnWhatsApp({ kind: "PAYMENT_LATE", graceEndsOn: day("2026-11-07") })).toBe(true);
    expect(isSentOnWhatsApp({ kind: "EDITION_CANCELLED", plan: "SOLO" })).toBe(true);
    expect(isSentOnWhatsApp({ kind: "PLAN_IMPROVED", plan: "SOLO", priceFrom: 4900, priceTo: 3900, allowanceFrom: 1, allowanceTo: 1, gained: [] })).toBe(false);
    expect(isSentOnWhatsApp({ kind: "CALENDARS_RESUMED", names: [] })).toBe(false);
  });
});

describe("how each kind is drawn", () => {
  it("stands as a banner only when it needs a look", () => {
    expect(NOTICE_KINDS.filter((kind) => !standsAsBanner(kind))).toEqual([
      "PAYMENT_RECORDED",
      "PLAN_CHANGED",
      "MOVE_SCHEDULED",
      "GRANT_EXTENDED",
      "PREVIEW_EXTENDED",
      "ADDON_ADDED",
      "ADDON_CANCELLED",
    ]);
  });

  it("is critical only when the business left search", () => {
    expect(NOTICE_KINDS.filter((kind) => noticeTone(kind) === "critical")).toEqual(["DEACTIVATED"]);
  });

  it("lets a payment settle every standing Notice about paying", () => {
    expect(noticesCleared("PAYMENT_RECORDED")).toEqual([
      "TRIAL_STARTED",
      "TRIAL_ENDING",
      "PAYMENT_LATE",
      "DEACTIVATED",
    ]);
    expect(noticesCleared("CALENDARS_RESUMED")).toEqual(["CALENDARS_PAUSED"]);
    expect(noticesCleared("MOVE_APPLIED")).toEqual(["MOVE_SOON"]);
  });
});

describe("noticeKey", () => {
  it("makes a situation seen again the same Notice", () => {
    expect(noticeKey({ kind: "TRIAL_ENDING", trialEndsOn: day("2026-10-26") })).toBe(
      "TRIAL_ENDING:2026-10-26",
    );
    expect(noticeKey({ kind: "PAYMENT_LATE", graceEndsOn: day("2026-11-07") })).toBe(
      "PAYMENT_LATE:2026-11-07",
    );
    expect(noticeKey({ kind: "DEACTIVATED", on: today })).toBe("DEACTIVATED:2026-10-19");
    expect(noticeKey({ kind: "MOVE_SOON", plan: "SOLO", effectiveOn: day("2026-10-24"), pausing: [] })).toBe(
      "MOVE_SOON:SOLO:2026-10-24",
    );
  });

  it("gives a Trial one start, whatever its dates", () => {
    expect(noticeKey({ kind: "TRIAL_STARTED", plan: "TEAM", trialEndsOn: day("2026-10-26") })).toBe(
      "TRIAL_STARTED",
    );
  });

  it("gives an event none, because it happens once by its nature", () => {
    expect(noticeKey({ kind: "PAYMENT_RECORDED", paidThrough: day("2026-11-23") })).toBeNull();
    expect(noticeKey({ kind: "CALENDARS_RESUMED", names: ["דנה"] })).toBeNull();
  });
});

describe("bannerOf", () => {
  it("shows nothing when nothing stands", () => {
    expect(bannerOf([])).toBeNull();
    expect(bannerOf([aNotice({ kind: "PAYMENT_RECORDED", paidThrough: today })])).toBeNull();
    expect(
      bannerOf([aNotice({ kind: "TRIAL_ENDING", trialEndsOn: today }, { clearedAt: instant(5) })]),
    ).toBeNull();
  });

  it("shows what costs the most to miss, and counts the other unread ones", () => {
    const started = aNotice({ kind: "TRIAL_STARTED", plan: "TEAM", trialEndsOn: today });
    const ending = aNotice({ kind: "TRIAL_ENDING", trialEndsOn: today });
    const paused = aNotice({ kind: "CALENDARS_PAUSED", names: ["דנה"], resourceAllowance: 1 });
    const read = aNotice({ kind: "PLAN_CHANGED", plan: "SOLO", by: "OWNER", priceMinor: 4900, resourceAllowance: 1, gained: [], lost: [] }, { readAt: instant(9) });

    const banner = bannerOf([started, paused, ending, read]);

    expect(banner?.notice.id).toBe(ending.id);
    expect(banner?.othersUnread).toBe(2);
  });

  it("shows the newer of two of a kind", () => {
    const older = aNotice({ kind: "CALENDARS_RESUMED", names: ["דנה"] });
    const newer = aNotice({ kind: "CALENDARS_RESUMED", names: ["יוסי"] });
    expect(bannerOf([older, newer])?.notice.id).toBe(newer.id);
  });

  it("stops standing once cleared, while staying in the list", () => {
    const notice = aNotice({ kind: "DEACTIVATED", on: today });
    expect(isStanding(notice)).toBe(true);
    expect(isStanding({ ...notice, clearedAt: instant(1) })).toBe(false);
  });
});

describe("noticesDue", () => {
  const input = (overrides: Partial<Parameters<typeof noticesDue>[0]> = {}) => ({
    subscription: { trialEndsOn: null, paidThrough: day("2026-11-01"), scheduledMove: null },
    scheduledPlan: null,
    pausing: [],
    currentPlan: "TEAM" as const,
    grants: [],
    previewsLeaving: [],
    addonRises: [],
    businessActive: true,
    today,
    ...overrides,
  });

  it("says nothing about a paid Business with nothing coming", () => {
    expect(noticesDue(input())).toEqual([]);
  });

  it("warns of a Trial's end a week ahead, and on each day after until it ends", () => {
    const ending = (trialEndsOn: string) =>
      noticesDue(input({ subscription: { trialEndsOn: day(trialEndsOn), paidThrough: null, scheduledMove: null } }));
    expect(ending("2026-10-27")).toEqual([]);
    expect(ending("2026-10-26")).toEqual([{ kind: "TRIAL_ENDING", trialEndsOn: "2026-10-26" }]);
    expect(ending("2026-10-19")).toEqual([{ kind: "TRIAL_ENDING", trialEndsOn: "2026-10-19" }]);
    // Over and unpaid: the Business is deactivated, which says so itself.
    expect(ending("2026-10-18")).toEqual([]);
  });

  it("says a payment is late through the Grace Period, dated by its last day", () => {
    const late = noticesDue(
      input({ subscription: { trialEndsOn: null, paidThrough: day("2026-10-18"), scheduledMove: null } }),
    );
    expect(late).toEqual([{ kind: "PAYMENT_LATE", graceEndsOn: "2026-11-01" }]);
  });

  it("warns of a scheduled move a week ahead, but not on its own day", () => {
    const moving = (effectiveOn: string) =>
      noticesDue(
        input({
          subscription: {
            trialEndsOn: null,
            paidThrough: day("2026-11-01"),
            scheduledMove: { planVersionId: asId("solo"), effectiveOn: day(effectiveOn) },
          },
          scheduledPlan: "SOLO",
          pausing: ["דנה"],
        }),
      );
    expect(moving("2026-10-27")).toEqual([]);
    expect(moving("2026-10-26")).toEqual([
      { kind: "MOVE_SOON", plan: "SOLO", effectiveOn: "2026-10-26", pausing: ["דנה"] },
    ]);
    expect(moving("2026-10-19")).toEqual([]);
  });

  it("reminds of a move onto a new edition of the Plan held as the Catalogue's, not the owner's", () => {
    const due = noticesDue(
      input({
        currentPlan: "SOLO",
        scheduledPlan: "SOLO",
        subscription: {
          trialEndsOn: null,
          paidThrough: day("2026-11-01"),
          scheduledMove: { planVersionId: asId("solo-2"), effectiveOn: day("2026-10-26") },
        },
      }),
    );
    expect(due).toEqual([{ kind: "EDITION_SOON", plan: "SOLO", effectiveOn: "2026-10-26" }]);
    expect(noticeKey(due[0] as NoticeFacts)).toBe("EDITION_SOON:SOLO:2026-10-26");
  });

  it("reminds a week ahead of Grants ending, once per day they end, naming all of them", () => {
    const due = noticesDue(
      input({
        grants: [
          { feature: "TEAM_ROLES", endsOn: day("2026-10-26") },
          { feature: "CUSTOMER_HISTORY", endsOn: day("2026-10-26") },
          { feature: "CUSTOMER_BLOCKING", endsOn: day("2026-10-20") },
          { feature: "WAITING_LIST", endsOn: day("2026-10-27") },
          { feature: "REMINDERS", endsOn: day("2026-10-18") },
        ],
      }),
    );
    expect(due).toEqual([
      { kind: "GRANT_ENDING", features: ["CUSTOMER_BLOCKING"], endsOn: "2026-10-20" },
      { kind: "GRANT_ENDING", features: ["CUSTOMER_HISTORY", "TEAM_ROLES"], endsOn: "2026-10-26" },
    ]);
    expect(noticeKey(due[1] as NoticeFacts)).toBe("GRANT_ENDING:2026-10-26:CUSTOMER_HISTORY,TEAM_ROLES");
  });

  it("reminds a week before a Preview's Feature leaves the Plan held", () => {
    const leaving = (endsOn: string) =>
      noticesDue(input({ previewsLeaving: [{ feature: "WAITING_LIST", endsOn: day(endsOn) }] }));
    expect(leaving("2026-10-27")).toEqual([]);
    expect(leaving("2026-10-26")).toEqual([{ kind: "PREVIEW_ENDING", feature: "WAITING_LIST", endsOn: "2026-10-26" }]);
  });

  it("reminds a week before an Add-on's new price reaches the Business, not on its own day", () => {
    const rising = (effectiveOn: string) =>
      noticesDue(input({ addonRises: [{ feature: "CUSTOMER_HISTORY", priceTo: 2400, effectiveOn: day(effectiveOn) }] }));
    expect(rising("2026-10-27")).toEqual([]);
    expect(rising("2026-10-26")).toEqual([
      { kind: "ADDON_PRICE_SOON", feature: "CUSTOMER_HISTORY", priceTo: 2400, effectiveOn: "2026-10-26" },
    ]);
    expect(rising("2026-10-19")).toEqual([]);
    expect(noticeKey({ kind: "ADDON_PRICE_SOON", feature: "CUSTOMER_HISTORY", priceTo: 2400, effectiveOn: day("2026-10-26") })).toBe(
      "ADDON_PRICE_SOON:CUSTOMER_HISTORY:2026-10-26",
    );
  });

  it("says nothing to a Business that is switched off", () => {
    expect(
      noticesDue(
        input({
          businessActive: false,
          subscription: { trialEndsOn: null, paidThrough: day("2026-10-18"), scheduledMove: null },
        }),
      ),
    ).toEqual([]);
  });
});

describe("parseNoticeFacts", () => {
  const every: readonly NoticeFacts[] = [
    { kind: "TRIAL_STARTED", plan: "TEAM", trialEndsOn: day("2026-10-26") },
    { kind: "TRIAL_ENDING", trialEndsOn: day("2026-10-26") },
    { kind: "PAYMENT_LATE", graceEndsOn: day("2026-11-07") },
    { kind: "DEACTIVATED", on: today },
    { kind: "PAYMENT_RECORDED", paidThrough: day("2026-11-23") },
    {
      kind: "PLAN_CHANGED",
      plan: "TEAM",
      by: "ADMINISTRATOR",
      priceMinor: 8900,
      resourceAllowance: 5,
      gained: ["CUSTOMER_HISTORY", "TEAM_ROLES"],
      lost: [],
    },
    { kind: "MOVE_SCHEDULED", plan: "SOLO", by: "OWNER", effectiveOn: day("2026-10-24"), pausing: ["דנה", "יוסי"] },
    { kind: "MOVE_SOON", plan: "SOLO", effectiveOn: day("2026-10-24"), pausing: [] },
    { kind: "MOVE_APPLIED", plan: "SOLO", paused: ["דנה"] },
    { kind: "CALENDARS_PAUSED", names: ["דנה"], resourceAllowance: 1 },
    { kind: "CALENDARS_RESUMED", names: ["דנה"] },
    { kind: "FEATURES_GRANTED", features: ["CUSTOMER_HISTORY", "CUSTOMER_BLOCKING"], endsOn: day("2026-12-26") },
    { kind: "GRANT_EXTENDED", feature: "TEAM_ROLES", endsOn: day("2026-11-01") },
    { kind: "GRANT_ENDING", features: ["TEAM_ROLES"], endsOn: day("2026-10-02") },
    { kind: "GRANT_ENDED", feature: "TEAM_ROLES" },
    {
      kind: "EDITION_ANNOUNCED",
      plan: "SOLO",
      effectiveOn: day("2026-10-28"),
      priceFrom: 4900,
      priceTo: 5900,
      allowanceFrom: 1,
      allowanceTo: 1,
      gained: [],
      lost: ["REMINDERS"],
    },
    { kind: "EDITION_SOON", plan: "SOLO", effectiveOn: day("2026-10-28") },
    { kind: "EDITION_APPLIED", plan: "SOLO" },
    { kind: "EDITION_CANCELLED", plan: "SOLO" },
    { kind: "PLAN_IMPROVED", plan: "TEAM", priceFrom: 8900, priceTo: 8900, allowanceFrom: 5, allowanceTo: 8, gained: [] },
    { kind: "PREVIEW_STARTED", feature: "CUSTOMER_HISTORY", endsOn: day("2026-12-26") },
    { kind: "PREVIEW_EXTENDED", feature: "CUSTOMER_HISTORY", endsOn: day("2027-01-26") },
    { kind: "PREVIEW_KEPT", feature: "WAITING_LIST", plan: "TEAM" },
    { kind: "PREVIEW_LEAVING", feature: "WAITING_LIST", plan: "SOLO", endsOn: day("2026-11-25"), addonPriceMinor: 1500 },
    { kind: "PREVIEW_ENDING", feature: "WAITING_LIST", endsOn: day("2026-11-25") },
    { kind: "ADDON_OFFERED", feature: "CUSTOMER_HISTORY", priceMinor: 1900 },
    { kind: "ADDON_ADDED", feature: "CUSTOMER_HISTORY", by: "OWNER", priceMinor: 1900, paysFrom: day("2026-11-27"), owedMinor: 950 },
    { kind: "ADDON_CANCELLED", feature: "CUSTOMER_HISTORY", by: "ADMINISTRATOR", endsOn: day("2026-11-26") },
    { kind: "ADDON_PRICE_RISING", feature: "CUSTOMER_HISTORY", priceFrom: 1900, priceTo: 2400, effectiveOn: day("2026-11-27") },
    { kind: "ADDON_PRICE_SOON", feature: "CUSTOMER_HISTORY", priceTo: 2400, effectiveOn: day("2026-11-27") },
    { kind: "ADDON_RISE_CANCELLED", feature: "CUSTOMER_HISTORY", priceMinor: 1900 },
    { kind: "ADDON_PRICE_LOWERED", feature: "CUSTOMER_HISTORY", priceFrom: 1900, priceTo: 1500 },
    { kind: "ADDON_INCLUDED", feature: "CUSTOMER_HISTORY", plan: "SOLO" },
  ];

  it("reads back every kind exactly as it was written", () => {
    expect(every.map((facts) => facts.kind)).toEqual(NOTICE_KINDS);
    for (const facts of every) {
      expect(parseNoticeFacts(JSON.parse(JSON.stringify(facts)))).toEqual(facts);
    }
  });

  it("reads a Preview leaving told before Add-ons as offering none", () => {
    expect(
      parseNoticeFacts({ kind: "PREVIEW_LEAVING", feature: "WAITING_LIST", plan: "SOLO", endsOn: "2026-11-25" }),
    ).toEqual({ kind: "PREVIEW_LEAVING", feature: "WAITING_LIST", plan: "SOLO", endsOn: "2026-11-25", addonPriceMinor: null });
  });

  it("refuses what it cannot read, saying what is wrong", () => {
    expect(() => parseNoticeFacts(null)).toThrow(/not an object/);
    expect(() => parseNoticeFacts({ kind: "SOMETHING" })).toThrow(/Unknown kind/);
    expect(() => parseNoticeFacts({ kind: "TRIAL_ENDING" })).toThrow(/missing "trialEndsOn"/);
    expect(() => parseNoticeFacts({ kind: "TRIAL_ENDING", trialEndsOn: 5 })).toThrow(/not text/);
    expect(() => parseNoticeFacts({ kind: "TRIAL_STARTED", plan: "GOLD", trialEndsOn: "2026-10-26" })).toThrow(
      /Unknown plan/,
    );
    expect(() =>
      parseNoticeFacts({ kind: "MOVE_SCHEDULED", plan: "SOLO", by: "ROBOT", effectiveOn: "2026-10-24", pausing: [] }),
    ).toThrow(/Unknown mover/);
    expect(() => parseNoticeFacts({ kind: "CALENDARS_RESUMED", names: [1] })).toThrow(/list of names/);
    expect(() => parseNoticeFacts({ kind: "CALENDARS_PAUSED", names: [], resourceAllowance: -1 })).toThrow(
      /not a count/,
    );
    expect(() =>
      parseNoticeFacts({
        kind: "PLAN_CHANGED",
        plan: "TEAM",
        by: "OWNER",
        priceMinor: 8900,
        resourceAllowance: 5,
        gained: ["TELEPORTING"],
        lost: [],
      }),
    ).toThrow(/Unknown feature/);
  });
});
