"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { TEXT_RULES } from "@tor-now/domain";
import { useCopy } from "@/lib/i18n/index.tsx";
import { SUPPORT, emailLink, whatsappLink } from "@/lib/support.ts";
import { useFieldProblem } from "@/lib/use-field-problem.ts";
import { AppHeader } from "@/components/app-header.tsx";
import { Card, MultilineField, Note } from "@/components/ui.tsx";
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
  const problem = useFieldProblem();

  const [open, setOpen] = useState<Question | null>(null);
  const [topic, setTopic] = useState<"customer" | "owner" | "bug">("customer");
  const [message, setMessage] = useState("");

  const topics = [
    { id: "customer", label: copy.topicCustomer },
    { id: "owner", label: copy.topicOwner },
    { id: "bug", label: copy.topicBug },
  ] as const;

  /** What the message says before the person's own words. */
  const composed = () =>
    `${topics.find((candidate) => candidate.id === topic)?.label ?? ""}: ${message.trim()}`;

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
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                <path
                  d="M20 11.5a7.5 7.5 0 0 1-11 6.6L4.5 19.5l1.4-4.4A7.5 7.5 0 1 1 20 11.5Z"
                  stroke="var(--positive)"
                  strokeWidth="1.9"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
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
            <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{copy.email}</span>
              <span className="tab hint" dir="ltr">{SUPPORT.email}</span>
            </span>
          </a>
        </div>

        {/*
         * The message is composed here and handed to WhatsApp, rather than
         * posted to a queue of our own. A ticket the person cannot see, in a
         * system with nowhere to show it to them, would be a worse promise than
         * a conversation they keep on their own phone.
         */}
        <span className="label">{copy.writeLabel}</span>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", gap: 7, flexWrap: "wrap" }}>
            {topics.map((candidate) => {
              const picked = candidate.id === topic;
              return (
                <button
                  key={candidate.id}
                  className="chip"
                  aria-pressed={picked}
                  onClick={() => setTopic(candidate.id)}
                  style={{
                    background: picked ? "var(--accent-soft)" : "var(--raised)",
                    color: picked ? "var(--accent-strong)" : "var(--muted)",
                    border: `1px solid ${picked ? "var(--accent)" : "var(--line)"}`,
                  }}
                >
                  {candidate.label}
                </button>
              );
            })}
          </div>

          <MultilineField
            id="support-message"
            label={copy.messageLabel}
            placeholder={copy.messagePlaceholder}
            value={message}
            problem={problem.text(message, TEXT_RULES.note, message !== "")}
            onChange={(event) => setMessage(event.target.value)}
          />

          <Note>{copy.replyNote}</Note>

          {/* Without words there is nowhere to go: the control keeps its place
              but carries no destination, rather than opening WhatsApp on a
              blank conversation. */}
          <a
            {...(message.trim() === ""
              ? { "aria-disabled": true }
              : { href: whatsappLink(composed()), target: "_blank", rel: "noreferrer" })}
            className={message.trim() === "" ? "quiet" : "primary"}
            style={{ textDecoration: "none" }}
          >
            {copy.send}
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
