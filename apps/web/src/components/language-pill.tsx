"use client";

import { useLanguage, type Language } from "@/lib/i18n/index.tsx";

/**
 * Both languages, each written in itself, the current one marked.
 *
 * Every word here is fixed rather than read from a dictionary: the person who
 * needs this control is the one who cannot read the language the screen is in,
 * so neither its name nor its choices may depend on that language.
 */
const CHOICES: readonly { language: Language; name: string }[] = [
  { language: "he", name: "עברית" },
  { language: "en", name: "English" },
];

export const LanguagePill = () => {
  const { language, setLanguage } = useLanguage();

  return (
    <div
      role="group"
      aria-label="שפה · Language"
      style={{
        display: "inline-flex",
        padding: 2,
        borderRadius: 999,
        border: "1px solid var(--line)",
        background: "var(--raised)",
      }}
    >
      {CHOICES.map((choice) => {
        const current = choice.language === language;
        return (
          <button
            key={choice.language}
            lang={choice.language}
            aria-pressed={current}
            onClick={() => setLanguage(choice.language)}
            style={{
              minHeight: 36,
              padding: "0 12px",
              borderRadius: 999,
              border: "none",
              background: current ? "var(--accent-soft)" : "transparent",
              color: current ? "var(--accent-strong)" : "var(--muted)",
              fontSize: 13,
              fontWeight: current ? 600 : 500,
              cursor: "pointer",
            }}
          >
            {choice.name}
          </button>
        );
      })}
    </div>
  );
};
