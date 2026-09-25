"use client";

import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { PHOTO_SLOTS } from "@tor-now/domain";
import { API_BASE_URL } from "@/lib/api/client.ts";
import type { BusinessPhotoDto } from "@/lib/api/types.ts";

/**
 * What a business looks like, above what it offers.
 *
 * One photo at a time at the page's full width, cover first, and the rest a
 * swipe or an arrow away. The swiping is the browser's own scroll-snap, so it
 * has the phone's physics and follows the page's direction without a line of
 * code: in Hebrew the cover is on the right and "next" is to the left. Tapping
 * a photo opens the same carousel full screen. A business with only a cover
 * gets a plain picture, and one with no photos at all renders nothing rather
 * than a placeholder — an empty frame says less than the name does.
 */

/**
 * With Storage behind the deployment a photo's URL is absolute and points at
 * the bucket's CDN. Without it the API serves its own bytes and hands back a
 * root-relative path, which has to be read against the API rather than against
 * the page it is rendered on.
 */
const addressOf = (photo: BusinessPhotoDto): string =>
  photo.url.startsWith("http") ? photo.url : `${API_BASE_URL}${photo.url}`;

type Labels = {
  gallery: string;
  showPhoto: string;
  previousPhoto: string;
  nextPhoto: string;
  enlargePhoto: string;
  closePhoto: string;
};

const Chevron = ({ back }: { back: boolean }) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d={back ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
  </svg>
);

/**
 * The strip itself, used on the page and again full screen. The index follows
 * the scroll rather than the other way round, so a swipe, an arrow and a dot
 * all end in the same state.
 */
const Slides = ({
  photos,
  businessName,
  labels,
  start = 0,
  onOpen,
}: {
  photos: readonly BusinessPhotoDto[];
  businessName: string;
  labels: Labels;
  start?: number;
  onOpen?: (index: number) => void;
}) => {
  const track = useRef<HTMLDivElement>(null);
  const [shown, setShown] = useState(start);
  const many = photos.length > 1;

  // RTL scrolls into negative scrollLeft, so every offset carries the sign.
  const go = (index: number, smooth = true) => {
    const el = track.current;
    if (el === null) return;
    const sign = getComputedStyle(el).direction === "rtl" ? -1 : 1;
    const target = Math.max(0, Math.min(photos.length - 1, index));
    el.scrollTo({ left: sign * target * el.clientWidth, behavior: smooth ? "smooth" : "instant" });
  };

  useEffect(() => {
    if (start > 0) go(start, false);
    // Only where it opens; after that the scroll leads.
  }, []);

  const onScroll = () => {
    const el = track.current;
    if (el !== null) setShown(Math.round(Math.abs(el.scrollLeft) / el.clientWidth));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const rtl = getComputedStyle(event.currentTarget).direction === "rtl";
    go(shown + ((event.key === "ArrowRight") !== rtl ? 1 : -1));
  };

  return (
    <div className="gallery" onKeyDown={many ? onKeyDown : undefined}>
      <div ref={track} onScroll={onScroll} className="gallery-track">
        {photos.map((photo, index) => {
          /* A remote image at a URL the API decided, so there is no build-time
             host to configure and nothing to pre-size. */
          const image = (
            <img
              src={addressOf(photo)}
              alt={index === 0 ? businessName : ""}
              loading={index === 0 ? "eager" : "lazy"}
            />
          );
          return onOpen ? (
            <button
              key={photo.id}
              type="button"
              className="gallery-slide"
              onClick={() => onOpen(index)}
              aria-label={`${labels.enlargePhoto} ${index + 1}`}
            >
              {image}
            </button>
          ) : (
            <div key={photo.id} className="gallery-slide">{image}</div>
          );
        })}
      </div>

      {many && (
        <>
          <button type="button" className="gallery-arrow gallery-prev" hidden={shown === 0}
            onClick={() => go(shown - 1)} aria-label={labels.previousPhoto}>
            <Chevron back />
          </button>
          <button type="button" className="gallery-arrow gallery-next" hidden={shown >= photos.length - 1}
            onClick={() => go(shown + 1)} aria-label={labels.nextPhoto}>
            <Chevron back={false} />
          </button>
          <span className="gallery-count" aria-hidden="true">{shown + 1} / {photos.length}</span>
          <div className="gallery-dots">
            {photos.map((photo, index) => (
              <button key={photo.id} type="button" onClick={() => go(index)}
                aria-label={`${labels.showPhoto} ${index + 1}`}
                aria-current={index === shown} />
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export const BusinessPhotos = ({
  photos,
  businessName,
  labels,
}: {
  /** Absent from an API deployed before this feature; see the DTO. */
  photos: readonly BusinessPhotoDto[] | undefined;
  businessName: string;
  labels: Labels;
}) => {
  const ordered = [...(photos ?? [])].sort((a, b) => a.slot - b.slot);
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState<number | null>(null);

  // Shown before the strip inside it mounts, so the strip has a width to
  // scroll to the tapped photo with.
  const enlarge = (index: number) => {
    dialog.current?.showModal();
    setOpen(index);
  };

  if (ordered.length === 0) return null;

  return (
    <>
      <section aria-label={labels.gallery}>
        <Slides photos={ordered} businessName={businessName} labels={labels} onOpen={enlarge} />
      </section>

      {/* Esc and the back gesture close a native dialog on their own; onClose
          is where the page learns about it. */}
      <dialog ref={dialog} className="gallery-full" onClose={() => setOpen(null)}>
        {open !== null && (
          <>
            <Slides photos={ordered} businessName={businessName} labels={labels} start={open} />
            <button type="button" className="gallery-close" onClick={() => dialog.current?.close()}
              aria-label={labels.closePhoto} autoFocus>
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                <path d="M6 6l12 12M18 6L6 18" />
              </svg>
            </button>
          </>
        )}
      </dialog>
    </>
  );
};

export const hasCover = (photos: readonly BusinessPhotoDto[] | undefined): boolean =>
  (photos ?? []).some((photo) => photo.slot === PHOTO_SLOTS.cover);
