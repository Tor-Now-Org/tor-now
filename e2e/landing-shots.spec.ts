import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { aDayFromNow, anInstantAt, call, ready } from "./support.ts";
import { TONGUES, type Person, type Tongue, type Trade } from "./landing-street.ts";

/**
 * The photographs and the films on the front door.
 *
 * `/welcome` claims the product does a handful of things, and the honest way to
 * make that claim is to show the product doing them. So none of this is a
 * mockup: the suite stands up the whole system the way every other journey
 * does, seeds a street of shops with names, prices and customers, drives the
 * real screens, and photographs or films them into `public/landing`.
 *
 * Which means a screen that changes shape is re-taken rather than redrawn, and
 * the front door cannot quietly drift into advertising a product that no longer
 * exists.
 *
 * Twice over, once per language. The page turns into English and its pictures
 * have to turn with it — a translated page wrapped around screenshots in
 * another alphabet says the translation is a veneer. The shops and the
 * customers are data rather than interface, so they do not translate; each
 * language gets its own street, in e2e/landing-street.ts.
 *
 * Not part of the suite — it writes into the repository, and a test that edits
 * the working tree has no business running on every push:
 *
 *     npm run shots
 *
 * ffmpeg is needed for the films. Every telephone number is visibly invented:
 * a screenshot is published, and a plausible number in a published screenshot
 * is somebody's real phone ringing.
 */

const SHOTS = "apps/web/public/landing";

/** The artboard the interface is designed against. */
const FRAME = { width: 390, height: 844 };

/**
 * Where the street is.
 *
 * The customer stands at the top of it, so the nearby list and the map open
 * with real distances rather than every shop at one point.
 */
const HERE = { latitude: 32.0796, longitude: 34.7737 };

/**
 * A shop's place, as metres from where the customer is standing.
 *
 * Two numbers rather than one. A single distance can only put everything on one
 * diagonal, and eleven pins strung along a line through the middle of the map
 * is the one arrangement no real street produces — it reads as a fixture the
 * moment you look at it.
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

/**
 * Sign somebody in, once.
 *
 * A regular is booked into several weeks of the diary, and asking for a
 * verification code before each one is both untrue to what a person does and
 * enough to trip the product's own rate limit — which is working correctly, and
 * which the seed has no business arguing with.
 */
const sessions = new Map<string, string>();

const signIn = async (phone: string, name: Person): Promise<string> => {
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

const openA = async (shop: Trade, phone: string): Promise<Shop> => {
  const token = await signIn(phone, { givenName: "Owner", familyName: shop.name });
  const made = await call<{ id: string }>("/businesses", {
    method: "POST",
    token,
    body: {
      name: shop.name,
      phone,
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
 * Book the first time this shop offers at or after a wanted hour.
 *
 * The diary in these pictures is composed — a busy morning, a gap over lunch, a
 * thinner afternoon — because a helper that simply took "the next free slot"
 * would pack every appointment nose to tail and photograph a day no shop has.
 *
 * At or after, rather than exactly: what a shop offers sits on a grid its own
 * service lengths draw, so a forty-five minute cut has no 10:00 to give once
 * the morning has started. Naming 10:00 says where in the day this belongs and
 * lets the shop answer with the hour it actually has, which is the same thing a
 * person on the telephone would accept.
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
 * Wait until the map has a map on it.
 *
 * The pins arrive from our own API and the ground they sit on comes from
 * OpenStreetMap, and only the first of those is fast. Waiting for a pin and
 * then photographing gave a screen of markers floating on blank grey — a map
 * with no map, which is a worse picture than no map at all, and one that failed
 * silently because every element the test asked about was present.
 *
 * Leaflet marks each tile `leaflet-tile-loaded` as it paints, so "has the
 * ground arrived" has a real answer. Enough of them to cover the frame, not
 * merely one.
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
  into: string,
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

  await page.screenshot({ path: `${into}/${name}.jpg`, quality: 78 });
};

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
  tongue: Tongue,
  name: string,
  setUp: (page: Page) => Promise<void>,
  story: (page: Page) => Promise<void>,
  session: string,
): Promise<void> => {
  const reel = mkdtempSync(join(tmpdir(), "tor-now-film-"));
  const context = await browser.newContext({
    viewport: FRAME,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
    locale: tongue.code === "he" ? "he-IL" : "en-GB",
    timezoneId: "Asia/Jerusalem",
    permissions: ["geolocation"],
    geolocation: HERE,
    // The recording is the size of the viewport, not twice it: asked for more,
    // the browser does not render larger — it pads the page into the corner of
    // a bigger canvas and the clip comes out quarter-size on a grey field. The
    // scaling up happens in the encoder, where it is honest about being scaling.
    recordVideo: { dir: reel, size: FRAME },
  });
  const started = Date.now();
  try {
    const page = await context.newPage();
    await remember(page, session, tongue);
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
    encode(await video!.path(), `${SHOTS}/${tongue.code}`, name, lead, runFor);
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
const encode = (raw: string, into: string, name: string, from: number, runFor: number): void => {
  const out = `${into}/${name}.mp4`;
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
       `${into}/${name}-poster.jpg`],
      { stdio: "pipe" },
    );
  } catch (trouble) {
    throw new Error(
      `ffmpeg could not encode ${name}. It is needed to turn the recording into ` +
        `something a browser will play: brew install ffmpeg.\n${String(trouble)}`,
    );
  }
};

/** Who is looking, and in which language — before the first paint. */
const remember = async (page: Page, session: string, tongue: Tongue): Promise<void> => {
  await page.addInitScript(
    ([token, language]) => {
      window.localStorage.setItem("tor-now.session", token as string);
      window.localStorage.setItem("tor-now.language", language as string);
    },
    [session, tongue.code],
  );
};

for (const tongue of TONGUES) {
  const { words, street } = tongue;
  const into = `${SHOTS}/${tongue.code}`;
  /** Nobody can answer these, and the two languages never share a customer. */
  const fakePhone = (n: number) => `${tongue.dial}${String(n).padStart(2, "0")}`;

  /** A stretch of free time on the day timeline — the word and its separator. */
  const aFreeStretch = (page: Page) =>
    page.getByRole("button").filter({ hasText: new RegExp(`${words.free}\\s*·`) });

  const showEveryCalendar = async (page: Page): Promise<void> => {
    await page.getByRole("button", { name: new RegExp(`^${words.calendarsWord}:`) }).click();
    await page
      .getByRole("dialog")
      .getByRole("button", { name: new RegExp(words.allCalendars) })
      .click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
  };

  const openTheDay = async (page: Page, date: string): Promise<void> => {
    const square = page.getByRole("button", { name: date });
    for (let turns = 0; turns < 6 && (await square.count()) === 0; turns += 1) {
      await page.getByRole("button", { name: words.nextMonth }).click();
      await page.waitForTimeout(300);
    }
    await square.click({ timeout: 15_000 });
  };

  /** Select one day of the customer's strip by its distance from today. */
  const showDay = async (page: Page, day: number): Promise<void> => {
    if (day === 0) return;
    await page
      .getByRole("radiogroup", { name: words.today })
      .getByRole("radio")
      .nth(day)
      .click();
  };

  test.describe(`@shots the front door's pictures, in ${tongue.code}`, () => {
    // One story, told in order: the street exists before anybody searches it.
    test.describe.configure({ mode: "serial" });

    // The artboard the interface is designed against, so the picture is the
    // screen and nothing else — no strip of desk down either side.
    test.use({ viewport: FRAME, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

    const day = aDayFromNow(4);
    let barber: Shop;
    let salon: Shop;
    let her: string;

    test("seeds a street, a diary and a customer", async () => {
      mkdirSync(into, { recursive: true });

      barber = await openA(street.barber, fakePhone(1));
      salon = await openA(street.salon, fakePhone(2));
      const nails = await openA(street.nails, fakePhone(3));
      const clinic = await openA(street.clinic, fakePhone(4));
      await openA(street.masseur, fakePhone(5));
      await openA(street.pilates, fakePhone(6));
      // More of the same two trades, so filtering to one produces a list rather
      // than a single card with the rest of the screen empty. A filter that
      // narrows six businesses to one is not a filter anybody can see working.
      for (const [nth, also] of street.alsoHair.entries()) {
        await openA(also, fakePhone(40 + nth));
      }

      // A day at the barbershop, composed rather than generated.
      for (const [nth, sitting] of street.day.entries()) {
        await bookFrom(
          barber,
          await signIn(fakePhone(20 + nth), sitting.who),
          sitting.service,
          sitting.chair,
          day,
          sitting.from,
        );
      }

      // The rest of the month. A diary with one full day in it and twenty empty
      // ones is not a working shop, and the month screen — whose whole argument
      // is "the month, at a glance" — has nothing to show at a glance unless
      // the month has been worked. Names repeat across the weeks, because
      // customers come back, and that is the point of keeping a diary at all.
      const hours = ["09:00", "10:30", "12:00", "14:00", "15:30", "17:00"];
      for (let ahead = 1; ahead <= 20; ahead += 1) {
        if (ahead === 4) continue; // The composed day, already filled above.
        const when = aDayFromNow(ahead);
        // Two or three a day, which is what the month's dots are counting.
        for (let nth = 0; nth < 2 + (ahead % 2); nth += 1) {
          const seat = ahead * 3 + nth;
          const who = street.regulars[seat % street.regulars.length]!;
          const sat = street.day.findIndex((one) => one.who.givenName === who.givenName);
          await bookFrom(
            barber,
            await signIn(fakePhone(20 + sat), who),
            street.cuts[seat % street.cuts.length]!,
            street.barber.resourceNames[seat % 2]!,
            when,
            hours[seat % hours.length]!,
          );
        }
      }

      // Somebody the shop knows who is *not* in the composed day. The filmed
      // booking picks him, and picking anybody already in that day puts the
      // sheet into its "they have one of these today" warning — which is the
      // right behaviour and the wrong clip.
      await bookFrom(
        barber,
        await signIn(fakePhone(30), street.newcomer),
        street.cuts[0]!,
        street.barber.resourceNames[0]!,
        aDayFromNow(9),
        "12:00",
      );

      // Lunch, so the day has a shape and the screen has something to show that
      // is neither an appointment nor an empty hour.
      const chair = barber.resources.find(
        (one) => one.name === street.barber.resourceNames[0],
      )!;
      await call(`/businesses/${barber.id}/resources/${chair.id}/blocks`, {
        method: "POST",
        token: barber.token,
        body: {
          blocks: [
            {
              startAt: anInstantAt(day, "13:00"),
              endAt: anInstantAt(day, "14:00"),
              reason: street.lunch,
            },
          ],
        },
      });

      // And the customer whose screens these are. Three shops rather than one:
      // what "my appointments" is for is the diary somebody keeps across the
      // businesses they use.
      her = await signIn(fakePhone(10), street.her);
      await bookFrom(salon, her, street.atTheSalon, street.salon.resourceNames[0]!, day, "11:00");
      await bookFrom(
        nails, her, street.atTheNails, street.nails.resourceNames[0]!, aDayFromNow(11), "17:00",
      );
      await bookFrom(
        clinic, her, street.atTheClinic, street.clinic.resourceNames[0]!, aDayFromNow(18), "10:00",
      );
    });

    test("the customer's screens", async ({ page, context }) => {
      await context.grantPermissions(["geolocation"]);
      await context.setGeolocation(HERE);
      await remember(page, her, tongue);

      // The street, on the map. The list below the search box stays empty until
      // somebody types — correctly, since ranking nothing means nothing — so
      // the screen that shows what is around you is the map.
      await page.goto("/");
      await ready(page);
      await page.getByRole("button", { name: new RegExp(`^${words.map}`) }).click();
      const map = page.getByRole("dialog", { name: words.map });
      await expect(map.getByTitle(street.salon.name)).toBeVisible({ timeout: 15_000 });
      await waitForTheGround(page);
      await photograph(page, into, "c2-map", map.getByTitle(street.salon.name));

      await map.getByTitle(street.salon.name).dispatchEvent("click");
      await map.getByRole("button", { name: words.bookTime }).click();
      await expect(page.getByText(words.chooseService)).toBeVisible({ timeout: 15_000 });
      const service = page.getByText(street.atTheSalon).first();
      await expect(service).toBeVisible();
      await photograph(page, into, "c3-business", service);

      // Picking an hour is not a screen, it is a sequence — scroll, choose,
      // confirm — and the still that stood for it was caught mid-scroll with
      // its top sliced off. It is filmed instead, below.

      await page.getByRole("button", { name: words.myAppointments }).click();
      await expect(page.getByRole("heading", { name: words.myAppointments })).toBeVisible({
        timeout: 15_000,
      });
      await photograph(page, into, "c5-mine", page.getByText(street.salon.name).first());
    });

    test("the owner's screens", async ({ page }) => {
      await remember(page, barber.token, tongue);
      const calendarChip = page.getByRole("button", {
        name: new RegExp(`^${words.calendarsWord}:`),
      });
      const first = street.day[0]!;
      const firstCustomer = `${first.who.givenName} ${first.who.familyName}`;

      await page.goto(`/manage?business=${barber.id}`);
      await ready(page);
      await expect(calendarChip).toBeVisible({ timeout: 15_000 });

      // The month, with a day chosen — a month screen photographed on an empty
      // diary is a screenshot of nothing happening.
      await openTheDay(page, day);
      await expect(page.getByText(firstCustomer).first()).toBeVisible({ timeout: 15_000 });
      await photograph(page, into, "o1-month", calendarChip);

      // The same day with every chair at once, which is the shape of the
      // problem a shop with two seats actually has.
      await showEveryCalendar(page);
      await expect(page.getByText(firstCustomer).first()).toBeVisible({ timeout: 15_000 });
      // Clear of the month rather than halfway through it. A screen with a row
      // of date squares sliced off along its top edge is the one thing a reader
      // cannot make sense of — it reads as a rendering fault rather than as a
      // calendar that has been scrolled. Either the month is the picture or the
      // diary is.
      const lane = page.getByText(street.barber.resourceNames[1]!, { exact: true }).first();
      await expect(lane).toBeVisible();
      await bring(page, lane, 104);
      await photograph(page, into, "o2-day", lane);

      // Who comes here, and what they have had. Booking somebody in is filmed
      // rather than photographed: it is a sequence, and the still that stood
      // for it could only ever be one moment out of five.
      await page.getByRole("button", { name: words.tabCustomers }).click();
      // Whoever the list puts at the top, rather than one named person: the
      // order is the product's business — most recent first — and naming a
      // customer here made the picture depend on where that one happened to
      // land, which is how the capture ended up aimed below the fold.
      const anyone = new RegExp(
        street.day.map((sitting) => sitting.who.familyName).join("|"),
      );
      const known = page.getByText(anyone).first();
      await expect(known).toBeVisible({ timeout: 15_000 });
      await photograph(page, into, "o4-customers", known);

      await page.goto(`/manage?business=${barber.id}`);
      await ready(page);
      await page.getByRole("button", { name: words.tabBusiness }).click();
      const priced = page.getByText(street.barber.services[1]!.name).first();
      await expect(priced).toBeVisible({ timeout: 15_000 });
      await photograph(page, into, "o5-panel", priced);
    });

    test("searching and filtering, filmed", async ({ browser }) => {
      // A word the trade and a shop both answer to, so the suggestions have
      // something to say while it is still being typed.
      const typed = tongue.code === "he" ? "ספר" : "barb";
      await film(
        browser,
        tongue,
        "c1-search",
        async (page) => {
          await page.goto("/");
          await ready(page);
          await expect(page.getByRole("group", { name: words.categoryStrip })).toBeVisible();
        },
        async (page) => {
          const box = page.getByRole("combobox", { name: words.searchPlaceholder });
          await box.click();
          await page.waitForTimeout(500);
          // Typed rather than filled, because the point of the clip is the
          // product answering while somebody is still typing.
          await box.pressSequentially(typed, { delay: 190 });
          await page.waitForTimeout(1100);
          await page
            .getByRole("option", { name: new RegExp(`^${words.barbershopKind}`) })
            .click();
          await page.waitForTimeout(1500);

          // And the other half of it: narrowing by hand, from the strip.
          await box.fill("");
          await page.waitForTimeout(700);
          await page
            .getByRole("group", { name: words.categoryStrip })
            .getByRole("button", { name: words.hairSalonKind })
            .click();
          await page.waitForTimeout(1600);
          await box.pressSequentially(street.salon.name.slice(0, 5), { delay: 190 });
          await page.waitForTimeout(1800);
        },
        her,
      );
    });

    test("choosing an hour and confirming it, filmed", async ({ browser }) => {
      await film(
        browser,
        tongue,
        "c4-book",
        async (page) => {
          await page.goto(`/business/${salon.id}`);
          await ready(page);
          await expect(page.getByText(words.chooseService)).toBeVisible({ timeout: 15_000 });
        },
        async (page) => {
          await page.waitForTimeout(700);
          await page.getByRole("button", { name: new RegExp(street.atTheSalon) }).click();
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
          await page.getByRole("button", { name: words.confirmBooking }).click();
          await expect(page.getByText(words.booked)).toBeVisible({ timeout: 20_000 });
        },
        her,
      );
    });

    test("an owner booking somebody in, filmed", async ({ browser }) => {
      const first = street.day[0]!;
      await film(
        browser,
        tongue,
        "o3-booking",
        async (page) => {
          await page.goto(`/manage?business=${barber.id}`);
          await ready(page);
          await openTheDay(page, day);
          await expect(
            page.getByText(`${first.who.givenName} ${first.who.familyName}`).first(),
          ).toBeVisible({ timeout: 15_000 });
        },
        async (page) => {
          await page.mouse.move(195, 600);
          await page.mouse.wheel(0, 500);
          await page.waitForTimeout(900);

          await aFreeStretch(page).first().click();
          await page.waitForTimeout(900);
          await page.getByRole("button", { name: words.appointmentForCustomer }).click();
          const sheet = page.getByRole("dialog");
          await expect(sheet).toBeVisible({ timeout: 15_000 });
          await page.waitForTimeout(1300);

          // Somebody the shop already knows, found by name. Not chosen off the
          // top of the list: everybody in that list is already in this day, and
          // the sheet would rightly answer with its "they have one of these
          // today" warning — true, and not what the clip is about.
          await sheet
            .getByPlaceholder(words.searchCustomer)
            .pressSequentially(street.newcomer.givenName, { delay: 180 });
          await page.waitForTimeout(800);
          await sheet
            .getByText(`${street.newcomer.givenName} ${street.newcomer.familyName}`)
            .first()
            .click();
          await page.waitForTimeout(900);
          await sheet
            .getByRole("button", { name: new RegExp(`^${street.cuts[0]!}`) })
            .click();
          await page.waitForTimeout(1000);
          await sheet.getByRole("button", { name: /^\d\d:\d\d$/ }).first().click();
          await page.waitForTimeout(900);
          await sheet.getByRole("button", { name: words.bookFor }).click();
          await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
          await page.waitForTimeout(700);
        },
        barber.token,
      );
    });

    /**
     * Ten captions, ten different screens.
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

      for (const name of stills) distinct(name, `${into}/${name}.jpg`);
      // A film's poster is its first frame, so the posters have to differ from
      // each other and from every still for the same reason the stills do.
      for (const name of films) distinct(`${name} (poster)`, `${into}/${name}-poster.jpg`);

      // And the films themselves are films: an encode that silently produced
      // nothing leaves a file a browser will sit on forever showing the poster.
      for (const name of films) {
        const reel = readFileSync(`${into}/${name}.mp4`);
        expect(reel.byteLength, `${name}.mp4 is empty`).toBeGreaterThan(20_000);
      }
    });
  });
}
