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
      if (response.ok) return;
      const said = await response.text();
      // Already gone is the state we wanted; anything else is worth hearing
      // about, because the row is about to be deleted either way and an
      // orphaned object cannot be found again afterwards.
      //
      // Storage says "gone" in two ways, and only one of them is a 404 status:
      // a missing object comes back as 400 with the 404 inside the body.
      // Reading the status alone made that look like a refusal.
      if (response.status === 404 || saysMissing(said)) return;
      throw new Error(`Storage refused the delete (${response.status}): ${said}`);
    },
  };
};

/** Storage's own words for an object that is not there. */
const MISSING = new Set(["not_found", "NoSuchKey"]);

const saysMissing = (body: string): boolean => {
  try {
    const said = JSON.parse(body) as { statusCode?: string; error?: string; code?: string };
    return (
      said.statusCode === "404" ||
      (said.error !== undefined && MISSING.has(said.error)) ||
      (said.code !== undefined && MISSING.has(said.code))
    );
  } catch {
    // Not JSON, so it is not one of Storage's structured answers.
    return false;
  }
};
