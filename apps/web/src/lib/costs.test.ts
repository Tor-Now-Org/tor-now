import { describe, expect, it } from "vitest";
import {
  agorotOf,
  calculatorInputs,
  countOf,
  formatAgorot,
  formatCost,
  formatMargin,
  marginTone,
  orderedSources,
  percentOf,
  sameUse,
  shekelsText,
  toneOf,
  withCount,
} from "./costs.ts";
import type { CalculatorUseDto } from "./api/cost-types.ts";

const USE: CalculatorUseDto = {
  calendars: 2,
  BOOKING: { whatsapp: 238, sms: 3 },
  REMINDERS: { whatsapp: 197, sms: 2 },
  WAITING_LIST: { whatsapp: 6, sms: 0 },
  BILLING: { whatsapp: 2, sms: 0 },
};

describe("showing a cost", () => {
  it("rounds micro-shekels to the agora only when shown", () => {
    expect(formatCost(18_214_730, "en")).toBe("₪18.21");
    expect(formatCost(18_215_000, "en")).toBe("₪18.22");
    expect(formatCost(0, "en")).toBe("₪0.00");
    expect(formatAgorot(9_250, "en")).toBe("₪92.50");
    expect(formatAgorot(426, "en")).toBe("₪4.26");
    expect(formatAgorot(12_000, "en")).toBe("₪120");
    expect(formatAgorot(0, "en")).toBe("₪0");
  });

  it("shows a margin as a whole percent, and nothing as a dash", () => {
    expect(formatMargin(0.689, "en")).toBe("69%");
    expect(formatMargin(-0.13, "en")).toBe("-13%");
    expect(formatMargin(null, "en")).toBe("—");
  });

  it("keeps a margin's minus sign before the number in Hebrew, however the line runs", () => {
    const shown = formatMargin(-0.18, "he");
    // The locale marks the number left-to-right, so the minus stays in front of it.
    expect(shown.replace(/[\u200e\u200f]/g, "")).toBe("-18%");
    expect(shown.startsWith("\u200e")).toBe(true);
  });

  it("asks for a look below 40%, and warns below zero", () => {
    expect(marginTone(0.8)).toBe("positive");
    expect(marginTone(0.4)).toBe("positive");
    expect(marginTone(0.39)).toBe("caution");
    expect(marginTone(-0.01)).toBe("critical");
    expect(marginTone(null)).toBe("muted");
  });

  it("gives a share of nothing as nothing", () => {
    expect(percentOf(1, 3)).toBe(33);
    expect(percentOf(5, 0)).toBe(0);
  });
});

describe("reading what is typed", () => {
  it("reads shekels to the agora, digit by digit", () => {
    expect(agorotOf("92.5")).toBe(9_250);
    expect(agorotOf(" 4.26 ")).toBe(426);
    expect(agorotOf("120")).toBe(12_000);
    expect(agorotOf("0")).toBe(0);
    for (const wrong of ["", "4.261", "-1", "1,5", "abc", "1234567"]) expect(agorotOf(wrong)).toBeNull();
    expect(shekelsText(426)).toBe("4.26");
  });

  it("reads whole counts only", () => {
    expect(countOf("300")).toBe(300);
    expect(countOf(" 0 ")).toBe(0);
    for (const wrong of ["", "1.5", "-2", "x"]) expect(countOf(wrong)).toBeNull();
  });
});

describe("the calculator's numbers", () => {
  it("tells a changed use from the same one", () => {
    expect(sameUse(USE, { ...USE })).toBe(true);
    expect(sameUse(USE, withCount(USE, "REMINDERS", "sms", 3))).toBe(false);
    expect(sameUse(USE, { ...USE, calendars: 3 })).toBe(false);
  });

  it("changes one number and leaves the others", () => {
    const changed = withCount(USE, "BOOKING", "whatsapp", 500);
    expect(changed.BOOKING).toEqual({ whatsapp: 500, sms: 3 });
    expect(changed.REMINDERS).toBe(USE.REMINDERS);
  });

  it("hands the domain its rates, Plans and share, keeping a missing rate missing", () => {
    const inputs = calculatorInputs({
      rates: { whatsapp: null, smsPart: 952_750, partsPerSms: 2.3 },
      plans: [{ plan: "SOLO", priceMinor: 4_900, allowance: 1 }],
      share: null,
      actualAverage: null,
      mostExpensive: null,
      saved: [],
    });
    expect(inputs).toEqual({
      rates: { whatsapp: null, smsPart: 952_750, partsPerSms: 2.3 },
      plans: [{ plan: "SOLO", price: 4_900, allowance: 1 }],
      share: null,
    });
  });

  it("orders causes as shown, with any other after, each in its colour", () => {
    expect(orderedSources({ WAITING_LIST: 1, CUSTOMER_HISTORY: 2, BOOKING: 3 })).toEqual([
      "BOOKING",
      "WAITING_LIST",
      "CUSTOMER_HISTORY",
    ]);
    expect(toneOf("BOOKING")).toBe("var(--accent)");
    expect(toneOf("CUSTOMER_HISTORY")).toBe("var(--muted)");
  });
});
