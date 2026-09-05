"use client";

/**
 * Reaching a customer: ring them, or message them.
 *
 * Both were a transcription job — read the number off the screen, type it into
 * the phone, hope. The number itself is shown once, above, by whichever screen
 * this sits on; these are the two things done with it, as marks rather than
 * words, with the number in each label so a screen reader says which number it
 * is about.
 *
 * WhatsApp is offered for every number rather than only where we know it
 * exists: the system stores no such fact about a customer, and wa.me answers
 * honestly for a number that is not registered. Hiding it on a guess would
 * cost the owner the channel most of their customers actually use.
 */
export const PhoneActions = ({
  phone,
  labels,
}: {
  phone: string;
  labels: { call: string; whatsapp: string };
}) => (
  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
    <a
      href={`tel:${phone}`}
      className="chip tap"
      aria-label={`${labels.call} ${phone}`}
      title={labels.call}
      style={{ ...MARK, color: "var(--accent-strong)" }}
    >
      <CallMark />
    </a>
    <a
      href={`https://wa.me/${phone.replace(/\D/g, "")}`}
      target="_blank"
      rel="noreferrer"
      className="chip tap"
      aria-label={`${labels.whatsapp} ${phone}`}
      title={labels.whatsapp}
      style={{ ...MARK, color: "var(--positive)" }}
    >
      <WhatsAppMark />
    </a>
  </div>
);

/** One square per action, on the page's own surface. */
const MARK = Object.freeze({
  width: 44,
  padding: 0,
  border: "1px solid var(--line)",
  background: "var(--raised)",
});

const CallMark = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden="true">
    <path
      d="M6.5 4h3l1.5 4-2 1.5a11 11 0 0 0 5.5 5.5L16 13l4 1.5v3a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4Z"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinejoin="round"
    />
  </svg>
);

const WhatsAppMark = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
    <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
  </svg>
);
