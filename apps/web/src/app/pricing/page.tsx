"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { TRIAL_DAYS } from "@tor-now/domain";
import type { PlanDto, PreviewDto } from "@/lib/api/types.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useCatalogue } from "@/lib/use-plans.ts";
import { AppHeader } from "@/components/app-header.tsx";
import { LegalLinks } from "@/components/legal.tsx";
import { Button, Card, Spinner } from "@/components/ui.tsx";

/**
 * What opening a Business costs.
 *
 * The wizard at /onboarding asks for four things and never names a price, so
 * somebody deciding whether to start it has nothing to decide on. This page is
 * that missing answer and nothing more: two plans, what each one is for, and
 * the way in. Nothing here is behind a session — the person weighing it up may
 * not have one yet.
 *
 * Every line is read from the Catalogue — price, calendars, Features — so what
 * an administrator changes there is what this page says (ADR 0021). It is also
 * the one place a plan is chosen: every way into opening a Business comes
 * through here, and the wizard starts on the plan picked.
 */

/** The plan drawn as the one being offered. Marketing's call, not the Catalogue's. */
const RECOMMENDED = "TEAM";

const Check = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path
      d="M5 12l5 5 9-10"
      stroke="var(--positive)"
      strokeWidth="2.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);

type Line = { readonly text: string; readonly tag?: string };

const Feature = ({ line }: { line: Line }) => (
  <li style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5 }}>
    <Check />
    <span style={{ flex: 1 }}>{line.text}</span>
    {line.tag !== undefined && (
      <span
        style={{
          fontSize: 11,
          fontWeight: 600,
          padding: "1px 7px",
          borderRadius: 999,
          background: "var(--caution-soft)",
          color: "var(--caution)",
          whiteSpace: "nowrap",
        }}
      >
        {line.tag}
      </span>
    )}
  </li>
);

const Plan = ({
  name,
  hint,
  price,
  perMonth,
  badge,
  features,
  action,
}: {
  name: string;
  hint: string;
  price: number;
  perMonth: string;
  /** The recommended plan says so, and is drawn as the one being offered. */
  badge?: string;
  features: readonly Line[];
  action: ReactNode;
}) => (
  <Card
    style={{
      position: "relative",
      display: "flex",
      flexDirection: "column",
      gap: 12,
      ...(badge === undefined ? {} : { border: "2px solid var(--accent)" }),
    }}
  >
    {badge !== undefined && (
      <span
        style={{
          position: "absolute",
          insetBlockStart: -11,
          insetInlineStart: 16,
          fontSize: 11.5,
          fontWeight: 600,
          padding: "3px 10px",
          borderRadius: 999,
          background: "var(--accent)",
          color: "var(--on-accent)",
        }}
      >
        {badge}
      </span>
    )}

    <div style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
      <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
        <h2 style={{ fontSize: 17 }}>{name}</h2>
        <span className="hint">{hint}</span>
      </span>
      <span style={{ display: "flex", alignItems: "baseline", gap: 3 }} dir="ltr">
        <span className="tab" style={{ fontFamily: "var(--font-rubik), sans-serif", fontSize: 28, fontWeight: 700 }}>
          ₪{price}
        </span>
      </span>
    </div>
    <span className="hint" style={{ marginBlockStart: -8, textAlign: "end" }}>
      {perMonth}
    </span>

    <ul
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        margin: 0,
        padding: "12px 0 0",
        listStyle: "none",
        borderBlockStart: "1px solid var(--line)",
      }}
    >
      {features.map((line) => (
        <Feature key={line.text} line={line} />
      ))}
    </ul>

    {action}
  </Card>
);

export default function PricingPage() {
  const copy = useCopy("pricing");
  const billing = useCopy("billing");
  const { language } = useLanguage();
  const router = useRouter();
  const { plans, previews } = useCatalogue();

  const linesOf = (plan: PlanDto): Line[] => [
    {
      text:
        plan.resourceAllowance === 1
          ? billing.oneCalendar
          : fillText(billing.upToCalendars, { n: String(plan.resourceAllowance) }),
    },
    { text: copy.unlimited },
    { text: copy.businessPage },
    ...plan.features
      .filter((feature) => !previews.some((preview) => preview.feature === feature))
      .map((feature) => ({ text: billing.featureLine[feature as keyof typeof billing.featureLine] })),
    ...previews.map((preview: PreviewDto) => ({
      text: billing.featureLine[preview.feature],
      tag: fillText(copy.inPreview, {
        date: formatLocalDate(preview.endsOn, language, { day: "numeric", month: "short" }),
      }),
    })),
  ];

  return (
    <>
      <AppHeader
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
        <section style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <span
            style={{
              alignSelf: "start",
              fontSize: 12,
              fontWeight: 600,
              padding: "4px 10px",
              borderRadius: 999,
              background: "var(--cyan-soft)",
              color: "var(--accent-strong)",
            }}
          >
            {fillText(copy.trialBadge, { days: String(TRIAL_DAYS) })}
          </span>
          <h1 style={{ fontSize: 26, lineHeight: 1.25 }}>{copy.headline}</h1>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--muted)" }}>
            {copy.lede}
          </p>
        </section>

        {plans.length === 0 && <Spinner />}
        {[...plans]
          .sort((a, b) => a.priceMinor - b.priceMinor)
          .map((plan) => {
            const recommended = plan.plan === RECOMMENDED;
            return (
              <Plan
                key={plan.plan}
                name={billing.plan[plan.plan]}
                hint={plan.plan === "SOLO" ? copy.soloHint : copy.teamHint}
                price={plan.price}
                perMonth={copy.perMonth}
                {...(recommended ? { badge: copy.teamBadge } : {})}
                features={linesOf(plan)}
                action={
                  <Button
                    intent={recommended ? "primary" : "quiet"}
                    onClick={() => router.push(`/onboarding?plan=${plan.plan}`)}
                  >
                    {fillText(copy.startOn, { plan: billing.plan[plan.plan] })}
                  </Button>
                }
              />
            );
          })}

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 9,
            padding: "14px 16px",
            borderRadius: 16,
            background: "var(--sunken)",
            border: "1px solid var(--line)",
          }}
        >
          <span className="hint">{copy.trustCancel}</span>
          <span className="hint">{copy.trustSetup}</span>
        </div>

        <span style={{ textAlign: "center", fontSize: 12.5, color: "var(--faint)" }}>
          {copy.vat} · {copy.questions} <a href="/support">{copy.talk}</a>
        </span>
        <LegalLinks />
      </main>
    </>
  );
}
