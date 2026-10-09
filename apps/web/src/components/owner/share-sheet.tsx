"use client";

import { useEffect, useState } from "react";
import { Button, Critical, Sheet } from "@/components/ui.tsx";
import { DICTIONARIES } from "@/lib/i18n/dictionaries.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { cardFileName, whatsappShareLink } from "./live-summary.ts";
import { cardFile, drawCard, type CardInput } from "./qr-card.ts";

/** What the business is called and where it lives, for the message and the card. */
export type Shared = {
  readonly url: string;
  readonly name: string;
  /** The card's own language: the name's, not necessarily the app's. */
  readonly cardLanguage: "he" | "en";
  /** The main category and the address, already in the card's language. */
  readonly kind: string;
};

/** The words a share starts with, in the owner's language. */
export const shareText = (message: string, url: string): string => `${message}\n${url}`;

const COPIED_FOR_MS = 2000;

/**
 * Copying the link, saying so in place for a moment. A refused clipboard is
 * not worth a message: the link is on the screen to select by hand.
 */
export const useCopyLink = (url: string) => {
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), COPIED_FOR_MS);
    return () => window.clearTimeout(timer);
  }, [copied]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };
  return { copied, copy };
};

const fontOf = (variable: string, fallback: string): string => {
  const family = getComputedStyle(document.body).getPropertyValue(variable).trim();
  return family === "" ? fallback : `${family}, ${fallback}`;
};

type Picture = { file: File; src: string };

/** The printable card, drawn once the sheet asks for it. */
const useCardPicture = (shared: Shared, wanted: boolean) => {
  const [picture, setPicture] = useState<Picture | null>(null);
  const [failed, setFailed] = useState(false);
  const { url, name, cardLanguage, kind } = shared;

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    let src: string | null = null;
    const words = DICTIONARIES.live[cardLanguage];
    const card: CardInput = {
      url,
      name,
      kind,
      language: cardLanguage,
      words: {
        lead: cardLanguage === "he" ? "תור" : "Tor",
        trail: cardLanguage === "he" ? "פנוי" : "Panuy",
        tagline: words.cardTagline,
        steps: [words.cardStep1, words.cardStep2, words.cardStep3],
        fallback: fillText(words.cardFallback, { name }),
      },
    };
    const fonts = {
      display: fontOf("--font-rubik", "sans-serif"),
      body: fontOf("--font-heebo", "sans-serif"),
    };
    const make = async () => {
      // The faces the card is set in, loaded before anything is measured with them.
      await Promise.all(
        [`700 92px ${fonts.display}`, `500 42px ${fonts.body}`, `600 36px ${fonts.body}`].map((font) =>
          document.fonts.load(font, name).catch(() => []),
        ),
      );
      const canvas = document.createElement("canvas");
      await drawCard(canvas, card, fonts);
      const file = await cardFile(canvas, cardFileName(name));
      if (cancelled) return;
      src = URL.createObjectURL(file);
      setPicture({ file, src });
    };
    setFailed(false);
    make().catch(() => {
      if (!cancelled) setFailed(true);
    });
    return () => {
      cancelled = true;
      if (src !== null) URL.revokeObjectURL(src);
      setPicture(null);
    };
  }, [wanted, url, name, cardLanguage, kind]);

  return { picture, failed };
};

const canShareFile = (file: File): boolean =>
  typeof navigator.share === "function" &&
  typeof navigator.canShare === "function" &&
  navigator.canShare({ files: [file] });

export const WhatsAppIcon = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M3 21l1.6-4.4A8.5 8.5 0 1 1 8 19.6z" />
    <path d="M9 9.5c0 3 2.5 5.5 5.5 5.5l1-1.6-2-1-1 .8a4 4 0 0 1-1.7-1.7l.8-1-1-2z" />
  </svg>
);

export const CopyIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="8" y="8" width="12" height="12" rx="2" />
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" />
  </svg>
);

export const QrIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="3" y="3" width="7" height="7" />
    <rect x="14" y="3" width="7" height="7" />
    <rect x="3" y="14" width="7" height="7" />
    <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" />
  </svg>
);

/**
 * Sharing the business: the message with the link, WhatsApp with it written,
 * copying the link, and the printable QR card — saved to print, or sent on as
 * a picture where the device can.
 */
export const ShareSheet = ({ open, onClose, shared }: { open: boolean; onClose: () => void; shared: Shared }) => {
  const copy = useCopy("live");
  const link = useCopyLink(shared.url);
  const { picture, failed } = useCardPicture(shared, open);
  const [sharing, setSharing] = useState(false);

  const shareImage = async () => {
    if (picture === null) return;
    setSharing(true);
    try {
      await navigator.share({ files: [picture.file], title: shared.name });
    } catch {
      // Cancelling the device's sheet is not a failure.
    } finally {
      setSharing(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy="share-sheet-title">
      <div className="share-sheet">
        <h2 id="share-sheet-title">{copy.shareTitle}</h2>
        <p className="share-message">
          {copy.shareMessage}
          <br />
          <a href={shared.url} target="_blank" rel="noreferrer" dir="ltr">
            {shared.url}
          </a>
        </p>
        <div className="share-targets">
          <a
            className="share-target wa"
            href={whatsappShareLink(shareText(copy.shareMessage, shared.url))}
            target="_blank"
            rel="noreferrer"
          >
            <i><WhatsAppIcon /></i>
            {copy.shareWhatsapp}
          </a>
          <button type="button" className="share-target" onClick={() => void link.copy()}>
            <i><CopyIcon /></i>
            <span aria-live="polite">{link.copied ? copy.copied : copy.copyLink}</span>
          </button>
        </div>
        <figure className="share-card" data-language={shared.cardLanguage}>
          {picture === null ? (
            failed ? (
              <Critical>{copy.cardFailed}</Critical>
            ) : (
              <div className="share-card-wait" role="status">{copy.cardMaking}</div>
            )
          ) : (
            <img src={picture.src} alt={fillText(copy.cardPreview, { name: shared.name })} width={620} height={874} />
          )}
        </figure>
        <div className="share-actions">
          {picture !== null && (
            <a className="primary" href={picture.src} download={picture.file.name}>
              {copy.download}
            </a>
          )}
          {picture !== null && canShareFile(picture.file) && (
            <Button intent="quiet" busy={sharing} onClick={() => void shareImage()}>
              {copy.shareImage}
            </Button>
          )}
          <Button intent="quiet" onClick={onClose}>{copy.close}</Button>
        </div>
      </div>
    </Sheet>
  );
};
