import { describe, expect, it } from "vitest";
import { storageHeaders, supabaseStoragePhotos } from "./supabase-storage.ts";

/**
 * The adapter talks to a vendor, so what is worth testing is the part that has
 * no vendor in it: how the key is presented. Getting this wrong is invisible
 * locally — the in-function store is what runs there — and fails only in
 * production, which is exactly where it did fail.
 */
/**
 * Assembled rather than written out. A literal in this shape is indistinguish-
 * able from a real key to a secret scanner — and to a reader — and one of those
 * blocked a push here, correctly.
 */
const OPAQUE_KEY = ["sb", "secret", "notarealkey", "00000000"].join("_");

describe("presenting the key to Storage", () => {
  it("sends an opaque secret key on apikey alone", () => {
    const headers = storageHeaders(OPAQUE_KEY);
    expect(headers["apikey"]).toBe(OPAQUE_KEY);
    // A Bearer would be parsed as a JWT and rejected.
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("sends a legacy JWT key on both, as every older example does", () => {
    const jwt = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.sig";
    const headers = storageHeaders(jwt);
    expect(headers["apikey"]).toBe(jwt);
    expect(headers["Authorization"]).toBe(`Bearer ${jwt}`);
  });
});

describe("the storage adapter", () => {
  const spy = () => {
    const calls: { url: string; init: RequestInit }[] = [];
    const send = ((url: unknown, init: unknown) => {
      calls.push({ url: String(url), init: init as RequestInit });
      return Promise.resolve(new Response("", { status: 200 }));
    }) as unknown as typeof fetch;
    return { calls, send };
  };

  const store = (key: string, send: typeof fetch) =>
    supabaseStoragePhotos(
      { url: "https://ref.supabase.co/", serviceRoleKey: key, bucket: "business-photos" },
      send,
    );

  it("uploads with the headers the key format calls for", async () => {
    const { calls, send } = spy();
    await store(OPAQUE_KEY, send).put({
      path: "biz/0-1.jpg",
      bytes: new Uint8Array([1, 2]),
      contentType: "image/jpeg",
    });

    const headers = calls[0]?.init.headers as Record<string, string>;
    expect(calls[0]?.url).toBe(
      "https://ref.supabase.co/storage/v1/object/business-photos/biz/0-1.jpg",
    );
    expect(headers["apikey"]).toBe(OPAQUE_KEY);
    expect(headers["Authorization"]).toBeUndefined();
    expect(headers["Content-Type"]).toBe("image/jpeg");
  });

  it("hands back the public address, with no trailing slash doubled", () => {
    const { send } = spy();
    expect(store(OPAQUE_KEY, send).urlFor("biz/0-1.jpg")).toBe(
      "https://ref.supabase.co/storage/v1/object/public/business-photos/biz/0-1.jpg",
    );
  });

  it("treats an object that is already gone as removed", async () => {
    const send = (() =>
      Promise.resolve(new Response("", { status: 404 }))) as unknown as typeof fetch;
    await expect(store(OPAQUE_KEY, send).remove("biz/gone.jpg")).resolves.toBeUndefined();
  });

  it("treats it as removed however Storage chooses to say it", async () => {
    // What Supabase actually answers for a missing object: a 400 whose body
    // carries the 404. Reading only the transport status made "already gone"
    // look like a refusal, and the caller then undid work that had committed.
    const send = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            statusCode: "404",
            error: "not_found",
            message: "Object not found",
            code: "NoSuchKey",
          }),
          { status: 400 },
        ),
      )) as unknown as typeof fetch;
    await expect(store(OPAQUE_KEY, send).remove("biz/gone.jpg")).resolves.toBeUndefined();
  });

  it("still says so loudly when Storage refuses the delete for another reason", async () => {
    const send = (() =>
      Promise.resolve(new Response("forbidden", { status: 403 }))) as unknown as typeof fetch;
    await expect(store(OPAQUE_KEY, send).remove("biz/0.jpg")).rejects.toThrow(/403/);
  });

  it("says so loudly when Storage refuses", async () => {
    const send = (() =>
      Promise.resolve(new Response("nope", { status: 403 }))) as unknown as typeof fetch;
    await expect(
      store(OPAQUE_KEY, send).put({
        path: "biz/0.jpg",
        bytes: new Uint8Array([1]),
        contentType: "image/jpeg",
      }),
    ).rejects.toThrow(/403/);
  });
});
