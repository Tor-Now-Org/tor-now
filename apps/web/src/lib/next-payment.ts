import { addDays, compareLocalDate, daysBetween, parseLocalDate } from "@tor-now/domain";
import type { AddonDto, DaysOwedDto, FeatureName, PaymentBoardDto } from "@/lib/api/types.ts";

/**
 * What the owner's next payment comes to, before and after a tap (ADR 0021).
 * The server works the payment out; these only say how one Add-on moves it, so
 * a sheet can show the new sum before anything is pressed.
 */

type NextPayment = PaymentBoardDto["nextPayment"];

/** The payment board a billing panel carries — absent from an API older than Add-ons. */
export const paymentBoardOf = (billing: Partial<PaymentBoardDto>): PaymentBoardDto | null =>
  billing.addons === undefined || billing.nextPayment === undefined || billing.moveUpOwed === undefined
    ? null
    : { addons: billing.addons, nextPayment: billing.nextPayment, moveUpOwed: billing.moveUpOwed };

/** The Plan and every Add-on: what each month costs, one-off days aside. */
export const monthlyTotal = (payment: NextPayment): number =>
  payment.lines.reduce((sum, line) => (line.kind === "DAYS" ? sum : sum + line.amountMinor), 0);

/** The next payment once this Add-on is added: its price if it is paid by then, and any days owed. */
export const totalAfterAdding = (payment: NextPayment, addon: Pick<AddonDto, "priceMinor" | "ifAdded">): number => {
  if (addon.ifAdded === null) return payment.totalMinor;
  const paidBy = compareLocalDate(parseLocalDate(addon.ifAdded.paysFrom), parseLocalDate(payment.on)) <= 0;
  return payment.totalMinor + (paidBy ? addon.priceMinor : 0) + (addon.ifAdded.owed?.amountMinor ?? 0);
};

/** The next payment once this Add-on is cancelled: without its line. */
export const totalAfterCancelling = (payment: NextPayment, feature: FeatureName): number =>
  payment.totalMinor -
  payment.lines.reduce((sum, line) => (line.kind === "ADDON" && line.feature === feature ? sum + line.amountMinor : sum), 0);

/** A cancelled Add-on runs to the day before the next payment: the end of what is paid for. */
export const lastPaidDay = (payment: NextPayment): string => addDays(parseLocalDate(payment.on), -1);

/** How many days are owed, both ends included. */
export const daysOf = (owed: DaysOwedDto): number =>
  daysBetween(parseLocalDate(owed.from), parseLocalDate(owed.through)) + 1;
