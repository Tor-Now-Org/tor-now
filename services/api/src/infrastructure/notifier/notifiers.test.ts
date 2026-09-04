import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATES, type OutboundMessage } from "../../ports/notifier.ts";
import { logNotifier } from "./log-notifier.ts";
import { twilioNotifier } from "./twilio-notifier.ts";

/**
 * The two adapters behind the Notifier port.
 *
 * The Twilio one had never run — not in a test, and not in a deployment, since
 * neither has credentials. Its WhatsApp-then-SMS fallback and its failure
 * reporting were therefore assertions in a comment rather than behaviour, and
 * the first time anyone found out would have been the first real message.
 */
const aMessage: OutboundMessage = {
  recipientPhone: "+972501234567",
  template: TEMPLATES.bookingConfirmed,
  payload: {
    businessName: "מספרת רן",
    serviceName: "תספורת",
    startAt: "09:00",
    customerName: "דנה",
    businessPhone: "+972521110001",
  },
};

const CREDENTIALS = {
  accountSid: "AC00000000000000000000000000000000",
  authToken: "not-a-real-token",
  whatsappFrom: "+14155238886",
};

describe("the log notifier", () => {
  it("renders the message and reports it delivered", async () => {
    const lines: string[] = [];
    const result = await logNotifier((line) => lines.push(line)).deliver(aMessage);

    expect(result).toEqual({ delivered: true, via: "LOG" });
    expect(lines).toHaveLength(1);
    // The rendered text, not just the template name: a message nobody can read
    // is not a delivery, even to a log.
    expect(lines[0]).toContain("דנה");
    expect(lines[0]).toContain("תספורת");
    expect(lines[0]).toContain("+972501234567");
  });
});

describe("the Twilio notifier", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /** Records what was asked of Twilio, and answers as instructed. */
  const twilioAnswering = (...statuses: number[]) => {
    const calls: { to: string; from: string; body: string; authorization: string }[] = [];
    let call = 0;
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const form = new URLSearchParams(init.body as string);
      calls.push({
        to: form.get("To") ?? "",
        from: form.get("From") ?? "",
        body: form.get("Body") ?? "",
        authorization: String((init.headers as Record<string, string>)["Authorization"]),
      });
      const status = statuses[Math.min(call++, statuses.length - 1)] ?? 200;
      return new Response(status === 201 ? "{}" : "refused", { status });
    });
    return calls;
  };

  it("sends over WhatsApp, addressed and authorised the way Twilio expects", async () => {
    const calls = twilioAnswering(201);

    const result = await twilioNotifier(CREDENTIALS).deliver(aMessage);

    expect(result).toEqual({ delivered: true, via: "WHATSAPP" });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.to).toBe("whatsapp:+972501234567");
    expect(calls[0]?.from).toBe("whatsapp:+14155238886");
    expect(calls[0]?.body).toContain("דנה");
    expect(calls[0]?.authorization).toMatch(/^Basic /);
  });

  it("falls back to SMS when WhatsApp is refused", async () => {
    const calls = twilioAnswering(400, 201);

    const result = await twilioNotifier({ ...CREDENTIALS, smsFrom: "+15551230000" }).deliver(
      aMessage,
    );

    expect(result).toEqual({ delivered: true, via: "SMS" });
    expect(calls).toHaveLength(2);
    // The SMS goes to the bare number, not the whatsapp: form.
    expect(calls[1]?.to).toBe("+972501234567");
    expect(calls[1]?.from).toBe("+15551230000");
  });

  it("does not try SMS when no SMS number is configured", async () => {
    const calls = twilioAnswering(400);

    const result = await twilioNotifier(CREDENTIALS).deliver(aMessage);

    expect(calls).toHaveLength(1);
    expect(result.delivered).toBe(false);
  });

  it("reports every channel it tried when all of them fail", async () => {
    twilioAnswering(400, 500);

    const result = await twilioNotifier({ ...CREDENTIALS, smsFrom: "+15551230000" }).deliver(
      aMessage,
    );

    expect(result.delivered).toBe(false);
    // The worker writes this to last_error, so it has to name what went wrong
    // on each channel rather than only the last.
    if (!result.delivered) {
      expect(result.reason).toContain("WHATSAPP");
      expect(result.reason).toContain("SMS");
      expect(result.reason).toContain("400");
      expect(result.reason).toContain("500");
    }
  });
});
