import { bufferForBooking } from "@tor-now/domain";

/**
 * A service's Buffer as the owner reads it: how many minutes the calendar
 * keeps after each appointment, and whether that is the business's default or
 * the service's own. The number is the domain's own rule, so the screen can
 * never promise a different time from the one availability keeps.
 */
export type ServiceBuffer = { readonly minutes: number; readonly follows: boolean };

export const bufferOf = (own: number | null, businessDefault: number): ServiceBuffer => ({
  minutes: bufferForBooking(own, { defaultBufferMinutes: businessDefault }),
  follows: own === null,
});

/**
 * The services a customer can book, each with the time it keeps — what the
 * business default's field has to say about who it reaches.
 */
export const followersOf = (
  services: readonly { id: string; name: string; bufferMinutes: number | null; active: boolean }[],
  businessDefault: number,
) =>
  services
    .filter((service) => service.active)
    .map((service) => ({ id: service.id, name: service.name, ...bufferOf(service.bufferMinutes, businessDefault) }));
