"use client";

import { useState } from "react";
import { PHOTO_SLOTS } from "@tor-now/domain";
import { API_BASE_URL } from "@/lib/api/client.ts";
import type { BusinessPhotoDto } from "@/lib/api/types.ts";

/**
 * What a business looks like, above what it offers.
 *
 * The cover leads at the page's full width and the rest sit under it as a row
 * of thumbnails; tapping one makes it the large picture, so the same component
 * is a header on a phone and a small gallery on a desktop without a second
 * layout. A business with only a cover gets no thumbnail row, and one with no
 * photos at all renders nothing rather than a placeholder — an empty frame
 * says less than the name does.
 */

/**
 * With Storage behind the deployment a photo's URL is absolute and points at
 * the bucket's CDN. Without it the API serves its own bytes and hands back a
 * root-relative path, which has to be read against the API rather than against
 * the page it is rendered on.
 */
const addressOf = (photo: BusinessPhotoDto): string =>
  photo.url.startsWith("http") ? photo.url : `${API_BASE_URL}${photo.url}`;

export const BusinessPhotos = ({
  photos,
  businessName,
  labels,
}: {
  /** Absent from an API deployed before this feature; see the DTO. */
  photos: readonly BusinessPhotoDto[] | undefined;
  businessName: string;
  labels: { gallery: string; showPhoto: string };
}) => {
  const ordered = [...(photos ?? [])].sort((a, b) => a.slot - b.slot);
  const [shown, setShown] = useState(0);

  if (ordered.length === 0) return null;

  const large = ordered[Math.min(shown, ordered.length - 1)];
  if (large === undefined) return null;

  return (
    <section
      aria-label={labels.gallery}
      style={{ display: "flex", flexDirection: "column", gap: 8 }}
    >
      {/* A remote image at a URL the API decided, so there is no build-time
          host to configure and nothing to pre-size. */}
      <img
        src={addressOf(large)}
        alt={businessName}
        loading="lazy"
        className="gallery-cover"
      />

      {ordered.length > 1 && (
        <div className="gallery-thumbs">
          {ordered.map((photo, index) => (
            <button
              key={photo.id}
              onClick={() => setShown(index)}
              aria-label={`${labels.showPhoto} ${index + 1}`}
              aria-pressed={index === shown}
              className="gallery-thumb"
              style={{
                border: `2px solid ${index === shown ? "var(--accent)" : "var(--line)"}`,
                opacity: index === shown ? 1 : 0.75,
              }}
            >
              {/* A remote image at a URL the API decided, so there is no build-time
          host to configure and nothing to pre-size. */}
              <img src={addressOf(photo)} alt="" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </section>
  );
};

export const hasCover = (photos: readonly BusinessPhotoDto[] | undefined): boolean =>
  (photos ?? []).some((photo) => photo.slot === PHOTO_SLOTS.cover);
