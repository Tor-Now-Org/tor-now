import { expect, test, type Locator, type Page } from "@playwright/test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  aDayFromNow,
  aFreeStretch,
  anInstantAt,
  call,
  openTheDayOf,
  ready,
  showDay,
} from "./support.ts";

/**
 * The photographs on the front door.
 *
 * `/welcome` claims the product does a handful of things, and the honest way to
 * make that claim is to show the product doing them. So these are not mockups:
 * the suite stands up the whole system the way every other journey does, seeds
 * a street of shops with names, prices and customers, drives the real screens
 * and photographs them into `public/landing`.
 *
 * Which means a screen that changes shape is re-taken rather than redrawn, and
 * the front door cannot quietly drift into advertising a product that no longer
 * exists.
 *
 * Not part of the suite — it writes into the repository, and a test that edits
 * the working tree has no business running on every push:
 *
 *     npm run shots
 *
 * Every number here is visibly invented. The phones are +972 50-000-00xx, which
 * is not a range anybody can answer, because a screenshot is published and a
 * plausible phone number in a published screenshot is somebody's real phone
 * ringing.
 */

const SHOTS = "apps/web/public/landing";

/**
 * Show every chair at once.
 *
 * Which calendar the day is showing is one chip on the toolbar; the list it
 * opens offers all of them together, which is how a shop with more than one
 * seat actually reads its own morning.
 */
const showEveryCalendar = async (page: Page): Promise<void> => {
  await page.getByRole("button", { name: /^יומן:/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: /כל היומנים/ }).click();
  await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
};

/** Nothing in this seed is anybody's number. */
const fakePhone = (n: number) => `+9725000000${String(n).padStart(2, "0")}`;

/**
 * Where the street is.
 *
 * The customer stands at the top of it, so the nearby list opens with real
 * distances in a believable order rather than every shop at the same point.
 */
const HERE = { latitude: 32.0796, longitude: 34.7737 };
const along = (metres: number) => ({
  latitude: HERE.latitude + metres / 111_000,
  longitude: HERE.longitude + metres / 94_000,
});

type Shop = {
  id: string;
  token: string;
  services: { id: string; name: string }[];
  resources: { id: string; name: string }[];
};

const openA = async (shop: {
  name: string;
  phone: string;
  category: string;
  address: string;
  metres: number;
  description: string;
  resourceNames: string[];
  services: { name: string; durationMinutes: number; priceMinor: number }[];
  hours: { start: string; end: string };
}): Promise<Shop> => {
  const token = await signIn(shop.phone, { givenName: "בעל", familyName: "העסק" });
  const made = await call<{ id: string }>("/businesses", {
    method: "POST",
    token,
    body: {
      name: shop.name,
      phone: shop.phone,
      description: shop.description,
      address: shop.address,
      ...along(shop.metres),
      category: shop.category,
      resourceNames: shop.resourceNames,
      services: shop.services.map((service) => ({ ...service, bufferMinutes: null })),
      workingHours: [0, 1, 2, 3, 4, 5, 6].map((dayOfWeek) => ({ dayOfWeek, ...shop.hours })),
    },
  });
  const profile = await call<{
    services: { id: string; name: string }[];
    resources: { id: string; name: string }[];
  }>(`/businesses/${made.id}`);
  return { id: made.id, token, services: profile.services, resources: profile.resources };
};

/**
 * Sign somebody in, once.
 *
 * A regular is booked into several weeks of the diary, and asking for a
 * verification code before each one is both untrue to what a person does and
 * enough to trip the product's own rate limit — which is working correctly, and
 * which the seed has no business arguing with. One session per person, kept for
 * the run.
 */
const sessions = new Map<string, string>();

const signIn = async (
  phone: string,
  name: { givenName: string; familyName: string },
): Promise<string> => {
  const held = sessions.get(phone);
  if (held !== undefined) return held;

  const { code } = await call<{ code: string }>("/auth/request-code", {
    method: "POST",
    body: { phone },
  });
  const { token } = await call<{ token: string }>("/auth/verify", {
    method: "POST",
    body: { phone, code, name },
  });
  sessions.set(phone, token);
  return token;
};

/**
 * Book the first time this shop offers at or after a wanted hour.
 *
 * The diary in these pictures is composed — a busy morning, a gap over lunch,
 * a thinner afternoon — because a helper that simply took "the next free slot"
 * would pack every appointment nose to tail and photograph a day no shop has.
 *
 * At or after, rather than exactly: what a shop offers sits on a grid its own
 * service lengths draw, so a forty-five minute cut has no 10:00 to give once
 * the morning has started. Naming 10:00 says where in the day this belongs and
 * lets the shop answer with the hour it actually has, which is the same thing
 * a person on the phone would accept.
 */
const bookFrom = async (
  shop: Shop,
  customerToken: string,
  serviceName: string,
  resourceName: string,
  day: string,
  notBefore: string,
): Promise<void> => {
  const service = shop.services.find((one) => one.name === serviceName);
  const resource = shop.resources.find((one) => one.name === resourceName);
  expect(service, `no service ${serviceName}`).toBeDefined();
  expect(resource, `no calendar ${resourceName}`).toBeDefined();

  const days = await call<{ slots: { startAt: string }[] }[]>(
    `/businesses/${shop.id}/availability?serviceId=${service!.id}` +
      `&resourceId=${resource!.id}&from=${day}&to=${day}`,
  );
  const shown = (startAt: string) =>
    new Intl.DateTimeFormat("he-IL", {
      timeZone: "Asia/Jerusalem",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(startAt));
  const wanted = days[0]?.slots.find((slot) => shown(slot.startAt) >= notBefore);
  expect(
    wanted,
    `${serviceName} with ${resourceName} has nothing from ${notBefore} on ${day}`,
  ).toBeDefined();

  await call("/appointments", {
    method: "POST",
    token: customerToken,
    body: {
      businessId: shop.id,
      serviceId: service!.id,
      resourceId: resource!.id,
      startAt: wanted!.startAt,
      customerNote: null,
    },
  });
};

/**
 * One screen, at twice the size the page shows it.
 *
 * The whole viewport, which is why the viewport is set to the artboard: a
 * capture of the shell element alone loses anything that floats above it, and
 * the map and the sheets — the screens most worth showing — are exactly the
 * ones that float.
 *
 * Twice over, because these are read on laptops with retina screens, where a
 * screenshot taken at CSS size is visibly soft and a front door that looks soft
 * suggests a product that is.
 */
const photograph = async (
  page: Page,
  name: string,
  /**
   * What this picture is of.
   *
   * Every screen here is captioned on the front door — "see the free hours",
   * "every chair at once" — and a caption is a claim about what is in the
   * frame. Scrolling is the part that silently does not happen: the element is
   * already technically on screen, `scrollIntoViewIfNeeded` correctly does
   * nothing, and the capture comes out showing the screen above the one the
   * caption promised. Naming the subject makes that a failure instead.
   */
  subject: Locator,
): Promise<void> => {
  // Whatever was sliding, fading or counting has finished. Without it a capture
  // lands mid-transition and the screen goes out half-drawn.
  await page.waitForTimeout(900);

  const frame = page.viewportSize();
  const box = await subject.boundingBox();
  expect(frame, "no viewport").not.toBeNull();
  expect(box, `${name}: its subject is not on the screen at all`).not.toBeNull();
  // In the upper two thirds, which is where a subject sits when the screen has
  // actually been scrolled to it rather than merely reaching it at the edge.
  expect(box!.y, `${name}: its subject is off the bottom of the frame`)
    .toBeLessThan(frame!.height * 0.66);
  expect(box!.y + box!.height, `${name}: its subject is off the top`).toBeGreaterThan(0);

  await page.screenshot({ path: `${SHOTS}/${name}.jpg`, quality: 78 });
};

test.describe("@shots the front door's photographs", () => {
  // One story, told in order: the street exists before anybody searches it.
  test.describe.configure({ mode: "serial" });

  // The artboard the interface is designed against, so the picture is the
  // screen and nothing else — no strip of desk down either side.
  test.use({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });

  const day = aDayFromNow(4);
  let barber: Shop;
  let salon: Shop;
  let nails: Shop;
  let dana: string;

  test("seeds a street, a diary and a customer", async () => {
    barber = await openA({
      name: "מספרת רן",
      phone: fakePhone(1),
      category: "barbershop",
      address: "דיזנגוף 142, תל אביב",
      metres: 140,
      description: "מספרה שכונתית עם שתי עמדות. אפשר גם בלי לתאם מראש, אבל עדיף עם.",
      resourceNames: ["רן", "שימי"],
      services: [
        { name: "תספורת גבר", durationMinutes: 30, priceMinor: 8000 },
        { name: "תספורת וזקן", durationMinutes: 45, priceMinor: 11000 },
        { name: "עיצוב זקן", durationMinutes: 20, priceMinor: 5000 },
        { name: "תספורת ילד", durationMinutes: 25, priceMinor: 6000 },
      ],
      hours: { start: "09:00", end: "19:00" },
    });

    salon = await openA({
      name: "סטודיו ליה",
      phone: fakePhone(2),
      category: "hair_salon",
      address: "דיזנגוף 168, תל אביב",
      metres: 320,
      description: "צבע, פן ותסרוקות ערב. ליה ותמר, שתי כיסאות, קפה על חשבון הבית.",
      resourceNames: ["ליה", "תמר"],
      services: [
        { name: "פן", durationMinutes: 45, priceMinor: 12000 },
        { name: "צבע ופן", durationMinutes: 90, priceMinor: 28000 },
        { name: "גוונים", durationMinutes: 120, priceMinor: 42000 },
        { name: "תסרוקת ערב", durationMinutes: 60, priceMinor: 25000 },
      ],
      hours: { start: "09:00", end: "20:00" },
    });

    nails = await openA({
      name: "ציפורניים מיטל",
      phone: fakePhone(3),
      category: "nail_salon",
      address: "דיזנגוף 121, תל אביב",
      metres: 520,
      description: "לק ג׳ל, בנייה ומניקור. בתיאום מראש בלבד.",
      resourceNames: ["מיטל"],
      services: [
        { name: "לק ג׳ל", durationMinutes: 60, priceMinor: 15000 },
        { name: "מניקור ופדיקור", durationMinutes: 75, priceMinor: 22000 },
        { name: "מילוי בנייה", durationMinutes: 90, priceMinor: 26000 },
      ],
      hours: { start: "10:00", end: "19:00" },
    });

    // The rest of the street: they are on the map and in the list, which is what
    // makes the first screen look like a neighbourhood rather than a fixture.
    const clinic = await openA({
      name: "קליניקת נועה",
      phone: fakePhone(4),
      category: "cosmetics",
      address: "דיזנגוף 195, תל אביב",
      metres: 700,
      description: "טיפולי פנים, פילינג והסרת שיער.",
      resourceNames: ["נועה"],
      services: [{ name: "טיפול פנים", durationMinutes: 60, priceMinor: 32000 }],
      hours: { start: "09:00", end: "18:00" },
    });
    await openA({
      name: "עיסוי שקד",
      phone: fakePhone(5),
      category: "massage",
      address: "בן גוריון 24, תל אביב",
      metres: 950,
      description: "עיסוי רקמות עמוק, שוודי ורפואי.",
      resourceNames: ["שקד"],
      services: [{ name: "עיסוי שוודי", durationMinutes: 60, priceMinor: 30000 }],
      hours: { start: "10:00", end: "21:00" },
    });
    await openA({
      name: "סטודיו פילאטיס אורית",
      phone: fakePhone(6),
      category: "pilates",
      address: "ארלוזורוב 11, תל אביב",
      metres: 1200,
      description: "פילאטיס מכשירים, קבוצות קטנות ואימון אישי.",
      resourceNames: ["אורית"],
      services: [{ name: "אימון אישי", durationMinutes: 50, priceMinor: 20000 }],
      hours: { start: "07:00", end: "20:00" },
    });

    // A morning at the barbershop, composed rather than generated.
    const diary: [string, { givenName: string; familyName: string }, string, string, string][] = [
      [fakePhone(20), { givenName: "אורי", familyName: "שגב" }, "תספורת גבר", "רן", "09:00"],
      [fakePhone(21), { givenName: "יונתן", familyName: "פרץ" }, "תספורת גבר", "שימי", "09:30"],
      [fakePhone(22), { givenName: "איתי", familyName: "רוזן" }, "תספורת וזקן", "רן", "10:00"],
      [fakePhone(23), { givenName: "רועי", familyName: "מזרחי" }, "תספורת וזקן", "שימי", "11:00"],
      [fakePhone(24), { givenName: "נועם", familyName: "ברק" }, "תספורת ילד", "רן", "11:30"],
      [fakePhone(25), { givenName: "גיא", familyName: "אלון" }, "עיצוב זקן", "רן", "14:00"],
      [fakePhone(26), { givenName: "עומר", familyName: "דגן" }, "תספורת גבר", "רן", "15:30"],
      [fakePhone(27), { givenName: "דור", familyName: "שלו" }, "תספורת גבר", "שימי", "16:00"],
    ];
    for (const [phone, name, service, chair, clock] of diary) {
      await bookFrom(barber, await signIn(phone, name), service, chair, day, clock);
    }

    // The rest of the month. A diary with one full day in it and twenty empty
    // ones is not a working shop, and the month screen — whose whole argument
    // is "the month, at a glance" — has nothing to show at a glance unless the
    // month has been worked. Names repeat across the weeks, because customers
    // come back, and that is the point of keeping a diary at all.
    const regulars = [
      [fakePhone(20), { givenName: "אורי", familyName: "שגב" }],
      [fakePhone(21), { givenName: "יונתן", familyName: "פרץ" }],
      [fakePhone(22), { givenName: "איתי", familyName: "רוזן" }],
      [fakePhone(23), { givenName: "רועי", familyName: "מזרחי" }],
      [fakePhone(25), { givenName: "גיא", familyName: "אלון" }],
      [fakePhone(26), { givenName: "עומר", familyName: "דגן" }],
      [fakePhone(27), { givenName: "דור", familyName: "שלו" }],
    ] as const;
    const cuts = ["תספורת גבר", "תספורת וזקן", "עיצוב זקן", "תספורת ילד"] as const;
    const hours = ["09:00", "10:30", "12:00", "14:00", "15:30", "17:00"] as const;
    for (let ahead = 1; ahead <= 20; ahead += 1) {
      if (ahead === 4) continue; // The composed day, already filled above.
      const when = aDayFromNow(ahead);
      // Two or three a day, which is what the month's dots are counting.
      for (let nth = 0; nth < 2 + (ahead % 2); nth += 1) {
        const seat = ahead * 3 + nth;
        const [phone, name] = regulars[seat % regulars.length]!;
        await bookFrom(
          barber,
          await signIn(phone, name),
          cuts[seat % cuts.length]!,
          seat % 2 === 0 ? "רן" : "שימי",
          when,
          hours[seat % hours.length]!,
        );
      }
    }

    // Lunch, so the day has a shape and the screen has something to show that
    // is neither an appointment nor an empty hour.
    const chair = barber.resources.find((one) => one.name === "רן")!;
    await call(`/businesses/${barber.id}/resources/${chair.id}/blocks`, {
      method: "POST",
      token: barber.token,
      body: {
        blocks: [
          {
            startAt: anInstantAt(day, "13:00"),
            endAt: anInstantAt(day, "14:00"),
            reason: "הפסקת צהריים",
          },
        ],
      },
    });

    // And the customer whose screens these are.
    dana = await signIn(fakePhone(10), { givenName: "דנה", familyName: "כהן" });
    await bookFrom(salon, dana, "צבע ופן", "ליה", day, "11:00");
    await bookFrom(nails, dana, "לק ג׳ל", "מיטל", aDayFromNow(11), "17:00");
    // A third, at a third shop: what "my appointments" is for is the diary you
    // keep across the businesses you use, and two entries do not show that as
    // well as three do.
    await bookFrom(clinic, dana, "טיפול פנים", "נועה", aDayFromNow(18), "10:00");
  });

  test("the customer's four screens", async ({ page, context }) => {
    await context.grantPermissions(["geolocation"]);
    await context.setGeolocation(HERE);
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", dana],
    );

    // The street, on the map. The list below the search box stays empty until
    // somebody types — correctly, since ranking nothing means nothing — so the
    // screen that shows what is around you is the map, and it is the one worth
    // opening with.
    await page.goto("/");
    await ready(page);
    await page.getByRole("button", { name: /^מפה/ }).click();
    const map = page.getByRole("dialog", { name: "מפה" });
    await expect(map.getByTitle("סטודיו ליה")).toBeVisible({ timeout: 15_000 });
    await photograph(page, "c1-map", map.getByTitle("סטודיו ליה"));

    await map.getByTitle("סטודיו ליה").dispatchEvent("click");
    await map.getByRole("button", { name: "לקביעת תור" }).click();
    await expect(page.getByText("בוחרים שירות")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("צבע ופן").first()).toBeVisible();
    await photograph(page, "c2-business", page.getByText("צבע ופן").first());

    // Down to the times, which is a grid of hours rather than another list of
    // cards — a different picture from the one above it, and the assertion at
    // the end of this file is what stops it quietly becoming the same one.
    await page.getByRole("button", { name: /צבע ופן/ }).click();
    // A day ahead rather than today: a shop photographed at six in the evening
    // has almost nothing left to offer, and an empty grid is a poor argument
    // for a product whose whole claim is that you can see what is free.
    await showDay(page, 2);
    const times = page.locator("[role=radio]", { hasText: /^\d\d:\d\d$/ });
    await expect(times.first()).toBeVisible({ timeout: 15_000 });
    // Far enough that the grid of hours is the picture, rather than the foot of
    // the services list with one row of times peeping under it.
    await page.mouse.move(195, 600);
    await page.mouse.wheel(0, 720);
    await photograph(page, "c3-times", times.first());

    await page.getByRole("button", { name: "התורים שלי" }).click();
    await expect(page.getByRole("heading", { name: "התורים שלי" })).toBeVisible({
      timeout: 15_000,
    });
    await photograph(page, "c4-mine", page.getByText("סטודיו ליה").first());
  });

  test("the owner's four screens", async ({ page }) => {
    await page.addInitScript(
      ([key, token]) => window.localStorage.setItem(key as string, token as string),
      ["tor-now.session", barber.token],
    );

    await page.goto(`/manage?business=${barber.id}`);
    await ready(page);
    await expect(page.getByRole("button", { name: /^יומן:/ })).toBeVisible({ timeout: 15_000 });

    // The month, with a day chosen — a month screen photographed on an empty
    // diary is a screenshot of nothing happening.
    await openTheDayOf(page, day);
    await expect(page.getByText("אורי שגב").first()).toBeVisible({ timeout: 15_000 });
    await photograph(page, "o1-month", page.getByRole("button", { name: /^יומן:/ }));

    // The same day with every chair at once, which is the shape of the problem
    // a shop with two seats actually has, and scrolled past the month so the
    // picture is the diary rather than the grid above it.
    await showEveryCalendar(page);
    await expect(page.getByText("אורי שגב").first()).toBeVisible({ timeout: 15_000 });
    // Past the month, so the picture is the two lanes rather than the grid
    // above them. scrollIntoViewIfNeeded would do nothing here — the diary is
    // already on screen, it is simply sharing it.
    await page.mouse.move(195, 600);
    await page.mouse.wheel(0, 460);
    await photograph(page, "o2-day", page.getByText("אורי שגב").first());

    // The thing an owner actually does all day: somebody rings while the diary
    // is open, and the next appointment is made from this side of the counter.
    // It starts where the free hour is, which is why the picture is worth
    // taking from the gap rather than from a menu.
    await aFreeStretch(page).first().click();
    await page.getByRole("button", { name: "תור ללקוח" }).click();
    const sheet = page.getByRole("dialog");
    // Not filtered down to one: the point of the picture is that the people who
    // already come here are simply listed, with no typing at all. Which of them
    // the list has room for is the picker's business and not this test's, so
    // what is asserted is that the shop's own customers are in it.
    const someoneKnown = /שגב|פרץ|רוזן|מזרחי|ברק|אלון|דגן|שלו/;
    await expect(sheet.getByText(someoneKnown).first()).toBeVisible({ timeout: 15_000 });
    await photograph(page, "o3-booking", sheet.getByText(someoneKnown).first());
    await page.keyboard.press("Escape");

    await page.goto(`/manage?business=${barber.id}`);
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await expect(page.getByText("תספורת וזקן").first()).toBeVisible({ timeout: 15_000 });
    await photograph(page, "o4-panel", page.getByText("תספורת וזקן").first());
  });

  /**
   * Seven pictures, seven pictures.
   *
   * A click that misses is silent — the screen simply stays where it was, the
   * next capture photographs it again, and the page ends up showing the same
   * screen twice under two different captions. That is not a hypothetical: it
   * is what shipped, and this is the assertion that would have caught it.
   */
  test("every screen is a different screen", async () => {
    const names = [
      "c1-map",
      "c2-business",
      "c3-times",
      "c4-mine",
      "o1-month",
      "o2-day",
      "o3-booking",
      "o4-panel",
    ];
    const seen = new Map<string, string>();
    for (const name of names) {
      const fingerprint = createHash("sha256")
        .update(readFileSync(`${SHOTS}/${name}.jpg`))
        .digest("hex");
      const twin = seen.get(fingerprint);
      expect(twin, `${name} is the same picture as ${twin}`).toBeUndefined();
      seen.set(fingerprint, name);
    }
  });
});
