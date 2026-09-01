import type { PhotoStore, StoredPhoto } from "../../ports/photo-store.ts";

/**
 * The photo store for a deployment with no Storage behind it: the bytes stay
 * in the function and the API serves them from `/photos/:path`.
 *
 * This is what makes the end-to-end suite able to upload a photo and then load
 * it, against a plain Postgres and no Supabase at all — the same reason ADR
 * 0005's notifier has a log adapter. It is not a cache and not a fallback for
 * production: an isolate that restarts forgets every picture, which is why
 * /health reports which store is live.
 */
export const inFunctionPhotos = (): PhotoStore => {
  const held = new Map<string, { bytes: Uint8Array; contentType: string }>();

  return {
    kind: "IN_FUNCTION",

    urlFor: (path) => `/photos/${path}`,

    async put({ path, bytes, contentType }): Promise<StoredPhoto> {
      held.set(path, { bytes, contentType });
      return { path, url: `/photos/${path}` };
    },

    async remove(path) {
      held.delete(path);
    },

    read: (path) => held.get(path) ?? null,
  };
};
