"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  DEFAULT_LANGUAGE,
  DICTIONARIES,
  DIRECTION,
  LANGUAGES,
  type Language,
  type Namespace,
} from "./dictionaries.ts";

export { DEFAULT_LANGUAGE, DIRECTION, LANGUAGES };
export type { Language, Namespace };

const STORAGE_KEY = "tor-now.language";

type LanguageState = {
  readonly language: Language;
  readonly direction: "rtl" | "ltr";
  readonly setLanguage: (language: Language) => void;
  readonly toggleLanguage: () => void;
};

const LanguageContext = createContext<LanguageState | null>(null);

const isLanguage = (value: unknown): value is Language =>
  typeof value === "string" && (LANGUAGES as readonly string[]).includes(value);

const readStoredLanguage = (): Language | null => {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return isLanguage(stored) ? stored : null;
  } catch {
    // A browser refusing storage is not a reason to fail to render.
    return null;
  }
};

export const LanguageProvider = ({ children }: { children: ReactNode }) => {
  // The server renders the default language, so the first client render must
  // agree with it; a stored preference is applied after hydration rather than
  // during it.
  const [language, setLanguageState] = useState<Language>(DEFAULT_LANGUAGE);

  useEffect(() => {
    const stored = readStoredLanguage();
    if (stored !== null) setLanguageState(stored);
  }, []);

  const setLanguage = useCallback((next: Language) => {
    setLanguageState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference is a convenience; losing it costs one click.
    }
  }, []);

  const direction = DIRECTION[language];

  // The document element carries the language and direction so that the
  // stylesheet's logical properties, and the browser's own text handling,
  // both follow the choice.
  useEffect(() => {
    document.documentElement.lang = language;
    document.documentElement.dir = direction;
  }, [language, direction]);

  const value = useMemo<LanguageState>(
    () => ({
      language,
      direction,
      setLanguage,
      toggleLanguage: () => setLanguage(language === "he" ? "en" : "he"),
    }),
    [language, direction, setLanguage],
  );

  return (
    <LanguageContext.Provider value={value}>{children}</LanguageContext.Provider>
  );
};

export const useLanguage = (): LanguageState => {
  const state = useContext(LanguageContext);
  if (state === null) {
    throw new Error("useLanguage must be used inside a LanguageProvider");
  }
  return state;
};

/**
 * The copy for one screen in the current language. Typed against the Hebrew
 * dictionary, which is the source language — so a key that exists only in the
 * translation is a compile error rather than a missing string at runtime.
 */
export const useCopy = <N extends Namespace>(
  namespace: N,
): (typeof DICTIONARIES)[N]["he"] => {
  const { language } = useLanguage();
  return DICTIONARIES[namespace][language] as (typeof DICTIONARIES)[N]["he"];
};
