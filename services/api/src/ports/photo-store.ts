/**
 * Where the bytes of a photo live.
 *
 * The record of a photo is a row like any other and goes through a repository;
 * the bytes are not, so they get their own port. Production puts them in a
 * Supabase Storage bucket and hands back a public URL; a deployment with no
 * Storage behind it — CI, a laptop, the end-to-end suite against a plain
 * Postgres — keeps them in the function and serves them itself.
 *
 * That is the same arrangement ADR 0005 uses for messages: one port, a real
 * adapter when there is a vendor and a working one when there is not, so the
 * whole path can be exercised without either.
 */
export type StoredPhoto = {
  /** The object's key, which is what the row records. */
  readonly path: string;
  /** Where a browser fetches it. */
  readonly url: string;
};

export type PhotoStore = {
  /** The adapter in use, reported by /health so it is never a guess. */
  readonly kind: "SUPABASE_STORAGE" | "IN_FUNCTION";
  put(input: {
    path: string;
    bytes: Uint8Array;
    contentType: string;
  }): Promise<StoredPhoto>;
  remove(path: string): Promise<void>;
  /**
   * Where the object at this path is served from. A plain function rather than
   * a method, because callers pass it around on its own and it never needs the
   * store it came from.
   */
  readonly urlFor: (path: string) => string;
  /**
   * The bytes back again, for the adapter that serves them itself. Storage
   * serves its own objects, so it never answers this.
   */
  readonly read?: (path: string) => { bytes: Uint8Array; contentType: string } | null;
};
