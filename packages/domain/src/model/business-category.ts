/**
 * ADR 0017: what kind of place a Business is, chosen from a closed list.
 *
 * The code is what is stored. The labels and the synonyms live here too rather
 * than in the web dictionaries, because the API infers a Category from what a
 * customer typed — and it has to do that with exactly the words the browser
 * suggests from, or "ספר" would find a barbershop on one side and not the other.
 */

export const CATEGORY_GROUPS = Object.freeze({
  hair: { he: "שיער וטיפוח", en: "Hair & grooming" },
  beauty: { he: "יופי", en: "Beauty" },
  wellness: { he: "בריאות וכושר", en: "Wellness & fitness" },
  health: { he: "בריאות וטיפול", en: "Health & therapy" },
  pets: { he: "חיות מחמד", en: "Pets" },
  lessons: { he: "שיעורים והדרכה", en: "Lessons & coaching" },
  professional: { he: "שירותים מקצועיים", en: "Professional services" },
  repairs: { he: "בית, רכב ותיקונים", en: "Home, auto & repairs" },
  spaces: { he: "מתחמים וחוויות", en: "Spaces & experiences" },
});

export type CategoryGroup = keyof typeof CATEGORY_GROUPS;

/** [code, group, Hebrew label, English label, comma-separated synonyms] */
const ENTRIES = [
  ["barbershop", "hair", "מספרה / ספר", "Barbershop", "barber,haircut,beard,תספורת,זקן,ספר,children,kids,kids haircuts,ילדים,תספורות ילדים"],
  ["hair_salon", "hair", "מספרת נשים וכלות", "Hair salon & bridal", "hairdresser,hair color,blowout,צבע,פן,תסרוקת,מעצב שיער,extensions,hair extensions,תוספות,תוספות שיער,bride,bridal,bridal salon,wedding,כלה,כלות,חתונה,סלון כלות"],
  ["wig_styling", "hair", "עיצוב פאות", "Wig styling", "wig,sheitel,פאה,פאות"],

  ["nail_salon", "beauty", "ציפורניים: מניקור, פדיקור וג׳ל", "Nails: manicure, pedicure & gel", "nails,manicure,pedicure,ציפורניים,לק,גל,לק גל,gel nails,acrylic,ג׳ל,בנייה,בניית ציפורניים"],
  ["cosmetics", "beauty", "קוסמטיקה", "Cosmetics & facials", "facial,skin care,קוסמטיקאית,טיפול פנים"],
  ["brows_lashes", "beauty", "גבות, ריסים ואיפור קבוע", "Brows, lashes & permanent makeup", "eyebrows,lashes,lamination,גבות,ריסים,microblading,pmu,permanent makeup,מיקרובליידינג,איפור קבוע"],
  ["makeup_artist", "beauty", "מאפרת", "Makeup artist", "makeup,איפור"],
  ["hair_removal", "beauty", "הסרת שיער: שעווה ולייזר", "Hair removal: waxing & laser", "waxing,sugaring,שעווה,laser,laser hair removal,לייזר,הסרת שיער בלייזר"],
  ["tanning", "beauty", "שיזוף בהתזה", "Spray tan", "tan,שיזוף"],
  ["tattoo_piercing", "beauty", "קעקועים ופירסינג", "Tattoo & piercing", "tattoo,piercing,קעקוע,פירסינג"],
  ["aesthetic_clinic", "beauty", "אסתטיקה רפואית", "Aesthetic clinic", "botox,filler,בוטוקס,חומצה היאלורונית"],

  ["massage", "wellness", "עיסוי ורפלקסולוגיה", "Massage & reflexology", "מסאז׳,מעסה,מעסה,reflexology,feet,רגליים,רפלקסולוגיה"],
  ["spa", "wellness", "ספא", "Spa", "jacuzzi,ג׳קוזי"],
  ["yoga", "wellness", "יוגה ומדיטציה", "Yoga & meditation", "meditation,mindfulness,breathwork,מדיטציה,מיינדפולנס,נשימה"],
  ["pilates", "wellness", "פילאטיס", "Pilates", "reformer,מכשירים"],
  ["personal_trainer", "wellness", "מאמן כושר אישי", "Personal trainer", "coach,training,אימון,מאמן,מאמנת"],
  ["fitness_studio", "wellness", "חדר כושר וסטודיו", "Gym & fitness studio", "gym,crossfit,קרוספיט"],
  ["martial_arts", "wellness", "אומנויות לחימה", "Martial arts", "karate,judo,krav maga,קרב מגע,ג׳ודו,קראטה"],
  ["dance_studio", "wellness", "סטודיו למחול", "Dance studio", "dance,ballet,ריקוד,בלט"],
  ["mikveh", "wellness", "מקווה", "Mikveh", "mikvah,טבילה"],

  ["dental_clinic", "health", "רופא שיניים ואורתודנט", "Dentist & orthodontist", "dentist,teeth,רופא שיניים,שיננית,orthodontist,braces,אורתודנט,יישור שיניים"],
  ["family_doctor", "health", "מרפאה / רופא", "Doctor's clinic", "doctor,gp,physician,רופאה,dermatologist,skin,רופא עור,עור"],
  ["physiotherapy", "health", "פיזיותרפיה וכירופרקטיקה", "Physiotherapy & chiropractic", "physio,rehab,פיזיותרפיסט,שיקום,chiropractor,chiropractic,spine,back,כירופרקטיקה,כירופרקט,גב"],
  ["occupational_therapy", "health", "ריפוי בעיסוק", "Occupational therapy", "ot"],
  ["speech_therapy", "health", "קלינאות תקשורת", "Speech therapy", "speech,קלינאית"],
  ["psychotherapy", "health", "פסיכולוג וטיפול רגשי", "Psychologist & therapy", "counselor,therapist,therapy,cbt,מטפל,מטפלת,psychologist,psychology,פסיכולוג,פסיכולוגית,couples,couples therapy,marriage,family therapy,טיפול זוגי,זוגיות,טיפול משפחתי"],
  ["dietitian", "health", "דיאטנית / תזונה", "Dietitian & nutrition", "nutritionist,diet,תזונאית,דיאטה"],
  ["optometrist", "health", "אופטומטריסט", "Optometrist", "eyes,glasses,משקפיים,עיניים,אופטיקה"],
  ["hearing_clinic", "health", "מכון שמיעה", "Hearing clinic", "audiologist"],
  ["podiatry", "health", "פודיאטריה", "Podiatry", "foot,nail,כף רגל"],
  ["acupuncture", "health", "רפואה משלימה", "Complementary medicine", "chinese medicine,דיקור סיני,acupuncture,דיקור,רפואה סינית,naturopathy,נטורופתיה"],
  ["lactation_consultant", "health", "יועצת הנקה", "Lactation consultant", "breastfeeding,doula,הנקה,דולה"],
  ["medical_lab", "health", "בדיקות ודימות", "Medical tests & imaging", "lab,blood test,ultrasound,בדיקת דם,אולטרסאונד"],

  ["veterinarian", "pets", "וטרינר", "Veterinarian", "vet,animal,וטרינרית"],
  ["pet_grooming", "pets", "מספרת כלבים", "Pet grooming", "dog,cat,grooming,כלב,חתול"],
  ["dog_training", "pets", "אילוף ופנסיון לכלבים", "Dog training & boarding", "dog trainer,מאלף,boarding,pet boarding,kennel,dog hotel,daycare,פנסיון,פנסיון לחיות"],

  ["private_tutor", "lessons", "מורה פרטי ושיעורי שפה", "Tutor & language lessons", "tutoring,math,homework,שיעור פרטי,מתמטיקה,language,language lessons,english,hebrew,אנגלית,עברית,שיעורי שפה"],
  ["music_lessons", "lessons", "שיעורי מוזיקה", "Music lessons", "piano,guitar,singing,פסנתר,גיטרה,פיתוח קול"],
  ["driving_school", "lessons", "מורה לנהיגה", "Driving lessons", "driving,נהיגה,טסט"],
  ["swimming_lessons", "lessons", "שיעורי שחייה", "Swimming lessons", "swim,pool,בריכה"],
  ["art_classes", "lessons", "חוגי אמנות", "Art & craft classes", "painting,ceramics,ציור,קרמיקה"],
  ["life_coach", "lessons", "קואצ׳ינג", "Life & business coach", "coaching,mentoring,מנטור,אימון אישי"],
  ["sports_coaching", "lessons", "אימון ספורט", "Sports coaching", "tennis,football,טניס,כדורגל"],

  ["lawyer", "professional", "עורך דין ונוטריון", "Lawyer & notary", "attorney,legal,עו״ד,עורכת דין,notary,notarization,נוטריון"],
  ["accountant", "professional", "רואה חשבון / יועץ מס", "Accountant & tax advisor", "cpa,tax,bookkeeping,רו״ח,הנהלת חשבונות"],
  ["financial_advisor", "professional", "ייעוץ פיננסי, ביטוח ומשכנתאות", "Financial, insurance & mortgage", "mortgage,pension,משכנתא,פנסיה,insurance,insurance agent,ביטוח,סוכן ביטוח"],
  ["real_estate", "professional", "מתווך נדל״ן", "Real estate agent", "realtor,apartment,דירה,תיווך"],
  ["photographer", "professional", "צלם", "Photographer", "photo studio,photoshoot,צילום,צלמת"],
  ["interior_design", "professional", "עיצוב פנים", "Interior design", "decor,designer,מעצבת"],
  ["graphic_design", "professional", "עיצוב ושיווק", "Design & marketing", "branding,marketing,מיתוג"],

  ["car_mechanic", "repairs", "מוסך וצמיגים", "Car mechanic & tires", "garage,car service,מכונאי,טיפול לרכב,tires,tyres,puncture,alignment,צמיגים,פנצ׳ריה,פנצ׳ר"],
  ["car_wash", "repairs", "שטיפת רכב", "Car wash & detailing", "detailing,ניקוי רכב"],
  ["bike_repair", "repairs", "תיקון אופניים וקורקינטים", "Bike & scooter repair", "bicycle,scooter,אופניים,קורקינט"],
  ["phone_repair", "repairs", "תיקון טלפונים ומחשבים", "Phone & computer repair", "screen,laptop,מסך,מחשב"],
  ["tailor", "repairs", "תופרת ותיקוני בגדים", "Tailor & alterations", "sewing,dress,תפירה,שמלה"],
  ["cobbler", "repairs", "סנדלר", "Shoe repair", "shoes,נעליים"],
  ["cleaning", "repairs", "שירותי ניקיון", "Cleaning services", "housekeeping,maid,נקיון"],
  ["handyman", "repairs", "הנדימן ושיפוצים", "Handyman & installers", "electrician,plumber,חשמלאי,אינסטלטור"],
  ["locksmith", "repairs", "מנעולן", "Locksmith", "keys,lock,מפתחות"],

  ["court_rental", "spaces", "השכרת מגרשים", "Sports court rental", "padel,tennis court,פאדל,מגרש"],
  ["escape_room", "spaces", "חדר בריחה", "Escape room", "escape"],
  ["meeting_room", "spaces", "חדרי ישיבות וחללי עבודה", "Meeting room & coworking", "coworking,office,משרד"],
  ["recording_studio", "spaces", "אולפן הקלטות וחדר חזרות", "Recording & rehearsal studio", "studio,band,הקלטה,להקה"],
  ["event_venue", "spaces", "אולם אירועים", "Event venue", "hall,party,אירוע,מסיבה"],
  ["kids_activities", "spaces", "פעילויות וימי הולדת לילדים", "Kids' activities & parties", "birthday,יום הולדת"],
  ["tour_guide", "spaces", "סיורים וסדנאות", "Tours & workshops", "workshop,tour,סדנה,סיור"],
  ["other", "spaces", "אחר", "Other", ""],
] as const satisfies readonly (readonly [string, CategoryGroup, string, string, string])[];

export type BusinessCategory = (typeof ENTRIES)[number][0];

/** Every code, in the order the list shows them. A tuple, for schema validators. */
export const BUSINESS_CATEGORIES = Object.freeze(ENTRIES.map((entry) => entry[0])) as unknown as readonly [
  BusinessCategory,
  ...BusinessCategory[],
];

/** The way out for a business the list did not foresee. Never inferred. */
export const OTHER_CATEGORY: BusinessCategory = "other";

const CODES: ReadonlySet<string> = new Set(BUSINESS_CATEGORIES);

export const isBusinessCategory = (value: string): value is BusinessCategory => CODES.has(value);

type Language = "he" | "en";

const BY_CODE = new Map(
  ENTRIES.map(([code, group, he, en]) => [code, { group, he, en }]),
);

export const categoryLabel = (code: BusinessCategory, language: Language): string =>
  BY_CODE.get(code)![language];

export const categoryGroup = (code: BusinessCategory): CategoryGroup => BY_CODE.get(code)!.group;

export const categoryGroupLabel = (code: BusinessCategory, language: Language): string =>
  CATEGORY_GROUPS[categoryGroup(code)][language];

/**
 * Case, niqqud and the geresh marks all fall away, so "סַפָּר", "ספר" and
 * "ג'ל" / "ג׳ל" meet each other.
 */
const normalise = (text: string): string =>
  text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-֑ͯ-ׇ]/g, "")
    .replace(/[׳״'"`]/g, "")
    .trim();

const PREPARED = ENTRIES.map(([code, , he, en, synonyms]) => {
  const labels = [normalise(he), normalise(en)];
  const phrases = [...labels, ...synonyms.split(",").filter(Boolean).map(normalise)];
  return {
    code: code,
    labels,
    phrases,
    words: phrases.flatMap((phrase) => phrase.split(/[\s/&,()-]+/).filter(Boolean)),
  };
});

/** 0: a label starts with it · 1: some word or synonym does · 2: it appears anywhere. */
const rank = (entry: (typeof PREPARED)[number], needle: string): number | null => {
  if (entry.labels.some((label) => label.startsWith(needle))) return 0;
  if (
    entry.words.some((word) => word.startsWith(needle)) ||
    entry.phrases.some((phrase) => phrase.startsWith(needle))
  ) {
    return 1;
  }
  if (entry.phrases.some((phrase) => phrase.includes(needle))) return 2;
  return null;
};

const ranked = (text: string, maximumRank: number): BusinessCategory[] => {
  const needle = normalise(text);
  return PREPARED.map((entry) => ({ code: entry.code, rank: rank(entry, needle) }))
    .filter((match): match is { code: BusinessCategory; rank: number } =>
      match.rank !== null && match.rank <= maximumRank,
    )
    .sort((left, right) => left.rank - right.rank)
    .map((match) => match.code);
};

/** What an owner picking from the list sees: everything when nothing is typed. */
export const matchCategories = (text: string): readonly BusinessCategory[] =>
  normalise(text) === "" ? BUSINESS_CATEGORIES : ranked(text, 2);

/** Fewer letters than this match half the list, which is a guess, not intent. */
export const MINIMUM_INFERENCE_LENGTH = 3;
export const MAXIMUM_INFERRED_CATEGORIES = 3;

/**
 * The Categories a customer's search text probably means. Stricter than
 * `matchCategories`: only a word that starts with what was typed counts, since
 * this widens a search rather than answering a question the customer asked.
 */
export const inferCategories = (text: string): readonly BusinessCategory[] =>
  normalise(text).length < MINIMUM_INFERENCE_LENGTH
    ? []
    : ranked(text, 1)
        .filter((code) => code !== OTHER_CATEGORY)
        .slice(0, MAXIMUM_INFERRED_CATEGORIES);

/**
 * Categories the list no longer has, and the sibling each one joined — always
 * under the same parent group, so a business never moves to a different kind
 * of place than it chose. The migration moves stored codes the same way, and
 * a client built before the merge is still understood.
 */
export const CATEGORY_MERGES = Object.freeze({
  kids_haircuts: "barbershop",
  hair_extensions: "hair_salon",
  bridal_salon: "hair_salon",
  gel_nails: "nail_salon",
  permanent_makeup: "brows_lashes",
  laser_hair_removal: "hair_removal",
  reflexology: "massage",
  meditation: "yoga",
  orthodontist: "dental_clinic",
  dermatologist: "family_doctor",
  chiropractor: "physiotherapy",
  psychologist: "psychotherapy",
  couples_therapy: "psychotherapy",
  naturopathy: "acupuncture",
  pet_boarding: "dog_training",
  language_lessons: "private_tutor",
  notary: "lawyer",
  insurance_agent: "financial_advisor",
  tires: "car_mechanic",
} as const satisfies Readonly<Record<string, BusinessCategory>>);

const MERGED: Readonly<Record<string, BusinessCategory>> = CATEGORY_MERGES;

/** A code as the list has it now: a retired one as the sibling it joined, an unknown one as nothing. */
export const currentCategory = (code: string): BusinessCategory | null =>
  isBusinessCategory(code) ? code : (MERGED[code] ?? null);

/** How many Categories a Business may have. The first is its main one. */
export const MAX_CATEGORIES = 3;

export type CategoriesProblem = "NONE" | "TOO_MANY" | "UNKNOWN" | "REPEATED";

/**
 * A Business's Categories, checked: one to three, each known, none twice, in
 * the order given — the first is what the Business is called by on a card and
 * a map pin. A retired code counts as the one it joined.
 */
export const checkCategories = (
  codes: readonly string[],
):
  | { readonly ok: true; readonly categories: readonly BusinessCategory[] }
  | { readonly ok: false; readonly problem: CategoriesProblem } => {
  if (codes.length === 0) return { ok: false, problem: "NONE" };
  if (codes.length > MAX_CATEGORIES) return { ok: false, problem: "TOO_MANY" };
  const current = codes.map(currentCategory);
  if (current.some((code) => code === null)) return { ok: false, problem: "UNKNOWN" };
  const categories = current as BusinessCategory[];
  if (new Set(categories).size !== categories.length) return { ok: false, problem: "REPEATED" };
  return { ok: true, categories };
};

/**
 * The parent groups some Categories come from, each once, in order. Other
 * belongs to no field, so it never makes a second one.
 */
export const categoryGroupsOf = (codes: readonly BusinessCategory[]): readonly CategoryGroup[] => [
  ...new Set(codes.filter((code) => code !== OTHER_CATEGORY).map(categoryGroup)),
];
