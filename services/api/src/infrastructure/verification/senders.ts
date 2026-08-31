import type { VerificationSender } from "../../ports/verification.ts";
import type { TwilioCredentials } from "../notifier/twilio-notifier.ts";

/**
 * ADR 0004 makes the code the entire credential, so where it is delivered is a
 * security decision rather than a convenience. This adapter delivers it to the
 * log, which is correct for development and unacceptable anywhere a log is not
 * private — hence the configuration refusing to combine it with a real
 * deployment's transports.
 */
export const logVerificationSender = (
  write: (line: string) => void = console.log,
): VerificationSender => ({
  channel: "LOG",
  async send(phone, code) {
    write(`[verification] ${phone} → ${code}`);
  },
});

/**
 * ADR 0005 prices authentication templates as Meta's cheapest category, which
 * is why verification goes out over WhatsApp rather than SMS by default. SMS is
 * the fallback, not the primary.
 */
export const twilioVerificationSender = (
  credentials: TwilioCredentials,
  channel: "WHATSAPP" | "SMS",
): VerificationSender => ({
  channel,
  async send(phone, code) {
    const from =
      channel === "WHATSAPP"
        ? `whatsapp:${credentials.whatsappFrom}`
        : (credentials.smsFrom ?? credentials.whatsappFrom);
    const to = channel === "WHATSAPP" ? `whatsapp:${phone}` : phone;

    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${credentials.accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${btoa(`${credentials.accountSid}:${credentials.authToken}`)}`,
        },
        body: new URLSearchParams({
          From: from,
          To: to,
          Body: `קוד האימות שלך ל־תורNow: ${code}`,
        }),
      },
    );

    if (!response.ok) {
      throw new Error(
        `Twilio refused the verification code (${response.status}): ${await response.text()}`,
      );
    }
  },
});
