import type { Notifier } from "../../ports/notifier.ts";
import { renderTemplate } from "./templates.ts";

/**
 * ADR 0005's development and staging adapter. Not a stub: it is a complete
 * implementation of the port that happens to deliver to the log, which is what
 * lets the whole notification path run end to end with no vendor and no cost.
 */
export const logNotifier = (
  write: (line: string) => void = console.log,
): Notifier => ({
  async deliver(message) {
    write(
      `[notification] → ${message.recipientPhone} (${message.template}): ` +
        renderTemplate(message.template, message.payload),
    );
    return { delivered: true, via: "LOG" };
  },
});
