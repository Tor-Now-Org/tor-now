"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCopy } from "@/lib/i18n/index.tsx";
import { SUPPORT, emailLink, whatsappLink } from "@/lib/support.ts";
import { AppHeader } from "@/components/app-header.tsx";
import { Card } from "@/components/ui.tsx";
import { Wordmark } from "@/components/logo.tsx";

/**
 * Support.
 *
 * Answers before the form. Most of what brings somebody here is a question with
 * a known answer, and making them write a message to get it is a way of being
 * slower on purpose.
 *
 * The page needs no session. The person most likely to want help is the one who
 * could not get a code, and a support page behind a sign-in is no use to them.
 */
const QUESTIONS = ["cancel", "move", "code", "hours"] as const;
type Question = (typeof QUESTIONS)[number];

export default function SupportPage() {
  const copy = useCopy("support");
  const router = useRouter();

  const [open, setOpen] = useState<Question | null>(null);

  return (
    <>
      {/* A chevron and the title. The word "back" beside an arrow that already
          means back is one word too many when the title says where you are. */}
      <AppHeader
        languageLabel={copy.langSwitch}
        title={copy.title}
        onBack={() => router.back()}
        backLabel={copy.back}
        showBackLabel={false}
      />

      <main
        className="scroll"
        style={{
          flex: 1,
          minHeight: 0,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        <p style={{ margin: 0, fontSize: 14, lineHeight: 1.6, color: "var(--muted)" }}>
          {copy.lede}
        </p>

        <span className="label">{copy.answersLabel}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {QUESTIONS.map((question) => {
            const showing = open === question;
            return (
              <Card key={question} style={{ padding: 0, overflow: "hidden" }}>
                <button
                  onClick={() => setOpen(showing ? null : question)}
                  aria-expanded={showing}
                  style={{
                    width: "100%",
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    padding: "14px 15px",
                    textAlign: "start",
                  }}
                >
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>
                    {copy[`q_${question}`]}
                  </span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    style={{ flexShrink: 0, transform: showing ? "rotate(180deg)" : undefined }}
                  >
                    <path
                      d="m6 9 6 6 6-6"
                      stroke="var(--faint)"
                      strokeWidth="2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </button>
                {showing && (
                  <p
                    style={{
                      margin: 0,
                      padding: "0 15px 14px",
                      fontSize: 13,
                      lineHeight: 1.65,
                      color: "var(--muted)",
                    }}
                  >
                    {copy[`a_${question}`]}
                  </p>
                )}
              </Card>
            );
          })}
        </div>

        <span className="label">{copy.reachLabel}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          <a
            href={whatsappLink()}
            target="_blank"
            rel="noreferrer"
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 15px",
              color: "inherit",
            }}
          >
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 40,
                height: 40,
                flexShrink: 0,
                borderRadius: 13,
                background: "var(--positive-soft)",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="var(--positive)" aria-hidden="true">
                <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
              </svg>
            </span>
            <span style={{ flex: 1, display: "flex", flexDirection: "row", minWidth: 0, alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{copy.whatsapp}</span>
              <span className="tab hint" dir="ltr">{SUPPORT.whatsapp}</span>
            </span>
            <span
              style={{
                display: "inline-flex",
                padding: "4px 11px",
                borderRadius: 999,
                fontSize: 11.5,
                fontWeight: 500,
                whiteSpace: "nowrap",
                background: "var(--positive-soft)",
                border: "1px solid oklch(58% 0.115 214/.28)",
                color: "var(--positive)",
              }}
            >
              {copy.usually}
            </span>
          </a>

          <a
            href={emailLink(copy.title, "")}
            className="card"
            style={{
              display: "flex",
              alignItems: "center",
              gap: 12,
              padding: "14px 15px",
              color: "inherit",
            }}
          >
            <span
              style={{
                display: "grid",
                placeItems: "center",
                width: 40,
                height: 40,
                flexShrink: 0,
                borderRadius: 13,
                background: "var(--accent-soft)",
              }}
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <rect x="3" y="5.5" width="18" height="13" rx="3" stroke="var(--accent-strong)" strokeWidth="1.9" />
                <path
                  d="m4 7 8 5.5L20 7"
                  stroke="var(--accent-strong)"
                  strokeWidth="1.9"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span style={{ flex: 1, display: "flex", flexDirection: "row", minWidth: 0, alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{copy.email}</span>
              <span className="tab hint" dir="ltr">{SUPPORT.email}</span>
            </span>
          </a>
        </div>

        <footer
          style={{
            marginTop: 6,
            paddingTop: 16,
            borderTop: "1px solid var(--line)",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 7,
            textAlign: "center",
          }}
        >
          <Wordmark size={15} />
          <span style={{ fontSize: 12.5, color: "var(--muted)" }}>{copy.builtWith}</span>
          <span className="hint">{copy.rights}</span>
          <span className="tab" style={{ fontSize: 11.5, color: "var(--faint)" }}>
            {copy.version}
          </span>
        </footer>
      </main>
    </>
  );
}
