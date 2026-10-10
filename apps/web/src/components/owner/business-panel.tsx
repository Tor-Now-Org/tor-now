"use client";

import { useCallback, useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { api } from "@/lib/api/client.ts";
import { AddressAutocomplete } from "./address-autocomplete.tsx";
import { CategoryChooser } from "../category-chooser.tsx";
import { businessCategories } from "../category-choice.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  BusinessDto,
  BillingDto,
  ResourceDto,
  ServiceDto,
} from "@/lib/api/types.ts";
import { BillingSection } from "./billing-section.tsx";
import { customersInBusiness } from "@/lib/roles.ts";
import { Customers } from "./customers.tsx";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { leavesRoomToBook, TEXT_RULES } from "@tor-now/domain";
import { spanOfDays, spanOfMinutes } from "@/lib/span-text.ts";
import { useErrorText } from "@/lib/use-error-text.ts";
import {
  blocking,
  checkInstagram,
  checkText,
  useFieldProblem,
} from "@/lib/use-field-problem.ts";
import { checkLocalPhone, fromE164, toE164 } from "@/lib/phone.ts";
import { PhoneField } from "../phone-field.tsx";
import { PhotoPanel } from "./photo-panel.tsx";
import { Team } from "./team.tsx";
import { ServicesPanel } from "./services-panel.tsx";
import { CalendarsPanel } from "./calendars-panel.tsx";

/** An optional field left empty is absent, not an empty string. */
const blankToNull = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value.trim() === "" ? null : value.trim();
import { Button, Card, Critical, Field, Spinner, Warning } from "../ui.tsx";
import { NumberField } from "../number-field.tsx";
import { followersOf } from "./buffer.ts";

// Leaflet reaches for `window`, so the map can only render on the client.
const LocationPicker = dynamic(
  () => import("./location-picker.tsx").then((mod) => mod.LocationPicker),
  { ssr: false },
);

export const PANELS = ["services", "resources", "photos", "settings", "team", "customers", "billing"] as const;
export type Panel = (typeof PANELS)[number];

export const isPanel = (value: string | null): value is Panel =>
  value !== null && (PANELS as readonly string[]).includes(value);

/**
 * Everything about the Business itself: what it offers, whose calendars, the
 * rules it books by, and what it owes the platform.
 */
export const BusinessPanel = ({
  token,
  business,
  resources,
  panel: requestedPanel,
  onPanel,
  onEditCalendar,
  onChanged,
  onTeamChanged,
}: {
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
  /** Held by the page, so switching business keeps the owner on the same sub-tab. */
  panel: Panel;
  onPanel: (panel: Panel) => void;
  /** Takes the owner to this calendar's own schedule, which is where it is edited. */
  onEditCalendar: (resourceId: string) => void;
  /** What changed, so the screen reloads that and not the rest. */
  onChanged: (touches: "everything" | "calendars") => void;
  /** Called when team membership changes. */
  onTeamChanged?: () => void;
}) => {
  const copy = useCopy("owner");
  /** Lengths of time said as a person would, for the booking window's refusal. */
  const spanWords = useCopy("days");
  const { language } = useLanguage();
  const errorText = useErrorText();

  const [services, setServices] = useState<ServiceDto[] | null>(null);
  const [billing, setBilling] = useState<BillingDto | null>(null);
  const [settings, setSettings] = useState(business);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = useFieldProblem();

  // Billing is the OWNER's alone (ADR 0016) — absent role means an API
  // deployed before roles existed, where anybody staffing was an OWNER.
  const isOwner = (business.role ?? "OWNER") === "OWNER";
  // Billing, carried over from a business they own into one they only manage,
  // would be a sub-tab with no chip and nothing under it.
  // The customer list moves here only where the plan gives Statistics, which
  // takes its place in the bottom bar; elsewhere it is still a tab of its own.
  const customersHere = customersInBusiness(business);
  const panel: Panel =
    (requestedPanel === "billing" && !isOwner) || (requestedPanel === "customers" && !customersHere)
      ? "services"
      : requestedPanel;

  const load = useCallback(async () => {
    try {
      // Together: neither answer depends on the other, and asked one after the
      // other they cost two round trips to Frankfurt instead of one.
      const [loadedServices, loadedBilling] = await Promise.all([
        api.listServices(token, business.id),
        isOwner ? api.subscription(token, business.id) : Promise.resolve(null),
      ]);
      setServices(loadedServices);
      setBilling(loadedBilling);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, business.id, isOwner, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * Runs one change and reloads what it could have altered.
   *
   * `touches` says which. Hiding a calendar or renaming one changes nothing
   * about the services on offer or the subscription, and reloading them anyway
   * cost two more round trips on a press whose whole job is to flip a flag —
   * about half the wait, spent asking questions whose answers had not moved.
   */
  const act = async (
    action: () => Promise<unknown>,
    touches: "everything" | "calendars" = "everything",
  ) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      if (touches === "everything") await load();
      onChanged(touches);
      return true;
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (services === null) return <Spinner page />;

  return (
    <div style={{ padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(
          [
            "services",
            "resources",
            "photos",
            "settings",
            "team",
            ...(customersHere ? (["customers"] as const) : []),
            ...(isOwner ? (["billing"] as const) : []),
          ] as const
        ).map((candidate) => (
          <button
            key={candidate}
            className="chip"
            onClick={() => onPanel(candidate)}
            aria-pressed={panel === candidate}
            style={{
              background: panel === candidate ? "var(--accent-soft)" : "transparent",
              color: panel === candidate ? "var(--accent-strong)" : "var(--muted)",
              border: `1px solid ${panel === candidate ? "var(--accent)" : "var(--line)"}`,
            }}
          >
            {candidate === "services" ? copy.services
              : candidate === "resources" ? copy.resources
              : candidate === "photos" ? copy.photos
              : candidate === "settings" ? copy.settings
              : candidate === "team" ? copy.team
              : candidate === "customers" ? copy.tabCustomers
              : copy.billing}
          </button>
        ))}
      </div>

      {error !== null && <Critical>{error}</Critical>}

      {panel === "services" && (
        <ServicesPanel
          token={token}
          business={business}
          services={services}
          busy={busy}
          act={(action) => act(action)}
          onBufferDefault={() => onPanel("settings")}
        />
      )}

      {panel === "resources" && (
        <CalendarsPanel
          token={token}
          business={business}
          resources={resources}
          billing={billing}
          isOwner={isOwner}
          busy={busy}
          act={(action) => act(action, "calendars")}
          onEditCalendar={onEditCalendar}
          onSeePlans={() => onPanel("billing")}
        />
      )}

      {panel === "photos" && (
        <PhotoPanel
          token={token}
          businessId={business.id}
          labels={{
            cover: copy.photoCover,
            coverHint: copy.photoCoverHint,
            more: copy.photoMore,
            moreHint: copy.photoMoreHint,
            add: copy.photoAdd,
            replace: copy.photoReplace,
            remove: copy.photoRemove,
            notAnImage: copy.photoNotAnImage,
          }}
        />
      )}

      {panel === "settings" && (
        <>
          <span className="label">{copy.publicDetails}</span>
          <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field id="s-name" label={copy.fName} hint={copy.fNameHint} value={settings.name}
              problem={problem.text(settings.name, TEXT_RULES.businessName)}
              onChange={(e) => { setSettings({ ...settings, name: e.target.value }); setSaved(false); }} />
            {/* A business registered before Categories existed has none; say what that costs. */}
            <CategoryChooser id="s-category" language={language}
              value={businessCategories(settings)}
              hint={businessCategories(settings).length === 0 ? copy.fCategoryMissing : undefined}
              onChange={(categories) => {
                setSettings({ ...settings, categories, category: categories[0] ?? null });
                setSaved(false);
              }} />
            {/* Held as E.164 like the API wants it, typed as local digits like
                everywhere else a number is entered. */}
            <PhoneField id="s-phone" label={copy.fPhone} hint={copy.fPhoneHint}
              value={fromE164(settings.phone)}
              onChange={(local) => { setSettings({ ...settings, phone: toE164(local) }); setSaved(false); }} />
            <AddressAutocomplete
              id="s-address"
              label={copy.fAddress}
              hint={settings.latitude == null || settings.longitude == null ? copy.fLocationMissing : copy.fAddressHint}
              value={settings.address ?? ""}
              language={language}
              onSelect={(pickedAddress, lat, lng) => {
                setSettings({ ...settings, address: pickedAddress, latitude: lat, longitude: lng });
                setSaved(false);
              }}
              onClear={() => {
                setSettings({ ...settings, address: "", latitude: null, longitude: null });
                setSaved(false);
              }}
            />
            {settings.latitude != null && settings.longitude != null && (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                <span className="label">{copy.locationLabel}</span>
                <LocationPicker latitude={settings.latitude} longitude={settings.longitude} />
              </div>
            )}
            <Field id="s-desc" label={copy.fDescription} hint={copy.fDescriptionHint} value={settings.description ?? ""}
              problem={problem.text(settings.description ?? "", TEXT_RULES.description)}
              onChange={(e) => { setSettings({ ...settings, description: e.target.value }); setSaved(false); }} />
            <Field id="s-tz" label={copy.fTimezone} hint={copy.fTimezoneHint} value={settings.timeZone} readOnly disabled />
          </Card>

          {/* Both optional, and grouped away from the booking rules: these are
              places a customer can reach the business, not settings that change
              what it offers. */}
          <span className="label">{copy.contactChannels}</span>
          <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <Field
              id="s-instagram"
              label={copy.fInstagram}
              hint={copy.fInstagramHint}
              dir="ltr"
              placeholder="yourbusiness"
              value={settings.instagram ?? ""}
              problem={
                (settings.instagram ?? "") === ""
                  ? null
                  : problem.instagram(settings.instagram ?? "")
              }
              onChange={(e) => { setSettings({ ...settings, instagram: e.target.value }); setSaved(false); }}
            />
            {/* The same field as every other number in the app: local digits
                behind the flag, E.164 at the edge. Optional, so an empty one is
                held as null rather than as a dial code with nothing after it. */}
            <PhoneField
              id="s-whatsapp"
              label={copy.fWhatsapp}
              hint={copy.fWhatsappHint}
              value={fromE164(settings.whatsapp ?? "")}
              showProblem={(settings.whatsapp ?? "") !== ""}
              onChange={(local) => {
                setSettings({ ...settings, whatsapp: local === "" ? null : toE164(local) });
                setSaved(false);
              }}
            />
          </Card>

          <span className="label">{copy.bookingRules}</span>
          <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <NumberField id="s-buffer" label={`${copy.fBuffer} (${copy.unitMinutes})`} hint={copy.fBufferHint}
              value={settings.defaultBufferMinutes} fallback={0}
              onValue={(v) => { setSettings({ ...settings, defaultBufferMinutes: v ?? 0 }); setSaved(false); }} />
            {/* Who the default reaches, as it is being typed: a number with no
                services named under it was a setting nobody could place. */}
            {services !== null && followersOf(services, settings.defaultBufferMinutes).length > 0 && (
              <div className="buffer-followers">
                {followersOf(services, settings.defaultBufferMinutes).map((one) => (
                  <div key={one.id}>
                    {one.name}
                    <small>{fillText(one.follows ? copy.bufferFollowsLine : copy.bufferOwnLine, { n: String(one.minutes) })}</small>
                  </div>
                ))}
              </div>
            )}
            <NumberField id="s-cancel" label={`${copy.fCancel} (${copy.unitHours})`} hint={copy.fCancelHint}
              value={settings.cancellationWindowHours} fallback={0}
              onValue={(v) => { setSettings({ ...settings, cancellationWindowHours: v ?? 0 }); setSaved(false); }} />
            {/* ADR 0012's two ends of the booking window. */}
            <NumberField id="s-notice" label={`${copy.fNotice} (${copy.unitMinutes})`} hint={copy.fNoticeHint}
              value={settings.minimumNoticeMinutes} fallback={0}
              onValue={(v) => { setSettings({ ...settings, minimumNoticeMinutes: v ?? 0 }); setSaved(false); }} />
            <NumberField id="s-horizon" label={`${copy.fHorizon} (${copy.unitDays})`} hint={copy.fHorizonHint}
              value={settings.bookingHorizonDays} fallback={1}
              onValue={(v) => { setSettings({ ...settings, bookingHorizonDays: v ?? 1 }); setSaved(false); }} />
            {/* ADR 0026: a notice as long as the horizon leaves customers every
                day empty and nothing to say why — refused here, as it is by the API. */}
            {!leavesRoomToBook(settings) && (
              <Critical>
                {fillText(copy.windowImpossible, {
                  notice: spanOfMinutes(settings.minimumNoticeMinutes, spanWords),
                  horizon: spanOfDays(settings.bookingHorizonDays, spanWords),
                })}
              </Critical>
            )}
          </Card>

          {/* Changing these takes effect for new availability only; ADR 0012
              does not invalidate bookings already made outside the new window. */}
          <Warning>{copy.settingsWarn}</Warning>
          {saved && <p className="hint" role="status" style={{ margin: 0 }}>{copy.settingsSaved}</p>}
          <Button
            busy={busy}
            onClick={() =>
              act(async () => {
                await api.updateBusiness(token, business.id, {
                  name: settings.name,
                  phone: settings.phone,
                  // A location is never cleared: the address and its pin go only as a chosen pair.
                  ...(settings.latitude == null || settings.longitude == null
                    ? {}
                    : { address: settings.address, latitude: settings.latitude, longitude: settings.longitude }),
                  // Changeable, never clearable: nothing is sent until one is chosen.
                  ...(businessCategories(settings).length === 0 ? {} : { categories: businessCategories(settings) }),
                  description: settings.description === "" ? null : settings.description,
                  instagram: blankToNull(settings.instagram),
                  whatsapp: blankToNull(settings.whatsapp),
                  defaultBufferMinutes: settings.defaultBufferMinutes,
                  cancellationWindowHours: settings.cancellationWindowHours,
                  minimumNoticeMinutes: settings.minimumNoticeMinutes,
                  bookingHorizonDays: settings.bookingHorizonDays,
                });
                setSaved(true);
              })
            }
            disabled={!leavesRoomToBook(settings) || blocking(
              checkText(settings.name, TEXT_RULES.businessName),
              checkLocalPhone(fromE164(settings.phone)),
              checkText(settings.address ?? "", TEXT_RULES.address),
              checkText(settings.description ?? "", TEXT_RULES.description),
              // Optional: empty is fine, malformed is not.
              blankToNull(settings.instagram) === null
                ? null
                : checkInstagram(settings.instagram ?? ""),
              blankToNull(settings.whatsapp) === null
                ? null
                : checkLocalPhone(fromE164(settings.whatsapp ?? "")),
            )}
          >
            {copy.save}
          </Button>
        </>
      )}

      {panel === "team" && (
        <div style={{ marginTop: -16, marginInline: -18, paddingInline: 18 }}>
          <Team
            token={token}
            business={business}
            resources={resources}
            onChanged={onTeamChanged ?? (() => {})}
            onSeePlans={isOwner ? () => onPanel("billing") : undefined}
          />
        </div>
      )}

      {panel === "customers" && (
        <div style={{ marginTop: -16, marginInline: -18, paddingInline: 18 }}>
          <Customers token={token} business={business} />
        </div>
      )}

      {panel === "billing" && billing !== null && (
        <BillingSection
          token={token}
          billing={billing}
          timeZone={business.timeZone}
          resources={resources}
          onChanged={(changed) => {
            setBilling(changed);
            // A plan change can pause, mark or bring back calendars, and
            // changes what is locked: the business and its calendars both.
            onChanged("everything");
          }}
        />
      )}

    </div>
  );
};

