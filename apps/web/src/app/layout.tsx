import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { DEFAULT_LANGUAGE, DIRECTION } from "@/lib/i18n/dictionaries.ts";
import { LanguageProvider } from "@/lib/i18n/index.tsx";
import { SessionProvider } from "@/lib/session.tsx";
import "./globals.css";

export const metadata: Metadata = {
  title: "תורNow",
  description:
    "התור הבא שלך, בלי טלפונים ובלי הודעות. מחפשים עסק, רואים מתי הוא פנוי, ותופסים תור.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0A2450",
};

/**
 * The server renders the source language, and the client applies a stored
 * preference after hydration — so the two agree on the first paint and the
 * document element is never patched mid-render.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang={DEFAULT_LANGUAGE} dir={DIRECTION[DEFAULT_LANGUAGE]}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&family=Heebo:wght@300;400;500;700&display=swap"
        />
      </head>
      <body>
        <LanguageProvider>
          <SessionProvider>
            <div className="app-shell">{children}</div>
          </SessionProvider>
        </LanguageProvider>
      </body>
    </html>
  );
}
