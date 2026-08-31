"use client";

import { useCallback } from "react";
import { errorMessage } from "./i18n/errors.ts";
import { useLanguage } from "./i18n/index.tsx";

/** Turns an API error code into text this reader can act on. */
export const useErrorText = (): ((code: string) => string) => {
  const { language } = useLanguage();
  return useCallback((code: string) => errorMessage(language, code), [language]);
};
