/**
 * The street the front door's pictures are taken on, in each language the
 * product speaks.
 *
 * `/welcome` turns into English, and until now its screens did not: the page
 * changed language around a column of Hebrew screenshots, which is a worse
 * answer than not offering English at all — it says the translation is a
 * veneer over a product that only works in one language.
 *
 * So there are two streets. Not one street translated: the shop names, the
 * services, the customers and the roads are data, and data does not change
 * language when the interface does. An English reader has to be shown an
 * English shop for the picture to be worth anything.
 *
 * The two seeds live in one database during a capture, so they are kept apart
 * by their telephone prefix — 050 for one, 052 for the other, both in a range
 * nobody can answer.
 */

export type Person = { givenName: string; familyName: string };

export type Trade = {
  name: string;
  category: string;
  address: string;
  /** Metres from where the customer stands, north and east. */
  at: { north: number; east: number };
  description: string;
  resourceNames: string[];
  services: { name: string; durationMinutes: number; priceMinor: number }[];
  hours: { start: string; end: string };
};

/** One appointment in the composed day at the barbershop. */
export type Sitting = { who: Person; service: string; chair: string; from: string };

export type Street = {
  barber: Trade;
  salon: Trade;
  nails: Trade;
  clinic: Trade;
  masseur: Trade;
  pilates: Trade;
  /** More of the same two trades, so filtering to one produces a list. */
  alsoHair: Trade[];
  /** The barbershop's day, hour by hour. */
  day: Sitting[];
  /** Who fills the rest of the month, and with what. */
  regulars: Person[];
  cuts: string[];
  /** Known to the shop, and deliberately absent from the composed day. */
  newcomer: Person;
  /** Whose customer screens these are, and what she has booked where. */
  her: Person;
  atTheSalon: string;
  atTheNails: string;
  atTheClinic: string;
  lunch: string;
};

/** Every label a locator in the capture needs, in one language. */
export type Words = {
  map: string;
  bookTime: string;
  chooseService: string;
  myAppointments: string;
  searchPlaceholder: string;
  categoryStrip: string;
  barbershopKind: string;
  hairSalonKind: string;
  confirmBooking: string;
  booked: string;
  calendarsWord: string;
  allCalendars: string;
  tabCustomers: string;
  tabBusiness: string;
  today: string;
  nextMonth: string;
  free: string;
  appointmentForCustomer: string;
  searchCustomer: string;
  /** The sheet's final button, which carries the hour it is booking. */
  bookFor: RegExp;
};

export type Tongue = {
  code: "he" | "en";
  /** Nine digits, none of them anybody's: 050-000-00xx and 052-000-00xx. */
  dial: string;
  words: Words;
  street: Street;
};

const HEBREW_STREET: Street = {
  barber: {
    name: "מספרת רן",
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
    // Eight until nine, which is a barbershop's day and also the reason the day
    // screen has something to scroll. A diary shorter than the screen cannot be
    // scrolled clear of the month above it, and a month sliced along the top
    // edge is the one thing a reader cannot parse.
    hours: { start: "08:00", end: "21:00" },
  },
  salon: {
    name: "סטודיו ליה",
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
  },
  nails: {
    name: "ציפורניים מיטל",
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
  },
  clinic: {
    name: "קליניקת נועה",
    category: "cosmetics",
    address: "דיזנגוף 195, תל אביב",
    at: { north: 520, east: 180 },
    description: "טיפולי פנים, פילינג והסרת שיער.",
    resourceNames: ["נועה"],
    services: [{ name: "טיפול פנים", durationMinutes: 60, priceMinor: 32000 }],
    hours: { start: "09:00", end: "18:00" },
  },
  masseur: {
    name: "עיסוי שקד",
    category: "massage",
    address: "בן גוריון 24, תל אביב",
    at: { north: -350, east: -260 },
    description: "עיסוי רקמות עמוק, שוודי ורפואי.",
    resourceNames: ["שקד"],
    services: [{ name: "עיסוי שוודי", durationMinutes: 60, priceMinor: 30000 }],
    hours: { start: "10:00", end: "21:00" },
  },
  pilates: {
    name: "סטודיו פילאטיס אורית",
    category: "pilates",
    address: "ארלוזורוב 11, תל אביב",
    at: { north: 700, east: -420 },
    description: "פילאטיס מכשירים, קבוצות קטנות ואימון אישי.",
    resourceNames: ["אורית"],
    services: [{ name: "אימון אישי", durationMinutes: 50, priceMinor: 20000 }],
    hours: { start: "07:00", end: "20:00" },
  },
  // Hours differ from shop to shop, which is both true of a street and the
  // reason the list is worth reading: a column of results all saying the same
  // thing about whether they are open is a column with nothing in it.
  alsoHair: [
    trade("מספרת אבי", "barbershop", "דיזנגוף 96, תל אביב", -240, 330, "תספורת גבר", 7000, "10:00", "22:00"),
    trade("ברבר שופ בן יהודה", "barbershop", "בן יהודה 174, תל אביב", 420, -520, "תספורת גבר", 9000, "09:00", "23:00"),
    trade("מספרת הצפון", "barbershop", "ארלוזורוב 33, תל אביב", 820, 260, "תספורת גבר", 7500, "09:00", "19:00"),
    trade("סטודיו רותם", "hair_salon", "פרישמן 42, תל אביב", -120, -300, "צבע ופן", 26000, "09:00", "20:00"),
    trade("שיער של תמי", "hair_salon", "גורדון 18, תל אביב", 250, 470, "פן", 11000, "10:00", "23:00"),
  ],
  day: [
    { who: { givenName: "אורי", familyName: "שגב" }, service: "תספורת גבר", chair: "רן", from: "09:00" },
    { who: { givenName: "יונתן", familyName: "פרץ" }, service: "תספורת גבר", chair: "שימי", from: "09:30" },
    { who: { givenName: "איתי", familyName: "רוזן" }, service: "תספורת וזקן", chair: "רן", from: "10:00" },
    { who: { givenName: "רועי", familyName: "מזרחי" }, service: "תספורת וזקן", chair: "שימי", from: "11:00" },
    { who: { givenName: "נועם", familyName: "ברק" }, service: "תספורת ילד", chair: "רן", from: "11:30" },
    { who: { givenName: "גיא", familyName: "אלון" }, service: "עיצוב זקן", chair: "רן", from: "14:00" },
    { who: { givenName: "עומר", familyName: "דגן" }, service: "תספורת גבר", chair: "רן", from: "15:30" },
    { who: { givenName: "דור", familyName: "שלו" }, service: "תספורת גבר", chair: "שימי", from: "16:00" },
    { who: { givenName: "אלון", familyName: "כהן" }, service: "תספורת וזקן", chair: "רן", from: "17:30" },
    { who: { givenName: "ניר", familyName: "אבידן" }, service: "תספורת גבר", chair: "שימי", from: "19:00" },
  ],
  regulars: [
    { givenName: "אורי", familyName: "שגב" },
    { givenName: "יונתן", familyName: "פרץ" },
    { givenName: "איתי", familyName: "רוזן" },
    { givenName: "רועי", familyName: "מזרחי" },
    { givenName: "גיא", familyName: "אלון" },
    { givenName: "עומר", familyName: "דגן" },
    { givenName: "דור", familyName: "שלו" },
  ],
  cuts: ["תספורת גבר", "תספורת וזקן", "עיצוב זקן", "תספורת ילד"],
  newcomer: { givenName: "אמיר", familyName: "טל" },
  her: { givenName: "דנה", familyName: "כהן" },
  atTheSalon: "צבע ופן",
  atTheNails: "לק ג׳ל",
  atTheClinic: "טיפול פנים",
  lunch: "הפסקת צהריים",
};

const ENGLISH_STREET: Street = {
  barber: {
    name: "Ran's Barbershop",
    category: "barbershop",
    address: "142 Dizengoff, Tel Aviv",
    at: { north: 140, east: 90 },
    description: "A two-chair neighbourhood barber. Walk-ins welcome, booking better.",
    resourceNames: ["Ran", "Shimi"],
    services: [
      { name: "Men's cut", durationMinutes: 30, priceMinor: 8000 },
      { name: "Cut and beard", durationMinutes: 45, priceMinor: 11000 },
      { name: "Beard trim", durationMinutes: 20, priceMinor: 5000 },
      { name: "Kids' cut", durationMinutes: 25, priceMinor: 6000 },
    ],
    hours: { start: "08:00", end: "21:00" },
  },
  salon: {
    name: "Studio Lia",
    category: "hair_salon",
    address: "168 Dizengoff, Tel Aviv",
    at: { north: 330, east: -120 },
    description: "Colour, blow-dries and evening styling. Lia and Tamar, two chairs, coffee on us.",
    resourceNames: ["Lia", "Tamar"],
    services: [
      { name: "Blow-dry", durationMinutes: 45, priceMinor: 12000 },
      { name: "Colour and blow-dry", durationMinutes: 90, priceMinor: 28000 },
      { name: "Highlights", durationMinutes: 120, priceMinor: 42000 },
      { name: "Evening styling", durationMinutes: 60, priceMinor: 25000 },
    ],
    hours: { start: "09:00", end: "20:00" },
  },
  nails: {
    name: "Meital Nails",
    category: "nail_salon",
    address: "121 Dizengoff, Tel Aviv",
    at: { north: -180, east: 240 },
    description: "Gel, extensions and manicures. By appointment only.",
    resourceNames: ["Meital"],
    services: [
      { name: "Gel polish", durationMinutes: 60, priceMinor: 15000 },
      { name: "Manicure and pedicure", durationMinutes: 75, priceMinor: 22000 },
      { name: "Infills", durationMinutes: 90, priceMinor: 26000 },
    ],
    hours: { start: "10:00", end: "19:00" },
  },
  clinic: {
    name: "Noa Skin Clinic",
    category: "cosmetics",
    address: "195 Dizengoff, Tel Aviv",
    at: { north: 520, east: 180 },
    description: "Facials, peels and waxing.",
    resourceNames: ["Noa"],
    services: [{ name: "Facial", durationMinutes: 60, priceMinor: 32000 }],
    hours: { start: "09:00", end: "18:00" },
  },
  masseur: {
    name: "Shaked Massage",
    category: "massage",
    address: "24 Ben Gurion, Tel Aviv",
    at: { north: -350, east: -260 },
    description: "Deep tissue, Swedish and medical massage.",
    resourceNames: ["Shaked"],
    services: [{ name: "Swedish massage", durationMinutes: 60, priceMinor: 30000 }],
    hours: { start: "10:00", end: "21:00" },
  },
  pilates: {
    name: "Orit Pilates Studio",
    category: "pilates",
    address: "11 Arlozorov, Tel Aviv",
    at: { north: 700, east: -420 },
    description: "Reformer pilates, small groups and one-to-one.",
    resourceNames: ["Orit"],
    services: [{ name: "One-to-one session", durationMinutes: 50, priceMinor: 20000 }],
    hours: { start: "07:00", end: "20:00" },
  },
  alsoHair: [
    trade("Avi's Barbershop", "barbershop", "96 Dizengoff, Tel Aviv", -240, 330, "Men's cut", 7000, "10:00", "22:00"),
    trade("Ben Yehuda Barber Shop", "barbershop", "174 Ben Yehuda, Tel Aviv", 420, -520, "Men's cut", 9000, "09:00", "23:00"),
    trade("North Barbers", "barbershop", "33 Arlozorov, Tel Aviv", 820, 260, "Men's cut", 7500, "09:00", "19:00"),
    trade("Studio Rotem", "hair_salon", "42 Frishman, Tel Aviv", -120, -300, "Colour and blow-dry", 26000, "09:00", "20:00"),
    trade("Tami Hair", "hair_salon", "18 Gordon, Tel Aviv", 250, 470, "Blow-dry", 11000, "10:00", "23:00"),
  ],
  day: [
    { who: { givenName: "Ori", familyName: "Segev" }, service: "Men's cut", chair: "Ran", from: "09:00" },
    { who: { givenName: "Yonatan", familyName: "Peretz" }, service: "Men's cut", chair: "Shimi", from: "09:30" },
    { who: { givenName: "Itai", familyName: "Rosen" }, service: "Cut and beard", chair: "Ran", from: "10:00" },
    { who: { givenName: "Roei", familyName: "Mizrahi" }, service: "Cut and beard", chair: "Shimi", from: "11:00" },
    { who: { givenName: "Noam", familyName: "Barak" }, service: "Kids' cut", chair: "Ran", from: "11:30" },
    { who: { givenName: "Guy", familyName: "Alon" }, service: "Beard trim", chair: "Ran", from: "14:00" },
    { who: { givenName: "Omer", familyName: "Dagan" }, service: "Men's cut", chair: "Ran", from: "15:30" },
    { who: { givenName: "Dor", familyName: "Shalev" }, service: "Men's cut", chair: "Shimi", from: "16:00" },
    { who: { givenName: "Alon", familyName: "Cohen" }, service: "Cut and beard", chair: "Ran", from: "17:30" },
    { who: { givenName: "Nir", familyName: "Avidan" }, service: "Men's cut", chair: "Shimi", from: "19:00" },
  ],
  regulars: [
    { givenName: "Ori", familyName: "Segev" },
    { givenName: "Yonatan", familyName: "Peretz" },
    { givenName: "Itai", familyName: "Rosen" },
    { givenName: "Roei", familyName: "Mizrahi" },
    { givenName: "Guy", familyName: "Alon" },
    { givenName: "Omer", familyName: "Dagan" },
    { givenName: "Dor", familyName: "Shalev" },
  ],
  cuts: ["Men's cut", "Cut and beard", "Beard trim", "Kids' cut"],
  newcomer: { givenName: "Amir", familyName: "Tal" },
  her: { givenName: "Dana", familyName: "Cohen" },
  atTheSalon: "Colour and blow-dry",
  atTheNails: "Gel polish",
  atTheClinic: "Facial",
  lunch: "Lunch break",
};

export const HEBREW: Tongue = {
  code: "he",
  dial: "+9725000000",
  street: HEBREW_STREET,
  words: {
    map: "מפה",
    bookTime: "לקביעת תור",
    chooseService: "בוחרים שירות",
    myAppointments: "התורים שלי",
    searchPlaceholder: "מספרה, קליניקה, מאמן אישי…",
    categoryStrip: "סוגי עסקים",
    barbershopKind: "מספרה / ספר",
    hairSalonKind: "מספרת נשים",
    confirmBooking: "אישור התור",
    booked: "התור נקבע",
    calendarsWord: "יומן",
    allCalendars: "כל היומנים",
    tabCustomers: "לקוחות",
    tabBusiness: "העסק",
    today: "היום",
    nextMonth: "החודש הבא",
    free: "פנוי",
    appointmentForCustomer: "תור ללקוח",
    searchCustomer: "חיפוש לפי שם או טלפון",
    bookFor: /^קביעה ל־/,
  },
};

export const ENGLISH: Tongue = {
  code: "en",
  dial: "+9725200000",
  street: ENGLISH_STREET,
  words: {
    map: "Map",
    bookTime: "Book a time",
    chooseService: "Choose a service",
    myAppointments: "My appointments",
    searchPlaceholder: "Barber, clinic, personal trainer…",
    categoryStrip: "Kinds of business",
    barbershopKind: "Barbershop",
    hairSalonKind: "Hair salon",
    confirmBooking: "Confirm",
    booked: "You are booked",
    calendarsWord: "Calendar",
    allCalendars: "All calendars",
    tabCustomers: "Customers",
    tabBusiness: "Business",
    today: "Today",
    nextMonth: "Next month",
    free: "Free",
    appointmentForCustomer: "An appointment",
    searchCustomer: "Search by name or phone",
    bookFor: /^Book for/,
  },
};

export const TONGUES: readonly Tongue[] = [HEBREW, ENGLISH];

/** One of the shops that exists only to be a third result in a filtered list. */
function trade(
  name: string,
  category: string,
  address: string,
  north: number,
  east: number,
  service: string,
  priceMinor: number,
  from: string,
  until: string,
): Trade {
  return {
    name,
    category,
    address,
    at: { north, east },
    description: "",
    resourceNames: ["1"],
    services: [{ name: service, durationMinutes: 30, priceMinor }],
    hours: { start: from, end: until },
  };
}
