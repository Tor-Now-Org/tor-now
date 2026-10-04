import { beforeEach, describe, expect, it } from "vitest";
import {
  A_BUSINESS,
  httpHarness,
  signInAsAdministratorOverHttp,
  signInOverHttp,
  type HttpHarness,
} from "../infrastructure/testing/http-harness.ts";

/**
 * ADR 0024 over HTTP: a Business has one to three Categories, the first its
 * main one. A client from before keeps sending one `category`, and a code that
 * joined a sibling keeps meaning the one it joined.
 */

type Wire = { id: string; category: string | null; categories: string[] };
type Refusal = { error: { code: string; message: string } };

const { categories: _ignored, ...WITHOUT_CATEGORIES } = A_BUSINESS;

const register = async (api: HttpHarness, body: Record<string, unknown>, phone = "+972500000001") => {
  const owner = await signInOverHttp(api, phone, "רן");
  const response = await api.post("/businesses", { ...WITHOUT_CATEGORIES, phone, ...body }, owner.token);
  return { ...response, token: owner.token };
};

const expectRefused = (response: { status: number; body: unknown }, says: string) => {
  expect(response.status).toBe(400);
  expect((response.body as Refusal).error.code).toBe("VALIDATION_FAILED");
  expect((response.body as Refusal).error.message).toContain(says);
};

describe("registering a business with its categories", () => {
  let api: HttpHarness;
  beforeEach(() => {
    api = httpHarness();
  });

  it("keeps up to three in the order chosen, the first named the main one", async () => {
    const { status, body } = await register(api, {
      categories: ["hair_salon", "nail_salon", "makeup_artist"],
    });
    expect(status).toBe(201);
    expect(body).toMatchObject({
      category: "hair_salon",
      categories: ["hair_salon", "nail_salon", "makeup_artist"],
    });
  });

  it("takes the old single field as a list of one", async () => {
    const { status, body } = await register(api, { category: "barbershop" });
    expect(status).toBe(201);
    expect(body).toMatchObject({ category: "barbershop", categories: ["barbershop"] });
  });

  it("files a retired code under the one it joined, from either field", async () => {
    expect((await register(api, { category: "gel_nails" })).body).toMatchObject({
      categories: ["nail_salon"],
    });
    expect(
      (await register(api, { categories: ["orthodontist", "tires"] }, "+972500000002")).body,
    ).toMatchObject({ category: "dental_clinic", categories: ["dental_clinic", "car_mechanic"] });
  });

  it("refuses a fourth", async () => {
    expectRefused(
      await register(api, { categories: ["hair_salon", "nail_salon", "makeup_artist", "spa"] }),
      "At most 3 categories",
    );
  });

  it("refuses the same one twice, a retired code beside its new home included", async () => {
    expectRefused(await register(api, { categories: ["spa", "spa"] }), "The same category twice");
    expectRefused(
      await register(api, { categories: ["gel_nails", "nail_salon"] }, "+972500000002"),
      "The same category twice",
    );
  });

  it("refuses a code that is not on the list, in either field", async () => {
    expectRefused(await register(api, { categories: ["spa", "spaceship"] }), "categories: Not a category");
    expectRefused(await register(api, { category: "spaceship" }, "+972500000002"), "category: Not a category");
  });

  it("refuses none, whether the list is empty or missing", async () => {
    expectRefused(await register(api, { categories: [] }), "categories: Choose at least one");
    expectRefused(await register(api, {}, "+972500000002"), "categories: Choose at least one");
  });

  it("refuses a list that is not a list of codes", async () => {
    expectRefused(await register(api, { categories: "spa" }), "categories");
    expectRefused(await register(api, { categories: [7] }, "+972500000002"), "categories");
  });

  it("refuses both fields at once instead of guessing which was meant", async () => {
    expectRefused(
      await register(api, { category: "spa", categories: ["massage"] }),
      "Send categories, not category as well",
    );
  });
});

describe("changing a business's categories", () => {
  let api: HttpHarness;
  let businessId: string;
  let token: string;

  beforeEach(async () => {
    api = httpHarness();
    const created = await register(api, { categories: ["hair_salon"] });
    businessId = (created.body as Wire).id;
    token = created.token;
  });

  const profile = async () =>
    ((await api.get(`/businesses/${businessId}`)).body as { business: Wire }).business;

  it("adds, reorders and removes, and the page shows what was saved", async () => {
    const added = await api.patch(`/businesses/${businessId}`, {
      categories: ["hair_salon", "nail_salon", "makeup_artist"],
    }, token);
    expect(added.status).toBe(200);
    expect((await profile()).categories).toEqual(["hair_salon", "nail_salon", "makeup_artist"]);

    // Making another the main one is moving it first.
    await api.patch(`/businesses/${businessId}`, {
      categories: ["nail_salon", "hair_salon", "makeup_artist"],
    }, token);
    expect(await profile()).toMatchObject({
      category: "nail_salon",
      categories: ["nail_salon", "hair_salon", "makeup_artist"],
    });

    await api.patch(`/businesses/${businessId}`, { categories: ["makeup_artist"] }, token);
    expect(await profile()).toMatchObject({ category: "makeup_artist", categories: ["makeup_artist"] });
  });

  it("keeps them when a change leaves them out", async () => {
    await api.patch(`/businesses/${businessId}`, { categories: ["hair_salon", "spa"] }, token);
    await api.patch(`/businesses/${businessId}`, { name: "מספרת רן החדשה" }, token);
    expect((await profile()).categories).toEqual(["hair_salon", "spa"]);
  });

  it("takes the old single field as replacing the list with one", async () => {
    await api.patch(`/businesses/${businessId}`, { categories: ["hair_salon", "spa"] }, token);
    await api.patch(`/businesses/${businessId}`, { category: "reflexology" }, token);
    expect((await profile()).categories).toEqual(["massage"]);
  });

  it("never clears them, and refuses every list registering refuses", async () => {
    expectRefused(await api.patch(`/businesses/${businessId}`, { categories: [] }, token), "Choose at least one");
    expectRefused(
      await api.patch(`/businesses/${businessId}`, { categories: ["spa", "yoga", "pilates", "massage"] }, token),
      "At most 3",
    );
    expectRefused(
      await api.patch(`/businesses/${businessId}`, { categories: ["meditation", "yoga"] }, token),
      "twice",
    );
    expectRefused(
      await api.patch(`/businesses/${businessId}`, { category: "spa", categories: ["spa"] }, token),
      "not category as well",
    );
    expect((await profile()).categories).toEqual(["hair_salon"]);
  });

  it("lets an administrator change them on the owner's behalf, by the same rule", async () => {
    const admin = await signInAsAdministratorOverHttp(api, "+972500000000");
    const reason = "בקשת הבעלים בטלפון";
    const changed = await api.patch(
      `/admin/businesses/${businessId}`,
      { categories: ["barbershop", "hair_salon"], reason },
      admin.token,
    );
    expect(changed.status).toBe(200);
    expect(changed.body).toMatchObject({ categories: ["barbershop", "hair_salon"] });
    expectRefused(
      await api.patch(`/admin/businesses/${businessId}`, { categories: [], reason }, admin.token),
      "Choose at least one",
    );
  });
});

describe("finding a business by any of its categories", () => {
  let api: HttpHarness;
  let both: string;
  let other: string;

  beforeEach(async () => {
    api = httpHarness();
    both = ((await register(api, { name: "סטודיו נועה", categories: ["hair_salon", "nail_salon"] })).body as Wire).id;
    other = ((await register(api, { name: "ספא הים", categories: ["spa"] }, "+972500000002")).body as Wire).id;
  });

  const found = async (query: string) => {
    const { status, body } = await api.get(`/businesses/search?${query}`);
    expect(status).toBe(200);
    return body as Wire[];
  };

  it("browses a second category as well as the main one", async () => {
    const nails = await found("category=nail_salon");
    expect(nails.map((business) => business.id)).toContain(both);
    expect(nails.map((business) => business.id)).not.toContain(other);
    // The card still names the business by its main Category.
    expect(nails.find((business) => business.id === both)).toMatchObject({
      category: "hair_salon",
      categories: ["hair_salon", "nail_salon"],
    });
    expect((await found("category=hair_salon")).map((business) => business.id)).toContain(both);
  });

  it("browses a retired code as the one it joined, so an old link still works", async () => {
    expect((await found("category=gel_nails")).map((business) => business.id)).toContain(both);
  });

  it("refuses a code that is not on the list", async () => {
    const { status } = await api.get("/businesses/search?category=spaceship");
    expect(status).toBe(400);
  });

  it("finds by a word for the second category, though the name has none of it", async () => {
    const ids = (await found(`q=${encodeURIComponent("מניקור")}`)).map((business) => business.id);
    expect(ids).toContain(both);
    expect(ids).not.toContain(other);
  });
});
