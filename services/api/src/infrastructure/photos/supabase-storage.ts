import type { PhotoStore, StoredPhoto } from "../../ports/photo-store.ts";

/**
 * Supabase Storage over its REST interface.
 *
 * The service role key is used because a bucket write is not something a
 * customer's connection may do — the same reason the Edge Function holds it at
 * all. It never leaves the function, and the URL handed back is public, so
 * reading a photo costs a browser one CDN request and no round trip here.
 */
/**
 * How the key is presented.
 *
 * Supabase issues two kinds of secret. The legacy one is a JWT and travels on
 * both headers, which is what every older example shows. The current one
 * (`sb_secret_…`) is opaque, and sending it as a Bearer makes the platform try
 * to parse it as a JWT and refuse the request with "Invalid Compact JWS" — so
 * it goes on `apikey` alone. Which kind a project has is not something the
 * function chooses, so it reads the key rather than assuming.
 */
export const storageHeaders = (key: string): Readonly<Record<string, string>> =>
  key.startsWith("sb_")
    ? { apikey: key }
    : { apikey: key, Authorization: `Bearer ${key}` };

export const supabaseStoragePhotos = (
  config: {
    url: string;
    serviceRoleKey: string;
    bucket: string;
  },
  /** Injected so the header choice above can be tested without a vendor. */
  send: typeof fetch = fetch,
): PhotoStore => {
  const base = config.url.replace(/\/+$/, "");
  const object = (path: string) =>
    `${base}/storage/v1/object/${config.bucket}/${encodeURI(path)}`;

  const authorization = storageHeaders(config.serviceRoleKey);

  return {
    kind: "SUPABASE_STORAGE",

    urlFor: (path) =>
      `${base}/storage/v1/object/public/${config.bucket}/${encodeURI(path)}`,

    async put({ path, bytes, contentType }): Promise<StoredPhoto> {
      const response = await send(object(path), {
        method: "POST",
        headers: {
          ...authorization,
          "Content-Type": contentType,
          // A retry after a network failure must not be refused for the sake of
          // a half-written object nobody has a row for.
          "x-upsert": "true",
        },
        body: bytes as unknown as BodyInit,
      });
      if (!response.ok) {
        throw new Error(
          `Storage refused the upload (${response.status}): ${await response.text()}`,
        );
      }
      return {
        path,
        url: `${base}/storage/v1/object/public/${config.bucket}/${encodeURI(path)}`,
      };
    },

    async remove(path) {
      const response = await send(object(path), {
        method: "DELETE",
        headers: authorization,
      });
      // Already gone is the state we wanted; anything else is worth hearing
      // about, because the row is about to be deleted either way and an
      // orphaned object cannot be found again afterwards.
      if (!response.ok && response.status !== 404) {
        throw new Error(
          `Storage refused the delete (${response.status}): ${await response.text()}`,
        );
      }
    },
  };
};
