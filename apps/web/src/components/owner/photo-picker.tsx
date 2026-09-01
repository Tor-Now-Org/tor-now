"use client";

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from "react";
import { MAXIMUM_PHOTOS, PHOTO_SLOTS, type PhotoSlot } from "@tor-now/domain";

/**
 * Choosing the pictures a business shows.
 *
 * The wizard runs before the business exists, so nothing is uploaded here —
 * the chosen files are held and sent once registration returns an id. That
 * also means a person can change their mind about a photo without a round trip
 * for each attempt.
 *
 * Every file is re-encoded before it leaves the browser. A phone camera
 * produces four thousand pixels and eight megabytes for a picture that is shown
 * three hundred pixels wide, and sending that would be slow to upload, slow to
 * load, and rejected by the size limit for no reason the person could act on.
 */

/** Wide enough for a cover on a large screen, and no wider. */
const LONGEST_EDGE = 1600;
const JPEG_QUALITY = 0.82;

export type ChosenPhoto = {
  readonly slot: PhotoSlot;
  readonly file: Blob;
  /** An object URL, for showing what was chosen. Revoked when it is replaced. */
  readonly preview: string;
};

const shrink = async (file: File): Promise<Blob> => {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, LONGEST_EDGE / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (context === null) return file;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const encoded = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", JPEG_QUALITY),
  );
  // A browser that will not encode is not a reason to lose the photo; the
  // original is still within the limit or the API will say so.
  return encoded ?? file;
};

const SLOTS: readonly PhotoSlot[] = [0, 1, 2, 3];

export const PhotoPicker = ({
  chosen,
  onChange,
  labels,
}: {
  chosen: readonly ChosenPhoto[];
  /**
   * An updater rather than a value: re-encoding a photo takes a moment, and
   * choosing two in quick succession would otherwise have both of them read the
   * same list and the second one overwrite the first.
   */
  onChange: Dispatch<SetStateAction<readonly ChosenPhoto[]>>;
  labels: {
    cover: string;
    coverHint: string;
    more: string;
    moreHint: string;
    add: string;
    replace: string;
    remove: string;
    tooLarge: string;
    notAnImage: string;
  };
}) => {
  const [error, setError] = useState<string | null>(null);
  const inputs = useRef(new Map<PhotoSlot, HTMLInputElement | null>());

  // Object URLs are released together when the picker goes away. Releasing a
  // replaced one at the moment of replacement would mean a side effect inside a
  // state updater, which React is free to run twice.
  const live = useRef(new Set<string>());
  useEffect(() => {
    const urls = live.current;
    return () => {
      for (const url of urls) URL.revokeObjectURL(url);
      urls.clear();
    };
  }, []);

  const put = async (slot: PhotoSlot, file: File | undefined) => {
    if (file === undefined) return;
    if (!file.type.startsWith("image/")) {
      setError(labels.notAnImage);
      return;
    }
    setError(null);
    try {
      const shrunk = await shrink(file);
      const preview = URL.createObjectURL(shrunk);
      live.current.add(preview);
      onChange((previous) => [
        ...previous.filter((photo) => photo.slot !== slot),
        { slot, file: shrunk, preview },
      ]);
    } catch {
      setError(labels.notAnImage);
    }
  };

  const drop = (slot: PhotoSlot) => {
    onChange((previous) => previous.filter((photo) => photo.slot !== slot));
  };

  const tile = (slot: PhotoSlot) => {
    const photo = chosen.find((candidate) => candidate.slot === slot);
    const isCoverSlot = slot === PHOTO_SLOTS.cover;
    return (
      <div key={slot} style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <button
          type="button"
          onClick={() => inputs.current.get(slot)?.click()}
          aria-label={photo === undefined ? `${labels.add} ${slot + 1}` : `${labels.replace} ${slot + 1}`}
          style={{
            position: "relative",
            width: "100%",
            aspectRatio: isCoverSlot ? "16 / 9" : "1 / 1",
            borderRadius: 16,
            border: `1px ${photo === undefined ? "dashed" : "solid"} var(--line)`,
            background: photo === undefined ? "var(--sunken)" : "var(--raised)",
            overflow: "hidden",
            padding: 0,
          }}
        >
          {photo === undefined ? (
            <span style={{ color: "var(--faint)", fontSize: 13 }}>{labels.add}</span>
          ) : (
            /* A plain img: this is an object URL for a file the person chose a
               moment ago, so there is nothing to optimise and no host to
               configure. */
            <img
              src={photo.preview}
              alt=""
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
            onClick={() => drop(slot)}
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
            gridTemplateColumns: `repeat(${MAXIMUM_PHOTOS - 1}, minmax(0, 1fr))`,
            gap: 10,
          }}
        >
          {SLOTS.filter((slot) => slot !== PHOTO_SLOTS.cover).map(tile)}
        </div>
      </div>

      {error !== null && <p className="crit" style={{ margin: 0 }}>{error}</p>}
    </div>
  );
};
