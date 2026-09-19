import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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

/** The artboard the interface is designed against. */
const FRAME = { width: 390, height: 844 };

/**
 * Record one flow, as a film.
 *
 * Some of what this product does cannot be photographed. "Search and filter" is
 * a verb; so is "pick an hour and confirm it" — the still that tried to show it
 * was a screen caught halfway through a scroll, with its top sliced off and no
 * way for a reader to tell what had happened. A short silent loop of the real
 * thing being used says it in three seconds and cannot be cropped into
 * nonsense.
 *
 * The browser records the whole life of the context, so the setup — a blank
 * page, a navigation, a first paint — is at the front of every take and gets
 * trimmed off by the clock. What is left is the story.
 *
 * Out as H.264: it is the one format every browser plays, it is a fraction of
 * the size of the equivalent GIF at the same length, and unlike a GIF it can be
 * told not to play until somebody has scrolled to it.
 */
const film = async (
  browser: Browser,
  name: string,
  setUp: (page: Page) => Promise<void>,
  story: (page: Page) => Promise<void>,
  options: { session?: string | undefined } = {},
): Promise<void> => {
  const reel = mkdtempSync(join(tmpdir(), "tor-now-film-"));
  const context = await browser.newContext({
    viewport: FRAME,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: "he-IL",
    timezoneId: "Asia/Jerusalem",
    permissions: ["geolocation"],
    geolocation: HERE,
    // The recording is the size of the viewport, not twice it: asked for more,
    // the browser does not render larger — it pads the page into the corner of
    // a bigger canvas and the clip comes out quarter-size on a grey field. The
    // scaling up happens in the encoder instead, where it is honest about being
    // scaling.
    recordVideo: { dir: reel, size: FRAME },
  });
  const started = Date.now();
  try {
    const page = await context.newPage();
    if (options.session !== undefined) {
      await page.addInitScript(
        ([key, token]) => window.localStorage.setItem(key as string, token as string),
        ["tor-now.session", options.session],
      );
    }
    await setUp(page);
    // Everything before this instant is a browser opening a page, which is not
    // what the clip is about.
    const lead = (Date.now() - started) / 1000;
    await story(page);
    // A beat on the last frame, so the loop does not snap away from the thing
    // it has just finished showing.
    await page.waitForTimeout(1400);
    const runFor = (Date.now() - started) / 1000 - lead;

    const video = page.video();
    expect(video, `${name}: nothing was recorded`).not.toBeNull();
    await context.close();
    const raw = await video!.path();

    encode(raw, name, lead, runFor);
  } finally {
    await context.close().catch(() => {});
    rmSync(reel, { recursive: true, force: true });
  }
};

/**
 * The take, as something a browser will play.
 *
 * A poster too, from the first frame: without one the phone on the page is a
 * black rectangle until the video decodes, and on a connection slow enough to
 * notice, a black rectangle is what somebody decides the product looks like.
 */
const encode = (raw: string, name: string, from: number, runFor: number): void => {
  const out = `${SHOTS}/${name}.mp4`;
  try {
    execFileSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-ss", String(from), "-t", String(runFor), "-i", raw,
       "-vf", `scale=${FRAME.width * 2}:-2:flags=lanczos,fps=24`,
       "-an", "-c:v", "libx264", "-preset", "slow", "-crf", "27",
       "-pix_fmt", "yuv420p", "-movflags", "+faststart", out],
      { stdio: "pipe" },
    );
    execFileSync(
      "ffmpeg",
      ["-y", "-loglevel", "error", "-i", out, "-frames:v", "1", "-q:v", "4",
       `${SHOTS}/${name}-poster.jpg`],
      { stdio: "pipe" },
    );
  } catch (trouble) {
    throw new Error(
      `ffmpeg could not encode ${name}. It is needed to turn the recording into ` +
        `something a browser will play: brew install ffmpeg.\n${String(trouble)}`,
    );
  }
};

/**
 * Scroll until something sits where the picture wants it.
 *
 * Scrolling by a guessed number of pixels is how both halves of this go wrong:
 * too little and the screen above is still sliced across the top edge, too much
 * and the subject is gone off it. Neither fails — both just produce a
 * photograph of something else. So the target is a position, and the page is
 * nudged until the subject is actually at it.
 */
const bring = async (page: Page, subject: Locator, toY: number): Promise<void> => {
  await page.mouse.move(FRAME.width / 2, FRAME.height * 0.7);
  for (let nudge = 0; nudge < 8; nudge += 1) {
    const box = await subject.boundingBox();
    if (box === null) break;
    const drift = box.y - toY;
    if (Math.abs(drift) < 6) return;
    await page.mouse.wheel(0, drift);
    await page.waitForTimeout(130);
  }
  const settled = await subject.boundingBox();
  expect(settled, "the subject left the page while scrolling to it").not.toBeNull();
  // The page may simply have run out of scroll, which is worth saying plainly
  // rather than discovering later in a photograph.
  expect(
    Math.abs(settled!.y - toY),
    `could not bring the subject to ${toY}px — the page stops at ${settled!.y}px`,
  ).toBeLessThan(40);
};

/**
 * Wait until the map has a map on it.
 *
 * The pins arrive from our own API and the ground they sit on comes from
 * OpenStreetMap, and only the first of those is fast. Waiting for a pin and
 * then photographing gave a screen of markers floating on blank grey — a map
 * with no map, which is a worse picture than no map at all, and one that fails
 * silently because every element the test asked about was present.
 *
 * Leaflet marks each tile `leaflet-tile-loaded` as it paints, so the question
 * "has the ground arrived" has a real answer. Enough of them to cover the
 * frame, not merely one.
 */
const TILES_TO_COVER_THE_FRAME = 6;

const waitForTheGround = async (page: Page): Promise<void> => {
  const painted = page.locator("img.leaflet-tile-loaded");
  await expect
    .poll(() => painted.count(), {
      timeout: 30_000,
      message:
        "the map never drew its tiles — openstreetmap.org may be unreachable " +
        "or throttling this address, and a map of nothing is not worth shipping",
    })
    .toBeGreaterThanOrEqual(TILES_TO_COVER_THE_FRAME);
  // Painted is not the same as settled: the last few fade in.
  await page.waitForTimeout(700);
};

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
/**
 * A shop's place, as metres from where the customer is standing.
 *
 * Two numbers rather than one. A single distance can only put everything on
 * one diagonal, and eleven pins strung along a line through the middle of the
 * map is the one arrangement no real street produces — it reads as a fixture
 * the moment you look at it.
 */
const at = (north: number, east: number) => ({
  latitude: HERE.latitude + north / 111_000,
  longitude: HERE.longitude + east / 94_000,
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
  at: { north: number; east: number };
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
      ...at(shop.at.north, shop.at.east),
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
  // In the upper half, which is where a subject sits when the screen has
  // actually been scrolled to it rather than merely reaching it at the edge.
  expect(box!.y, `${name}: its subject is off the bottom of the frame`)
    .toBeLessThan(frame!.height * 0.5);
  expect(box!.y + box!.height, `${name}: its subject is off the top`).toBeGreaterThan(0);

  await page.screenshot({ path: `${SHOTS}/${name}.jpg`, quality: 78 });
};

test.describe("@shots the front door's photographs", () => {
  // One story, told in order: the street exists before anybody searches it.
  test.describe.configure({ mode: "serial" });

  // The artboard the interface is designed against, so the picture is the
  // screen and nothing else — no strip of desk down either side.
  test.use({ viewport: FRAME, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

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
      at: { north: 140, east: 90 },
      description: "מספרה שכונתית עם שתי עמדות. אפשר גם בלי לתאם מראש, אבל עדיף עם.",
      resourceNames: ["רן", "שימי"],
      services: [
        { name: "תספורת גבר", durationMinutes: 30, priceMinor: 8000 },
        { name: "תספורת וזקן", durationMinutes: 45, priceMinor: 11000 },
        { name: "עיצוב זקן", durationMinutes: 20, priceMinor: 5000 },
        { name: "תספורת ילד", durationMinutes: 25, priceMinor: 6000 },
      ],
      // Eight until nine, which is a barbershop's day and also the reason the
      // day screen has something to scroll. A diary shorter than the screen
      // cannot be scrolled clear of the month above it, and a month sliced
      // along the top edge is the one thing a reader cannot parse.
      hours: { start: "08:00", end: "21:00" },
    });

    salon = await openA({
      name: "סטודיו ליה",
      phone: fakePhone(2),
      category: "hair_salon",
      address: "דיזנגוף 168, תל אביב",
      at: { north: 330, east: -120 },
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
      at: { north: -180, east: 240 },
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
      at: { north: 520, east: 180 },
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
      at: { north: -350, east: -260 },
      description: "עיסוי רקמות עמוק, שוודי ורפואי.",
      resourceNames: ["שקד"],
      services: [{ name: "עיסוי שוודי", durationMinutes: 60, priceMinor: 30000 }],
      hours: { start: "10:00", end: "21:00" },
    });
    // More of the same trade, so filtering to one produces a list rather than a
    // single card with the rest of the screen empty. A filter that narrows six
    // businesses to one is not a filter anybody can see working.
    // Hours differ from shop to shop, which is both true of a street and the
    // reason the list is worth reading: a column of results all saying the same
    // thing about whether they are open is a column with nothing in it. It also
    // keeps the pictures alive when the captures are taken late — one shop
    // shutting at eight and another at eleven is a street either way.
    const alsoHair: [string, string, string, [number, number], string, number, string][] = [
      ["מספרת אבי", "barbershop", "דיזנגוף 96, תל אביב", [-240, 330], "תספורת גבר", 7000, "10:00-22:00"],
      ["ברבר שופ בן יהודה", "barbershop", "בן יהודה 174, תל אביב", [420, -520], "תספורת גבר", 9000, "09:00-23:00"],
      ["מספרת הצפון", "barbershop", "ארלוזורוב 33, תל אביב", [820, 260], "תספורת גבר", 7500, "09:00-19:00"],
      ["סטודיו רותם", "hair_salon", "פרישמן 42, תל אביב", [-120, -300], "צבע ופן", 26000, "09:00-20:00"],
      ["שיער של תמי", "hair_salon", "גורדון 18, תל אביב", [250, 470], "פן", 11000, "10:00-23:00"],
    ];
    for (const [name, category, address, where, service, priceMinor, open] of alsoHair) {
      await openA({
        name,
        phone: fakePhone(40 + alsoHair.findIndex(([other]) => other === name)),
        category,
        address,
        at: { north: where[0], east: where[1] },
        description: "",
        resourceNames: ["יומן"],
        services: [{ name: service, durationMinutes: 30, priceMinor }],
        hours: { start: open.slice(0, 5), end: open.slice(6) },
      });
    }

    await openA({
      name: "סטודיו פילאטיס אורית",
      phone: fakePhone(6),
      category: "pilates",
      address: "ארלוזורוב 11, תל אביב",
      at: { north: 700, east: -420 },
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
      [fakePhone(28), { givenName: "אלון", familyName: "כהן" }, "תספורת וזקן", "רן", "17:30"],
      [fakePhone(29), { givenName: "ניר", familyName: "אבידן" }, "תספורת גבר", "שימי", "19:00"],
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

    // Somebody the shop knows who is *not* in the composed day. The filmed
    // booking picks him, and picking anybody already in that day puts the sheet
    // into its "they have one of these today" warning — which is the right
    // behaviour and the wrong clip.
    await bookFrom(
      barber,
      await signIn(fakePhone(30), { givenName: "אמיר", familyName: "טל" }),
      "תספורת גבר",
      "רן",
      aDayFromNow(9),
      "12:00",
    );

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
    await waitForTheGround(page);
    await photograph(page, "c2-map", map.getByTitle("סטודיו ליה"));

    await map.getByTitle("סטודיו ליה").dispatchEvent("click");
    await map.getByRole("button", { name: "לקביעת תור" }).click();
    await expect(page.getByText("בוחרים שירות")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("צבע ופן").first()).toBeVisible();
    await photograph(page, "c3-business", page.getByText("צבע ופן").first());

    // Picking an hour is not a screen, it is a sequence — scroll, choose,
    // confirm — and the still that stood for it was caught mid-scroll with its
    // top sliced off. It is filmed instead, below.

    await page.getByRole("button", { name: "התורים שלי" }).click();
    await expect(page.getByRole("heading", { name: "התורים שלי" })).toBeVisible({
      timeout: 15_000,
    });
    await photograph(page, "c5-mine", page.getByText("סטודיו ליה").first());
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
    // Clear of the month rather than halfway through it. A screen with a row of
    // date squares sliced off along its top edge is the one thing a reader
    // cannot make sense of — it reads as a rendering fault rather than as a
    // calendar that has been scrolled. Either the month is the picture or the
    // diary is.
    const lane = page.getByText("שימי", { exact: true }).first();
    await expect(lane).toBeVisible();
    // Just under the app's own header, so the two lanes start at the top of the
    // frame and the month is gone rather than sliced.
    await bring(page, lane, 104);
    await photograph(page, "o2-day", lane);

    // Who comes here, and what they have had. Booking somebody in is filmed
    // rather than photographed: it is a sequence, and the still that stood for
    // it could only ever be one moment out of five.
    await page.getByRole("button", { name: "לקוחות" }).click();
    const someoneKnown = /שגב|פרץ|רוזן|מזרחי|ברק|אלון|דגן|שלו|אבידן/;
    await expect(page.getByText(someoneKnown).first()).toBeVisible({ timeout: 15_000 });
    await photograph(page, "o4-customers", page.getByText(someoneKnown).first());

    await page.goto(`/manage?business=${barber.id}`);
    await ready(page);
    await page.getByRole("button", { name: "העסק" }).click();
    await expect(page.getByText("תספורת וזקן").first()).toBeVisible({ timeout: 15_000 });
    await photograph(page, "o5-panel", page.getByText("תספורת וזקן").first());
  });

  test("searching and filtering, filmed", async ({ browser }) => {
    await film(
      browser,
      "c1-search",
      async (page) => {
        await page.goto("/");
        await ready(page);
        await expect(page.getByRole("group", { name: "סוגי עסקים" })).toBeVisible();
      },
      async (page) => {
        const box = page.getByRole("combobox", { name: "מספרה, קליניקה, מאמן אישי…" });
        await box.click();
        await page.waitForTimeout(500);
        // Typed rather than filled, because the point of the clip is the
        // product answering while somebody is still typing.
        await box.pressSequentially("ספר", { delay: 190 });
        await page.waitForTimeout(1100);
        await page.getByRole("option", { name: /^מספרה \/ ספר/ }).click();
        await page.waitForTimeout(1500);

        // And the other half of it: narrowing by hand, from the strip.
        await box.fill("");
        await page.waitForTimeout(700);
        await page.getByRole("group", { name: "סוגי עסקים" })
          .getByRole("button", { name: "מספרת נשים" })
          .click();
        await page.waitForTimeout(1600);
        await box.pressSequentially("ליה", { delay: 190 });
        await page.waitForTimeout(1800);
      },
      { session: dana },
    );
  });

  test("choosing an hour and confirming it, filmed", async ({ browser }) => {
    await film(
      browser,
      "c4-book",
      async (page) => {
        await page.goto(`/business/${salon.id}`);
        await ready(page);
        await expect(page.getByText("בוחרים שירות")).toBeVisible({ timeout: 15_000 });
      },
      async (page) => {
        await page.waitForTimeout(700);
        await page.getByRole("button", { name: /צבע ופן/ }).click();
        await page.waitForTimeout(900);
        // A day ahead: a shop filmed at six in the evening has almost nothing
        // left to offer, and an empty grid argues against the product.
        await showDay(page, 2);
        await page.waitForTimeout(900);

        // Scrolled in steps rather than jumped, so the clip shows somebody
        // moving down the page instead of the page teleporting.
        await page.mouse.move(195, 600);
        for (let nudge = 0; nudge < 5; nudge += 1) {
          await page.mouse.wheel(0, 150);
          await page.waitForTimeout(140);
        }
        const times = page.locator("[role=radio]", { hasText: /^\d\d:\d\d$/ });
        await expect(times.first()).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(900);

        await times.nth(2).click();
        await page.waitForTimeout(1100);
        await page.getByRole("button", { name: "אישור התור" }).click();
        await expect(page.getByText("התור נקבע")).toBeVisible({ timeout: 20_000 });
      },
      { session: dana },
    );
  });

  test("an owner booking somebody in, filmed", async ({ browser }) => {
    await film(
      browser,
      "o3-booking",
      async (page) => {
        await page.goto(`/manage?business=${barber.id}`);
        await ready(page);
        await openTheDayOf(page, day);
        await expect(page.getByText("אורי שגב").first()).toBeVisible({ timeout: 15_000 });
      },
      async (page) => {
        await page.mouse.move(195, 600);
        await page.mouse.wheel(0, 500);
        await page.waitForTimeout(900);

        await aFreeStretch(page).first().click();
        await page.waitForTimeout(900);
        await page.getByRole("button", { name: "תור ללקוח" }).click();
        const sheet = page.getByRole("dialog");
        await expect(sheet).toBeVisible({ timeout: 15_000 });
        await page.waitForTimeout(1300);

        // Somebody the shop already knows, found by name. Not chosen off the
        // top of the list: everybody in that list is already in this day, and
        // the sheet would rightly answer with its "they have one of these
        // today" warning — true, and not what the clip is about.
        await sheet.getByPlaceholder("חיפוש לפי שם או טלפון").pressSequentially("אמיר", {
          delay: 180,
        });
        await page.waitForTimeout(800);
        await sheet.getByText("אמיר טל").first().click();
        await page.waitForTimeout(900);
        await sheet.getByRole("button", { name: /^תספורת גבר/ }).click();
        await page.waitForTimeout(1000);
        await sheet.getByRole("button", { name: /^\d\d:\d\d$/ }).first().click();
        await page.waitForTimeout(900);
        await sheet.getByRole("button", { name: /^קביעה ל־/ }).click();
        await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
        await page.waitForTimeout(700);
      },
      { session: barber.token },
    );
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
    const stills = ["c2-map", "c3-business", "c5-mine", "o1-month", "o2-day",
                    "o4-customers", "o5-panel"];
    const films = ["c1-search", "c4-book", "o3-booking"];

    const seen = new Map<string, string>();
    const distinct = (name: string, file: string) => {
      const fingerprint = createHash("sha256").update(readFileSync(file)).digest("hex");
      const twin = seen.get(fingerprint);
      expect(twin, `${name} is the same picture as ${twin}`).toBeUndefined();
      seen.set(fingerprint, name);
    };

    for (const name of stills) distinct(name, `${SHOTS}/${name}.jpg`);
    // A film's poster is its first frame, so the posters have to differ from
    // each other and from every still for the same reason the stills do.
    for (const name of films) distinct(`${name} (poster)`, `${SHOTS}/${name}-poster.jpg`);

    // And the films themselves are films: an encode that silently produced
    // nothing leaves a file a browser will sit on forever showing the poster.
    for (const name of films) {
      const reel = readFileSync(`${SHOTS}/${name}.mp4`);
      expect(reel.byteLength, `${name}.mp4 is empty`).toBeGreaterThan(20_000);
    }
  });
});
