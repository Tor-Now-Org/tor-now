"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { SUPPORT, emailLink, whatsappLink } from "@/lib/support.ts";
import { AppHeader } from "@/components/app-header.tsx";
import { Card } from "@/components/ui.tsx";
import { Wordmark } from "@/components/logo.tsx";
import { LegalLinks } from "@/components/legal.tsx";

/**
 * Support.
 *
 * Answers before the form. Most of what brings somebody here is a question with
 * a known answer, and making them write a message to get it is a way of being
 * slower on purpose.
 *
 * Split by who is asking, because a customer and a business owner never share
 * a question: one cancels appointments, the other closes days. Somebody signed
 * in with a business opens on the business side; everybody else — including
 * the signed-out person who could not get a code — opens on the customer's.
 *
 * The page needs no session. The person most likely to want help is the one who
 * could not get a code, and a support page behind a sign-in is no use to them.
 */
// Most asked first. The code leads the customer's side because it is the one
// that stops somebody using the product at all.
const QUESTIONS = {
  customer: ["code", "cancel", "move", "remindMe", "forSomeone"],
  business: ["hours", "reschedule", "closeDay", "reminders", "block", "noShow", "notice", "team"],
} as const;
type Side = keyof typeof QUESTIONS;
type Question = (typeof QUESTIONS)[Side][number];

export default function SupportPage() {
  const copy = useCopy("support");
  const router = useRouter();
  const { user } = useSession();

  // Null until somebody picks, so the default can follow the session as it loads.
  const [picked, setPicked] = useState<Side | null>(null);
  const side: Side = picked ?? (user?.isHasBusinesses ? "business" : "customer");
  const [open, setOpen] = useState<Question | null>(null);

  const pick = (next: Side) => {
    setPicked(next);
    setOpen(null);
  };

  return (
    <>
      {/* A chevron and the title. The word "back" beside an arrow that already
          means back is one word too many when the title says where you are. */}
      <AppHeader title={copy.title} onBack={() => router.back()} backLabel={copy.back} showBackLabel={false} />

      <main
        className="scroll"
        style={{
          flex: 1,
          minHeight: 0,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <p
            style={{
              margin: 0,
              fontFamily: "Rubik, sans-serif",
              fontSize: 22,
              fontWeight: 600,
              letterSpacing: "-.015em",
            }}
          >
            {copy.greeting}
          </p>
          <p
            style={{
              margin: 0,
              fontSize: 14,
              lineHeight: 1.6,
              color: "var(--muted)",
            }}
          >
            {copy.lede}
          </p>
        </div>

        <div
          role="tablist"
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 4,
            padding: 4,
            borderRadius: 14,
            background: "var(--sunken)",
          }}
        >
          {(["customer", "business"] as const).map((option) => {
            const selected = side === option;
            return (
              <button
                key={option}
                role="tab"
                aria-selected={selected}
                aria-controls="support-answers"
                onClick={() => pick(option)}
                style={{
                  minHeight: 40,
                  borderRadius: 11,
                  fontSize: 13.5,
                  fontWeight: 600,
                  color: selected ? "var(--ink)" : "var(--muted)",
                  background: selected ? "var(--raised)" : "transparent",
                  boxShadow: selected ? "var(--shadow)" : undefined,
                }}
              >
                {option === "customer" ? copy.roleCustomer : copy.roleBusiness}
              </button>
            );
          })}
        </div>

        <span className="label">{copy.answersLabel}</span>
        {/* flexShrink 0: overflow hidden lets a flex item shrink below its
            content, so on a short screen the list was clipped instead of scrolled. */}
        <Card id="support-answers" role="tabpanel" padded={false} style={{ overflow: "hidden", flexShrink: 0 }}>
          {QUESTIONS[side].map((question, index) => {
            const showing = open === question;
            return (
              <div
                key={question}
                style={{
                  borderTop: index === 0 ? undefined : "1px solid var(--line)",
                }}
              >
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
                  <span style={{ flex: 1, fontSize: 14, fontWeight: 500 }}>{copy[`q_${question}`]}</span>
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 24 24"
                    fill="none"
                    aria-hidden="true"
                    style={{
                      flexShrink: 0,
                      transform: showing ? "rotate(180deg)" : undefined,
                      transition: "transform .2s",
                    }}
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
                      fontSize: 14,
                      lineHeight: 1.65,
                      color: "var(--muted)",
                    }}
                  >
                    {copy[`a_${question}`]}
                  </p>
                )}
              </div>
            );
          })}
        </Card>

        {/* Sticky rather than fixed: it rides the bottom of a long list, and
            settles above the footer once the list ends instead of covering it. */}
        <div
          style={{
            position: "sticky",
            bottom: 0,
            zIndex: 1,
            display: "flex",
            gap: 8,
          }}
        >
          <a
            href={whatsappLink()}
            target="_blank"
            rel="noreferrer"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 50,
              paddingInline: "14px 18px",
              borderRadius: 999,
              background: "var(--positive)",
              color: "var(--on-accent)",
              fontWeight: 600,
              fontSize: 14.5,
              boxShadow: "0 12px 24px -10px oklch(58% 0.115 214/.7)",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51a12.8 12.8 0 0 0-.57-.01c-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 0 1-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 0 1-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 0 1 2.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0 0 12.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 0 0 5.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 0 0-3.48-8.413Z" />
            </svg>
            {copy.whatsapp}
          </a>
          <a
            href={emailLink(copy.title, "")}
            style={{
              minWidth: 0,
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              height: 50,
              paddingInline: "14px 18px",
              borderRadius: 999,
              background: "var(--raised)",
              border: "1px solid var(--line)",
              color: "var(--accent-strong)",
              fontWeight: 600,
              fontSize: 14.5,
              boxShadow: "var(--shadow)",
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <rect x="3" y="5.5" width="18" height="13" rx="3" stroke="currentColor" strokeWidth="1.9" />
              <path
                d="m4 7 8 5.5L20 7"
                stroke="currentColor"
                strokeWidth="1.9"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
            <span className="tab" dir="ltr" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {SUPPORT.email}
            </span>
          </a>
        </div>

        <footer
          style={{
            marginTop: "auto",
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
          <LegalLinks />
          <span className="hint">{copy.rights}</span>
          <span className="tab" style={{ fontSize: 11.5, color: "var(--faint)" }}>
            {copy.version}
          </span>
        </footer>
      </main>
    </>
  );
}
