"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  PHOTO_SLOTS,
  PHOTO_SLOTS_IN_ORDER,
  type PhotoSlot,
} from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessPhotoDto } from "@/lib/api/types.ts";
import { shrinkForUpload } from "@/lib/photos.ts";
import { Critical, Spinner } from "../ui.tsx";

/**
 * Managing the photos of a business that already exists.
 *
 * The wizard's picker holds files and uploads them at the end, because there
 * is nothing to upload them to yet. Here the business is real, so every choice
 * takes effect immediately — which is what an owner expects from a settings
 * screen, and what makes "delete" mean deleted rather than pending.
 *
 * Replacing is one request, not a delete followed by an upload: the API puts
 * the new photo in the slot and drops the old one, so a failure leaves the
 * business with the picture it already had rather than with none.
 */
export const PhotoPanel = ({
  token,
  businessId,
  labels,
}: {
  token: string;
  businessId: string;
  labels: {
    cover: string;
    coverHint: string;
    more: string;
    moreHint: string;
    add: string;
    replace: string;
    remove: string;
    notAnImage: string;
  };
}) => {
  const [photos, setPhotos] = useState<BusinessPhotoDto[] | null>(null);
  const [working, setWorking] = useState<PhotoSlot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef(new Map<PhotoSlot, HTMLInputElement | null>());

  const load = useCallback(async () => {
    try {
      setPhotos(await api.businessPhotos(token, businessId));
    } catch {
      setPhotos([]);
    }
  }, [token, businessId]);

  useEffect(() => {
    void load();
  }, [load]);

  const fail = (cause: unknown) =>
    setError(
      isApiError(cause) ? cause.message : labels.notAnImage,
    );

  const put = async (slot: PhotoSlot, file: File | undefined) => {
    if (file === undefined) return;
    if (!file.type.startsWith("image/")) {
      setError(labels.notAnImage);
      return;
    }
    setError(null);
    setWorking(slot);
    try {
      await api.uploadBusinessPhoto(token, businessId, slot, await shrinkForUpload(file));
      await load();
    } catch (cause) {
      fail(cause);
    } finally {
      setWorking(null);
    }
  };

  const drop = async (photo: BusinessPhotoDto) => {
    setError(null);
    setWorking(photo.slot);
    try {
      await api.deleteBusinessPhoto(token, businessId, photo.id);
      await load();
    } catch (cause) {
      fail(cause);
    } finally {
      setWorking(null);
    }
  };

  if (photos === null) return <Spinner />;

  const tile = (slot: PhotoSlot) => {
    const photo = photos.find((candidate) => candidate.slot === slot);
    const busy = working === slot;
    return (
      <div key={slot} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          type="button"
          disabled={busy}
          onClick={() => inputs.current.get(slot)?.click()}
          aria-label={photo === undefined ? labels.add : labels.replace}
          style={{
            width: "100%",
            aspectRatio: slot === PHOTO_SLOTS.cover ? "16 / 9" : "1 / 1",
            borderRadius: 16,
            border: `1px ${photo === undefined ? "dashed" : "solid"} var(--line)`,
            background: photo === undefined ? "var(--sunken)" : "var(--raised)",
            overflow: "hidden",
            padding: 0,
            opacity: busy ? 0.5 : 1,
          }}
        >
          {photo === undefined ? (
            <span style={{ color: "var(--faint)", fontSize: 13 }}>
              {busy ? "…" : labels.add}
            </span>
          ) : (
            /* The address the API gave us; there is no build-time host to
               configure and nothing to pre-size. */
            <img
              src={photo.url}
              alt=""
              loading="lazy"
              style={{ width: "100%", height: "100%", objectFit: "cover" }}
            />
          )}
        </button>
        <input
          ref={(element) => {
            inputs.current.set(slot, element);
          }}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="visually-hidden"
          onChange={(event) => {
            void put(slot, event.target.files?.[0]);
            event.target.value = "";
          }}
        />
        {photo !== undefined && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void drop(photo)}
            style={{ fontSize: 12.5, color: "var(--critical)", minHeight: 32 }}
          >
            {labels.remove}
          </button>
        )}
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
      {error !== null && <Critical>{error}</Critical>}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="label">{labels.cover}</span>
        <span className="hint">{labels.coverHint}</span>
        {tile(PHOTO_SLOTS.cover)}
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="label">{labels.more}</span>
        <span className="hint">{labels.moreHint}</span>
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${PHOTO_SLOTS_IN_ORDER.length - 1}, minmax(0, 1fr))`,
            gap: 10,
          }}
        >
          {PHOTO_SLOTS_IN_ORDER.filter((slot) => slot !== PHOTO_SLOTS.cover).map(tile)}
        </div>
      </div>
    </div>
  );
};
