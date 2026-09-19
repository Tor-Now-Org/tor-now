"use client";

import type { ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useCopy } from "@/lib/i18n/index.tsx";
import { SOLO_PRICE, TEAM_PRICE } from "@/lib/plans.ts";
import { AppHeader } from "@/components/app-header.tsx";
import { Button, Card } from "@/components/ui.tsx";

/**
 * What opening a Business costs.
 *
 * The wizard at /onboarding asks for four things and never names a price, so
 * somebody deciding whether to start it has nothing to decide on. This page is
 * that missing answer and nothing more: two plans, what each one is for, and
 * the way in. Nothing here is behind a session — the person weighing it up may
 * not have one yet.
 *
 * ponytail: the plans are drawn, not charged for. A Subscription exists the day
 * a trial has to end; until then this page is the whole of the commercial side.
 */

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

const Feature = ({ children }: { children: ReactNode }) => (
  <li style={{ display: "flex", alignItems: "center", gap: 9, fontSize: 13.5 }}>
    <Check />
    <span>{children}</span>
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
  features: readonly string[];
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
        <span className="tab" style={{ fontFamily: "Rubik, sans-serif", fontSize: 28, fontWeight: 700 }}>
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
      {features.map((feature) => (
        <Feature key={feature}>{feature}</Feature>
      ))}
    </ul>

    {action}
  </Card>
);

export default function PricingPage() {
  const copy = useCopy("pricing");
  const router = useRouter();
  const start = () => router.push("/onboarding");

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
            {copy.trialBadge}
          </span>
          <h1 style={{ fontSize: 26, lineHeight: 1.25 }}>{copy.headline}</h1>
          <p style={{ margin: 0, fontSize: 14.5, lineHeight: 1.6, color: "var(--muted)" }}>
            {copy.lede}
          </p>
        </section>

        <Plan
          name={copy.soloName}
          hint={copy.soloHint}
          price={SOLO_PRICE}
          perMonth={copy.perMonth}
          features={[copy.soloFeature1, copy.soloFeature2, copy.soloFeature3]}
          action={
            <Button intent="quiet" onClick={start}>
              {copy.start}
            </Button>
          }
        />

        <Plan
          name={copy.teamName}
          hint={copy.teamHint}
          price={TEAM_PRICE}
          perMonth={copy.perMonth}
          badge={copy.teamBadge}
          features={[copy.teamFeature1, copy.teamFeature2, copy.teamFeature3]}
          action={<Button onClick={start}>{copy.start}</Button>}
        />

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
      </main>
    </>
  );
}
