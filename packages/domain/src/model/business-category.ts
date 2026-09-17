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
  ["barbershop", "hair", "מספרה / ספר", "Barbershop", "barber,haircut,beard,תספורת,זקן,ספר"],
  ["hair_salon", "hair", "מספרת נשים", "Hair salon", "hairdresser,hair color,blowout,צבע,פן,תסרוקת,מעצב שיער"],
  ["hair_extensions", "hair", "תוספות שיער", "Hair extensions", "extensions,תוספות"],
  ["wig_styling", "hair", "עיצוב פאות", "Wig styling", "wig,sheitel,פאה,פאות"],
  ["kids_haircuts", "hair", "תספורות ילדים", "Kids' haircuts", "children,ילדים"],
  ["bridal_salon", "hair", "סלון כלות", "Bridal salon", "bride,wedding,כלה,חתונה"],

  ["nail_salon", "beauty", "מניקור ופדיקור", "Nail salon", "nails,manicure,pedicure,ציפורניים,לק,גל,לק גל"],
  ["gel_nails", "beauty", "לק ג׳ל ובניית ציפורניים", "Gel nails & extensions", "gel,acrylic,ג׳ל,בנייה"],
  ["cosmetics", "beauty", "קוסמטיקה", "Cosmetics & facials", "facial,skin care,קוסמטיקאית,טיפול פנים"],
  ["brows_lashes", "beauty", "גבות וריסים", "Brows & lashes", "eyebrows,lashes,lamination,גבות,ריסים"],
  ["permanent_makeup", "beauty", "איפור קבוע", "Permanent makeup", "microblading,pmu,מיקרובליידינג"],
  ["makeup_artist", "beauty", "מאפרת", "Makeup artist", "makeup,איפור"],
  ["hair_removal", "beauty", "הסרת שיער ושעווה", "Hair removal & waxing", "waxing,sugaring,שעווה"],
  ["laser_hair_removal", "beauty", "הסרת שיער בלייזר", "Laser hair removal", "laser,לייזר"],
  ["tanning", "beauty", "שיזוף בהתזה", "Spray tan", "tan,שיזוף"],
  ["tattoo_piercing", "beauty", "קעקועים ופירסינג", "Tattoo & piercing", "tattoo,piercing,קעקוע,פירסינג"],
  ["aesthetic_clinic", "beauty", "אסתטיקה רפואית", "Aesthetic clinic", "botox,filler,בוטוקס,חומצה היאלורונית"],

  ["massage", "wellness", "עיסוי", "Massage", "מסאז׳,מעסה,מעסה"],
  ["spa", "wellness", "ספא", "Spa", "jacuzzi,ג׳קוזי"],
  ["reflexology", "wellness", "רפלקסולוגיה", "Reflexology", "feet,רגליים"],
  ["yoga", "wellness", "יוגה", "Yoga", ""],
  ["pilates", "wellness", "פילאטיס", "Pilates", "reformer,מכשירים"],
  ["personal_trainer", "wellness", "מאמן כושר אישי", "Personal trainer", "coach,training,אימון,מאמן,מאמנת"],
  ["fitness_studio", "wellness", "חדר כושר וסטודיו", "Gym & fitness studio", "gym,crossfit,קרוספיט"],
  ["martial_arts", "wellness", "אומנויות לחימה", "Martial arts", "karate,judo,krav maga,קרב מגע,ג׳ודו,קראטה"],
  ["dance_studio", "wellness", "סטודיו למחול", "Dance studio", "dance,ballet,ריקוד,בלט"],
  ["meditation", "wellness", "מדיטציה ונשימה", "Meditation & breathwork", "mindfulness,מיינדפולנס"],
  ["mikveh", "wellness", "מקווה", "Mikveh", "mikvah,טבילה"],

  ["dental_clinic", "health", "מרפאת שיניים", "Dental clinic", "dentist,teeth,רופא שיניים,שיננית"],
  ["orthodontist", "health", "אורתודנט", "Orthodontist", "braces,יישור שיניים"],
  ["family_doctor", "health", "מרפאה / רופא", "Doctor's clinic", "doctor,gp,physician,רופאה"],
  ["dermatologist", "health", "רופא עור", "Dermatologist", "skin,עור"],
  ["physiotherapy", "health", "פיזיותרפיה", "Physiotherapy", "physio,rehab,פיזיותרפיסט,שיקום"],
  ["chiropractor", "health", "כירופרקטיקה", "Chiropractor", "spine,back,גב"],
  ["occupational_therapy", "health", "ריפוי בעיסוק", "Occupational therapy", "ot"],
  ["speech_therapy", "health", "קלינאות תקשורת", "Speech therapy", "speech,קלינאית"],
  ["psychologist", "health", "פסיכולוג", "Psychologist", "psychology,פסיכולוגית"],
  ["psychotherapy", "health", "טיפול רגשי", "Counselling & psychotherapy", "counselor,therapist,therapy,cbt,מטפל,מטפלת"],
  ["couples_therapy", "health", "טיפול זוגי ומשפחתי", "Couples & family therapy", "marriage,זוגיות"],
  ["dietitian", "health", "דיאטנית / תזונה", "Dietitian & nutrition", "nutritionist,diet,תזונאית,דיאטה"],
  ["optometrist", "health", "אופטומטריסט", "Optometrist", "eyes,glasses,משקפיים,עיניים,אופטיקה"],
  ["hearing_clinic", "health", "מכון שמיעה", "Hearing clinic", "audiologist"],
  ["podiatry", "health", "פודיאטריה", "Podiatry", "foot,nail,כף רגל"],
  ["acupuncture", "health", "דיקור ורפואה סינית", "Acupuncture & Chinese medicine", "chinese medicine,דיקור סיני"],
  ["naturopathy", "health", "נטורופתיה", "Naturopathy", "homeopathy,alternative medicine,הומאופתיה,רפואה משלימה"],
  ["lactation_consultant", "health", "יועצת הנקה", "Lactation consultant", "breastfeeding,doula,הנקה,דולה"],
  ["medical_lab", "health", "בדיקות ודימות", "Medical tests & imaging", "lab,blood test,ultrasound,בדיקת דם,אולטרסאונד"],

  ["veterinarian", "pets", "וטרינר", "Veterinarian", "vet,animal,וטרינרית"],
  ["pet_grooming", "pets", "מספרת כלבים", "Pet grooming", "dog,cat,grooming,כלב,חתול"],
  ["dog_training", "pets", "אילוף כלבים", "Dog training", "dog trainer,מאלף"],
  ["pet_boarding", "pets", "פנסיון לחיות", "Pet boarding & daycare", "kennel,dog hotel"],

  ["private_tutor", "lessons", "מורה פרטי", "Private tutor", "tutoring,math,homework,שיעור פרטי,מתמטיקה"],
  ["music_lessons", "lessons", "שיעורי מוזיקה", "Music lessons", "piano,guitar,singing,פסנתר,גיטרה,פיתוח קול"],
  ["language_lessons", "lessons", "שיעורי שפה", "Language lessons", "english,hebrew,אנגלית,עברית"],
  ["driving_school", "lessons", "מורה לנהיגה", "Driving lessons", "driving,נהיגה,טסט"],
  ["swimming_lessons", "lessons", "שיעורי שחייה", "Swimming lessons", "swim,pool,בריכה"],
  ["art_classes", "lessons", "חוגי אמנות", "Art & craft classes", "painting,ceramics,ציור,קרמיקה"],
  ["life_coach", "lessons", "קואצ׳ינג", "Life & business coach", "coaching,mentoring,מנטור,אימון אישי"],
  ["sports_coaching", "lessons", "אימון ספורט", "Sports coaching", "tennis,football,טניס,כדורגל"],

  ["lawyer", "professional", "עורך דין", "Lawyer", "attorney,legal,עו״ד,עורכת דין"],
  ["notary", "professional", "נוטריון", "Notary", "notarization"],
  ["accountant", "professional", "רואה חשבון / יועץ מס", "Accountant & tax advisor", "cpa,tax,bookkeeping,רו״ח,הנהלת חשבונות"],
  ["financial_advisor", "professional", "יועץ פיננסי ומשכנתאות", "Financial & mortgage advisor", "mortgage,pension,משכנתא,פנסיה"],
  ["insurance_agent", "professional", "סוכן ביטוח", "Insurance agent", "insurance,ביטוח"],
  ["real_estate", "professional", "מתווך נדל״ן", "Real estate agent", "realtor,apartment,דירה,תיווך"],
  ["photographer", "professional", "צלם", "Photographer", "photo studio,photoshoot,צילום,צלמת"],
  ["interior_design", "professional", "עיצוב פנים", "Interior design", "decor,designer,מעצבת"],
  ["graphic_design", "professional", "עיצוב ושיווק", "Design & marketing", "branding,marketing,מיתוג"],

  ["car_mechanic", "repairs", "מוסך", "Car mechanic", "garage,car service,מכונאי,טיפול לרכב"],
  ["car_wash", "repairs", "שטיפת רכב", "Car wash & detailing", "detailing,ניקוי רכב"],
  ["tires", "repairs", "צמיגים ופנצ׳ריה", "Tires & alignment", "tyres,puncture,פנצ׳ר"],
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
