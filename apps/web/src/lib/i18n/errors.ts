import type { ApiErrorCode } from "../api/errors.ts";
import type { Language } from "./dictionaries.ts";

/**
 * What the interface says when the API refuses. The server's own message is for
 * developers and is never rendered — a Hebrew-speaking customer must not be
 * shown an English sentence written for a log.
 *
 * The map is total over ApiErrorCode, so adding a code to the API is a compile
 * error here until someone decides what a person should be told about it.
 */
const MESSAGES: Readonly<
  Record<Language, Readonly<Record<ApiErrorCode, string>>>
> = Object.freeze({
  he: {
    VALIDATION_FAILED: "משהו בפרטים לא תקין. בדקו ונסו שוב.",
    UNAUTHENTICATED: "צריך להתחבר כדי להמשיך.",
    FORBIDDEN: "אין לכם הרשאה לפעולה הזאת.",
    NOT_FOUND: "לא מצאנו את מה שחיפשתם.",
    CONFLICT: "הפעולה מתנגשת עם משהו קיים.",
    // Reached only if the question is somehow skipped; the booking screen asks
    // rather than showing this.
    ALREADY_BOOKED_THAT_DAY: "כבר יש לכם תור לשירות הזה באותו יום.",
    OVERLAPS_ANOTHER_APPOINTMENT: "כבר יש לכם תור בשעה הזאת.",
    SLOT_TAKEN: "מישהו הקדים אתכם לשעה הזאת. בחרו שעה אחרת — עדכנו את הרשימה.",
    ALREADY_CANCELLED: "התור הזה כבר בוטל.",
    ALREADY_STARTED: "התור כבר התחיל — אי אפשר להזיז אותו, רק לבטל או לסמן שלא הגיעו.",
    OUTSIDE_BOOKING_WINDOW: "השעה הזאת מחוץ לטווח שהעסק מקבל בו תורים.",
    OUTSIDE_WORKING_HOURS: "השעה הזאת כבר לא פנויה. עדכנו את הרשימה.",
    BUSINESS_INACTIVE: "העסק לא מקבל תורים חדשים כרגע.",
    VERIFICATION_FAILED: "הקוד לא נכון או שפג תוקפו. בקשו קוד חדש.",
    RATE_LIMITED: "נשלחו יותר מדי בקשות. נסו שוב בעוד כמה דקות.",
    INTERNAL: "משהו השתבש אצלנו. נסו שוב.",
    NETWORK: "אין חיבור לשרת. בדקו את הרשת ונסו שוב.",
  },
  en: {
    VALIDATION_FAILED: "Something in those details is not valid. Check and try again.",
    UNAUTHENTICATED: "You need to sign in to continue.",
    FORBIDDEN: "You do not have permission to do that.",
    NOT_FOUND: "We could not find what you were looking for.",
    CONFLICT: "That conflicts with something that already exists.",
    ALREADY_BOOKED_THAT_DAY: "You already have an appointment for this service that day.",
    OVERLAPS_ANOTHER_APPOINTMENT: "You already have an appointment at that time.",
    SLOT_TAKEN: "Someone took that time while you were confirming. Pick another — the list is up to date.",
    ALREADY_CANCELLED: "That appointment has already been cancelled.",
    ALREADY_STARTED: "That appointment has already started — it can be cancelled or marked a no show, but not moved.",
    OUTSIDE_BOOKING_WINDOW: "That time is outside the period this business accepts bookings for.",
    OUTSIDE_WORKING_HOURS: "That time is no longer available. The list has been refreshed.",
    BUSINESS_INACTIVE: "This business is not accepting new bookings right now.",
    VERIFICATION_FAILED: "That code is wrong or has expired. Ask for a new one.",
    RATE_LIMITED: "Too many requests. Try again in a few minutes.",
    INTERNAL: "Something went wrong on our side. Please try again.",
    NETWORK: "No connection to the server. Check your network and try again.",
  },
});

export const errorMessage = (language: Language, code: string): string => {
  const forLanguage = MESSAGES[language];
  return forLanguage[code as ApiErrorCode] ?? forLanguage.INTERNAL;
};
