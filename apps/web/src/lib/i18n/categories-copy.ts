/**
 * Choosing a Business's Categories (ADR 0024), in the words the approved design
 * used. Its own namespace: the wizard and the settings share one chooser.
 */
export const categories = {
  he: {
    "label": "סוג העסק",
    "upTo": "עד 3",
    "main": "ראשי",
    "firstPlaceholder": "למשל: מספרה, קוסמטיקה, מאמן כושר",
    "addAnother": "הוספת סוג נוסף…",
    "remove": "הסרת {category}",
    "makeMain": "{category} כסוג הראשי",
    "twoFields": "שני תחומים שונים: {groups}",
    "threeFields": "שלושה תחומים שונים: {groups}",
    "others": "ועוד: {names}",
    "listLabel": "סוגי העסק",
  },
  en: {
    "label": "Category",
    "upTo": "up to 3",
    "main": "Main",
    "firstPlaceholder": "For example: barbershop, cosmetics, personal trainer",
    "addAnother": "Add another category…",
    "remove": "Remove {category}",
    "makeMain": "Make {category} the main one",
    "twoFields": "Two different fields: {groups}",
    "threeFields": "Three different fields: {groups}",
    "others": "Also: {names}",
    "listLabel": "Categories",
  },
} as const;
