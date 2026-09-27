import type { Notifier } from "../../ports/notifier.ts";
import { renderMessage } from "./templates.ts";

/**
 * ADR 0005's development and staging adapter. Not a stub: it is a complete
 * implementation of the port that happens to deliver to the log, which is what
 * lets the whole notification path run end to end with no vendor and no cost.
 */
export const logNotifier = (
  write: (line: string) => void = console.log,
  webOrigin: string | null = null,
): Notifier => ({
  async deliver(message) {
    write(
      `[notification] → ${message.recipientPhone} (${message.template}): ` +
        renderMessage(message, webOrigin),
    );
    return { delivered: true, via: "LOG", units: 1 };
  },
});
