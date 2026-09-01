/**
 * Seeds a working demo: three people, two businesses, real availability and a
 * booking that already exists.
 *
 * Everything except the first administrator goes through the HTTP API, so the
 * seed exercises the same validation, Row Level Security and audit trail a real
 * user would — a fixture inserted straight into the database proves nothing
 * about whether the system works.
 *
 * ADR 0010 seeds the first administrator by migration, because there is no
 * self-service route to that flag; scripts/seed-administrator.sql does that
 * part, and this script assumes it has run.
 *
 * Usage: node scripts/seed.mjs [apiBaseUrl]
 */

const API = process.argv[2] ?? process.env.API_URL ??
  "https://kbybnveitlxkffqptvqm.supabase.co/functions/v1/api";

const call = async (path, { method = "GET", body, token } = {}) => {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  const payload = text === "" ? null : JSON.parse(text);
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status} ${JSON.stringify(payload)}`);
  }
  return payload;
};

/** ADR 0004: the same two steps for everybody, seeded or not. */
const signIn = async (phone, name) => {
  const [givenName, ...rest] = name.split(" ").filter((part) => part !== "");
  const { code } = await call("/auth/request-code", { method: "POST", body: { phone } });
  if (code === undefined) {
    throw new Error(
      "The API did not return a verification code, so this deployment has a real " +
        "delivery channel configured and cannot be seeded without receiving it.",
    );
  }
  return call("/auth/verify", {
    method: "POST",
    body: {
      phone,
      code,
      name: {
        givenName: givenName ?? name,
        familyName: rest.length === 0 ? null : rest.join(" "),
      },
    },
  });
};

const WEEKDAYS_SUN_TO_THU = [0, 1, 2, 3, 4];

const hours = (start, end, days = WEEKDAYS_SUN_TO_THU) =>
  days.map((dayOfWeek) => ({ dayOfWeek, start, end }));

const BUSINESSES = [
  {
    owner: { phone: "+972521110001", name: "רן לוי" },
    business: {
      name: "מספרת רן",
      phone: "+972521110001",
      address: "דיזנגוף 100, תל אביב",
      description: "מספרה שכונתית. תספורות גברים, זקן וטיפוח.",
      resourceNames: ["רן", "עמית"],
      services: [
        { name: "תספורת גבר", durationMinutes: 30, priceMinor: 8000, bufferMinutes: 5 },
        { name: "תספורת + זקן", durationMinutes: 45, priceMinor: 12000, bufferMinutes: 5 },
        { name: "עיצוב זקן", durationMinutes: 20, priceMinor: 5000, bufferMinutes: null },
      ],
      // Two ranges on a Sunday: the gap between them is the lunch break, which
      // ADR 0002 has no separate entity for.
      workingHours: [
        ...hours("09:00", "13:00"),
        ...hours("16:00", "20:00"),
        { dayOfWeek: 5, start: "09:00", end: "13:00" },
      ],
    },
  },
  {
    owner: { phone: "+972521110002", name: "מיכל ברק" },
    business: {
      name: "קליניקת מיכל — פיזיותרפיה",
      phone: "+972521110002",
      address: "הרצל 42, רמת גן",
      description: "פיזיותרפיה, טיפול בכאבי גב וצוואר, שיקום לאחר פציעה.",
      resourceNames: ["מיכל"],
      services: [
        { name: "אבחון ראשוני", durationMinutes: 60, priceMinor: 35000, bufferMinutes: 15 },
        { name: "טיפול המשך", durationMinutes: 45, priceMinor: 28000, bufferMinutes: 15 },
      ],
      workingHours: hours("08:00", "16:00"),
    },
  },
];

const CUSTOMER = { phone: "+972521110003", name: "דנה כהן" };

const main = async () => {
  const health = await call("/health");
  console.log(`API ${API}`);
  console.log(`  verification: ${health.verificationTransport}, notifications: ${health.notificationTransport}`);

  for (const entry of BUSINESSES) {
    const session = await signIn(entry.owner.phone, entry.owner.name);
    const existing = await call("/me/businesses", { token: session.token });
    if (existing.length > 0) {
      console.log(`  ${entry.business.name} — already present, skipped`);
      continue;
    }
    const business = await call("/businesses", {
      method: "POST",
      body: entry.business,
      token: session.token,
    });
    console.log(`  ${business.name} — registered (${business.id})`);
  }

  // A customer with one appointment already in the diary, so the owner's
  // calendar and the customer's list both have something in them on first open.
  const customer = await signIn(CUSTOMER.phone, CUSTOMER.name);
  const [firstBusiness] = await call(
    `/businesses/search?q=${encodeURIComponent("מספרת")}`,
  );
  if (firstBusiness === undefined) throw new Error("Seeded business is not searchable");

  const profile = await call(`/businesses/${firstBusiness.id}`);
  const service = profile.services[0];
  const resource = profile.resources[0];

  const today = new Intl.DateTimeFormat("en-CA", { timeZone: firstBusiness.timeZone }).format(new Date());
  const inAWeek = new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10);
  const days = await call(
    `/businesses/${firstBusiness.id}/availability?serviceId=${service.id}` +
      `&resourceId=${resource.id}&from=${today}&to=${inAWeek}`,
  );
  const dayWithSlots = days.find((day) => day.slots.length > 0);

  if (dayWithSlots === undefined) {
    console.log("  no free slot in the next week — skipped the sample booking");
  } else {
    const existing = await call("/me/appointments", { token: customer.token });
    if (existing.some((appointment) => appointment.status === "CONFIRMED")) {
      console.log("  sample booking already present, skipped");
    } else {
      const slot = dayWithSlots.slots[Math.min(2, dayWithSlots.slots.length - 1)];
      const appointment = await call("/appointments", {
        method: "POST",
        token: customer.token,
        body: {
          businessId: firstBusiness.id,
          serviceId: service.id,
          resourceId: resource.id,
          startAt: slot.startAt,
          customerNote: null,
        },
      });
      console.log(`  booked ${appointment.serviceName} at ${appointment.startAt}`);
    }
  }

  console.log("\nSeeded. Sign in with any of these numbers; the API returns the code.");
  for (const entry of BUSINESSES) console.log(`  owner    ${entry.owner.phone}  ${entry.owner.name}`);
  console.log(`  customer ${CUSTOMER.phone}  ${CUSTOMER.name}`);
};

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
