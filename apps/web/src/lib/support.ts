/**
 * Where support actually happens.
 *
 * WhatsApp rather than a form of our own: it is the channel this product
 * already speaks on (ADR 0005), it works the moment somebody taps it, and a
 * conversation there survives the person closing the page — which a ticket in a
 * database they cannot see does not.
 *
 * Both of these are configuration, because they change when the team does and
 * neither belongs in a component. The fallbacks are placeholders so the page
 * renders in a preview with nothing set; NEXT_PUBLIC_SUPPORT_WHATSAPP and
 * NEXT_PUBLIC_SUPPORT_EMAIL must be set per environment before anybody is
 * invited to use them.
 */
export const SUPPORT = Object.freeze({
  whatsapp: process.env["NEXT_PUBLIC_SUPPORT_WHATSAPP"] ?? "+972500000000",
  email: process.env["NEXT_PUBLIC_SUPPORT_EMAIL"] ?? "help@torpanuy.co.il",
});

/** wa.me wants the number without its plus or its spaces. */
export const whatsappLink = (message?: string): string => {
  const number = SUPPORT.whatsapp.replace(/[^0-9]/g, "");
  const text = message === undefined || message.trim() === "" ? "" : `?text=${encodeURIComponent(message)}`;
  return `https://wa.me/${number}${text}`;
};

export const emailLink = (subject: string, body: string): string =>
  `mailto:${SUPPORT.email}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
