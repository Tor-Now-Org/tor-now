import type { DeliveryChannel, Notifier } from "../../ports/notifier.ts";
import { renderTemplate } from "./templates.ts";

export type TwilioCredentials = {
  readonly accountSid: string;
  readonly authToken: string;
  readonly whatsappFrom: string;
  readonly smsFrom?: string | undefined;
};

const TWILIO_MESSAGES_URL = (accountSid: string) =>
  `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

const sendVia = async (
  credentials: TwilioCredentials,
  from: string,
  to: string,
  body: string,
): Promise<void> => {
  const response = await fetch(TWILIO_MESSAGES_URL(credentials.accountSid), {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${btoa(`${credentials.accountSid}:${credentials.authToken}`)}`,
    },
    body: new URLSearchParams({ From: from, To: to, Body: body }),
  });

  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Twilio refused the message (${response.status}): ${detail}`);
  }
};

/**
 * ADR 0005's production adapter: WhatsApp primary, SMS fallback used only when
 * WhatsApp delivery fails. The fallback is inexpensive in practice because it
 * fires on failure, not because SMS is cheap per message.
 *
 * This runs against the live Twilio API and is unexercised in this deployment,
 * which has no credentials — selecting it without them fails at boot rather
 * than at the first message.
 */
export const twilioNotifier = (credentials: TwilioCredentials): Notifier => ({
  async deliver(message) {
    const body = renderTemplate(message.template, message.payload);
    const attempts: { channel: DeliveryChannel; from: string; to: string }[] = [
      {
        channel: "WHATSAPP",
        from: `whatsapp:${credentials.whatsappFrom}`,
        to: `whatsapp:${message.recipientPhone}`,
      },
      ...(credentials.smsFrom === undefined
        ? []
        : [
            {
              channel: "SMS" as const,
              from: credentials.smsFrom,
              to: message.recipientPhone,
            },
          ]),
    ];

    const failures: string[] = [];
    for (const attempt of attempts) {
      try {
        await sendVia(credentials, attempt.from, attempt.to, body);
        return { delivered: true, via: attempt.channel };
      } catch (error) {
        failures.push(
          `${attempt.channel}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }
    return { delivered: false, reason: failures.join(" | ") };
  },
});
