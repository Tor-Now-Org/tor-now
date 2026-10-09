"use client";

import { useState } from "react";
import { categoryLabel, TRIAL_DAYS, type BusinessCategory } from "@tor-now/domain";
import { Button, Card } from "@/components/ui.tsx";
import { Tick, TimelineStep } from "@/components/timeline-step.tsx";
import type { PlanName } from "@/lib/api/types.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { whatsappLink } from "@/lib/support.ts";
import {
  businessUrl,
  daysText,
  firstAndMore,
  hoursGroups,
  nameLanguage,
  rangesText,
  whatsappShareLink,
} from "./live-summary.ts";
import { CopyIcon, QrIcon, ShareSheet, shareText, useCopyLink, WhatsAppIcon, type Shared } from "./share-sheet.tsx";
import type { DayHours } from "./week.ts";

/** Calendars named on the card before the rest are counted. */
const CALENDARS_SHOWN = 3;

export type OpenedBusiness = {
  readonly id: string;
  readonly name: string;
  readonly category: BusinessCategory | null;
  readonly address: string;
  readonly services: readonly { name: string; durationMinutes: number; priceMinor: number }[];
  readonly calendars: readonly string[];
  readonly hours: readonly DayHours[];
  readonly plan: PlanName;
  /** The plan's monthly price, for the business that owes it from today. */
  readonly planPriceMinor: number | null;
  /** When the Trial ends; null with no Trial, or when it could not be read. */
  readonly trialEndsOn: string | null;
  /** Set when the owner had their Trial on an earlier business: pay by then. */
  readonly payBy: { readonly tomorrow: boolean; readonly time: string } | null;
  readonly failedPhotos: number;
};

const ShareIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <circle cx="18" cy="5" r="3" />
    <circle cx="6" cy="12" r="3" />
    <circle cx="18" cy="19" r="3" />
    <path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4" />
  </svg>
);

const EyeIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const ClockIcon = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" aria-hidden="true">
    <circle cx="12" cy="12" r="8" />
    <path d="M12 8v4l2.5 1.5" />
  </svg>
);

const PayIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="2.5" y="5.5" width="19" height="13" rx="2.5" />
    <path d="M2.5 10h19M6.5 15h4" />
  </svg>
);

const SummaryRow = ({ label, lines }: { label: string; lines: readonly string[] }) => (
  <div className="live-row">
    <span className="label">{label}</span>
    <span className="live-value">
      <span>{lines[0]}</span>
      {lines.slice(1).map((line) => (
        <small key={line}>{line}</small>
      ))}
    </span>
  </div>
);

/**
 * ADR 0028: the screen a business opens on. It says that it worked, what was
 * made, and the one next thing to do — sharing the link, or, for an owner whose
 * Trial was spent on an earlier business, paying before the deadline. It is a
 * summary, never a form: nothing here changes or removes the business.
 */
export const BusinessLive = ({ business, onDone }: { business: OpenedBusiness; onDone: () => void }) => {
  const copy = useCopy("live");
  const billingCopy = useCopy("billing");
  const onboardingCopy = useCopy("onboarding");
  const { language } = useLanguage();
  const [sheetOpen, setSheetOpen] = useState(false);

  const url = businessUrl(window.location.origin, business.id);
  const link = useCopyLink(url);
  const message = shareText(copy.shareMessage, url);
  const cardLanguage = nameLanguage(business.name, language);
  const kindIn = (inLanguage: "he" | "en") =>
    [business.category === null ? null : categoryLabel(business.category, inLanguage), business.address]
      .filter((part): part is string => part !== null && part.trim() !== "")
      .join(" · ");
  const shared: Shared = { url, name: business.name, cardLanguage, kind: kindIn(cardLanguage) };

  const owes = business.payBy !== null;
  const when = business.payBy?.tomorrow === true ? copy.tomorrow : copy.today;
  const time = business.payBy?.time ?? "";
  const planName = billingCopy.plan[business.plan];

  const [firstService, ...otherServices] = business.services;
  const serviceLines =
    firstService === undefined
      ? []
      : [
          fillText(copy.serviceLine, {
            name: firstService.name,
            minutes: String(firstService.durationMinutes),
            price: formatPrice(firstService.priceMinor, language, copy.free),
          }),
          ...(otherServices.length === 0
            ? []
            : [otherServices.length === 1 ? copy.moreOne : fillText(copy.moreServices, { n: String(otherServices.length) })]),
        ];
  const calendars = firstAndMore(business.calendars, CALENDARS_SHOWN);
  const calendarLines = [
    calendars.shown.join(", "),
    ...(calendars.more === 0 ? [] : [fillText(copy.moreCalendars, { n: String(calendars.more) })]),
  ];
  const hourLines = hoursGroups(business.hours).map(
    (group) => `${daysText(group.days, onboardingCopy.dayShort)} ${rangesText(group.ranges)}`,
  );
  const planLines = owes
    ? [
        business.planPriceMinor === null
          ? planName
          : fillText(copy.planPaid, { plan: planName, price: formatPrice(business.planPriceMinor, language, copy.free) }),
        copy.noTrial,
      ]
    : [
        fillText(copy.planTrial, { plan: planName, days: String(TRIAL_DAYS) }),
        ...(business.trialEndsOn === null
          ? []
          : [
              fillText(copy.trialUntil, {
                date: formatLocalDate(business.trialEndsOn, language, { weekday: "long", day: "numeric", month: "numeric" }),
              }),
            ]),
      ];
  const payHref = whatsappLink(fillText(copy.payMessage, { name: business.name, plan: planName }));

  // The device's own share sheet where there is one; this page's otherwise.
  const shareLink = async () => {
    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: business.name, text: copy.shareMessage, url });
      } catch {
        // A cancelled share sheet is the person changing their mind.
      }
      return;
    }
    setSheetOpen(true);
  };

  return (
    <div className="booked live">
      <div className="booked-hero">
        <span className={`live-badge${owes ? " due" : ""}`}>
          <span className="live-badge-mark">{owes ? <ClockIcon /> : <Tick />}</span>
          {owes ? fillText(copy.badgeUntil, { when, time }) : copy.badgeLive}
        </span>
        <h1 className="live-name">{business.name}</h1>
        {kindIn(language) !== "" && <span className="live-meta">{kindIn(language)}</span>}
        <div className="live-actions">
          {owes ? (
            <a className="booked-action on-navy pay" href={payHref} target="_blank" rel="noreferrer">
              <PayIcon />
              {copy.pay}
            </a>
          ) : (
            <>
              <button type="button" className="booked-action on-navy" onClick={() => void shareLink()}>
                <ShareIcon />
                {copy.shareLink}
              </button>
              <a className="booked-action on-navy" href={url} target="_blank" rel="noreferrer">
                <EyeIcon />
                {copy.asCustomer}
              </a>
            </>
          )}
        </div>
      </div>

      <div className="card live-summary">
        {serviceLines.length > 0 && <SummaryRow label={copy.services} lines={serviceLines} />}
        {calendars.shown.length > 0 && <SummaryRow label={copy.calendars} lines={calendarLines} />}
        {hourLines.length > 0 && <SummaryRow label={copy.open} lines={hourLines} />}
        <SummaryRow label={copy.plan} lines={planLines} />
        {business.failedPhotos > 0 && (
          <p className="live-photo-note">
            {business.failedPhotos === 1 ? copy.photoFailedOne : fillText(copy.photoFailed, { n: String(business.failedPhotos) })}
          </p>
        )}
      </div>

      <div className="booked-side">
        <Card>
          <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
            <TimelineStep state="done" title={copy.stepLive} detail={copy.stepLiveWhen} />
            {owes ? (
              <TimelineStep state="due" title={fillText(copy.stepPay, { when })} detail={fillText(copy.stepPayBody, { when, time })} last>
                <div className="live-step-actions">
                  <a className="booked-action" href={payHref} target="_blank" rel="noreferrer">
                    <WhatsAppIcon />
                    {copy.payWhatsapp}
                  </a>
                </div>
              </TimelineStep>
            ) : (
              <TimelineStep state="todo" title={copy.stepShare} detail={copy.stepShareBody} last>
                <div className="live-step-actions">
                  <a className="booked-action" href={whatsappShareLink(message)} target="_blank" rel="noreferrer">
                    <WhatsAppIcon />
                    {copy.shareWhatsapp}
                  </a>
                  <button type="button" className="booked-action" onClick={() => void link.copy()}>
                    <CopyIcon />
                    <span aria-live="polite">{link.copied ? copy.copied : copy.copyLink}</span>
                  </button>
                  <button type="button" className="booked-action" onClick={() => setSheetOpen(true)}>
                    <QrIcon />
                    {copy.qrCode}
                  </button>
                </div>
              </TimelineStep>
            )}
          </ol>
        </Card>
      </div>

      <div className="booked-go">
        <Button onClick={onDone}>{copy.toCalendar}</Button>
      </div>

      {!owes && <ShareSheet open={sheetOpen} onClose={() => setSheetOpen(false)} shared={shared} />}
    </div>
  );
};
