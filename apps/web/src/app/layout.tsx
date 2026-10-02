import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Heebo, Rubik } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { SpeedInsights } from "@vercel/speed-insights/next";
import { DEFAULT_LANGUAGE, DIRECTION } from "@/lib/i18n/dictionaries.ts";
import { LanguageProvider } from "@/lib/i18n/index.tsx";
import { SessionProvider } from "@/lib/session.tsx";
import { TermsNotice } from "@/components/legal.tsx";
import "./globals.css";
import "./costs.css";

// Downloaded at build and served from our own domain, so no visitor request reaches Google.
const heebo = Heebo({ subsets: ["hebrew", "latin"], variable: "--font-heebo" });
const rubik = Rubik({ subsets: ["hebrew", "latin"], variable: "--font-rubik" });

export const metadata: Metadata = {
  title: "תור פנוי · Tor Panuy",
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
    <html lang={DEFAULT_LANGUAGE} dir={DIRECTION[DEFAULT_LANGUAGE]} className={`${heebo.variable} ${rubik.variable}`}>
      <body>
        <LanguageProvider>
          <SessionProvider>
            <div className="app-shell">
              {children}
              <TermsNotice />
            </div>
          </SessionProvider>
        </LanguageProvider>
        <Analytics />
        <SpeedInsights />
      </body>
    </html>
  );
}
