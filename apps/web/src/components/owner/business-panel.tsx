"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type {
  BusinessDto,
  PaymentDto,
  ResourceDto,
  ServiceDto,
  SubscriptionDto,
  SubscriptionState,
} from "@/lib/api/types.ts";
import { formatLocalDate, formatPrice } from "@/lib/format.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { TEXT_RULES } from "@tor-now/domain";
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

/** An optional field left empty is absent, not an empty string. */
const blankToNull = (value: string | null | undefined): string | null =>
  value === null || value === undefined || value.trim() === "" ? null : value.trim();
import { Button, Card, Critical, Field, Note, Sheet, Spinner, Tag, Warning } from "../ui.tsx";

type Panel = "services" | "resources" | "photos" | "settings" | "billing";

const MINOR_UNITS_PER_MAJOR = 100;

/**
 * Everything about the Business itself: what it offers, whose calendars, the
 * rules it books by, and what it owes the platform.
 */
export const BusinessPanel = ({
  token,
  business,
  resources,
  onChanged,
}: {
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
  onChanged: () => void;
}) => {
  const copy = useCopy("owner");
  const { language } = useLanguage();
  const errorText = useErrorText();

  const [panel, setPanel] = useState<Panel>("services");
  const [services, setServices] = useState<ServiceDto[] | null>(null);
  const [billing, setBilling] = useState<{
    subscription: SubscriptionDto;
    payments: PaymentDto[];
    state: SubscriptionState;
  } | null>(null);
  const [editing, setEditing] = useState<Partial<ServiceDto> | null>(null);
  const [newResource, setNewResource] = useState<string | null>(null);
  const [settings, setSettings] = useState(business);
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = useFieldProblem();

  const load = useCallback(async () => {
    try {
      setServices(await api.listServices(token, business.id));
      setBilling(await api.subscription(token, business.id));
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    }
  }, [token, business.id, errorText]);

  useEffect(() => {
    void load();
  }, [load]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      setEditing(null);
      setNewResource(null);
      await load();
      onChanged();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  if (services === null) return <Spinner />;

  return (
    <div style={{ padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {(["services", "resources", "photos", "settings", "billing"] as const).map((candidate) => (
          <button
            key={candidate}
            className="chip"
            onClick={() => setPanel(candidate)}
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
              : copy.billing}
          </button>
        ))}
      </div>

      {error !== null && <Critical>{error}</Critical>}

      {panel === "services" && (
        <>
          {services.map((service) => (
            // A withdrawn service is still the owner's, so it stays on the
            // list — but it must not read as one that customers can book.
            // Greyed and set on a sunken ground so it recedes, and named as
            // hidden in words, because grey alone reads as "disabled" or
            // "still loading" rather than "you took this off the menu".
            <Card
              key={service.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                ...(service.active
                  ? {}
                  : { background: "var(--sunken)", borderStyle: "dashed" }),
              }}
            >
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    flexWrap: "wrap",
                  }}
                >
                  <span
                    style={{
                      fontWeight: 600,
                      ...(service.active ? {} : { color: "var(--faint)" }),
                    }}
                  >
                    {service.name}
                  </span>
                  {!service.active && <Tag text={copy.hidden} tone="neutral" />}
                </span>
                <span className="hint tab" style={service.active ? undefined : { opacity: 0.7 }}>
                  {service.durationMinutes} {copy.minutesShort} ·{" "}
                  {formatPrice(service.priceMinor, language, "—")}
                  {service.bufferMinutes !== null &&
                    ` · ${copy.buffer} ${service.bufferMinutes} ${copy.minutesShort}`}
                </span>
              </span>
              {/* A service's standing is a thing the owner changes, not a label
                  they read. Hiding used to be reachable only through "remove"
                  inside the editor — which withdraws a booked service but
                  permanently deletes one nobody has booked yet, and offered no
                  way back either way. */}
              <button
                className="chip"
                aria-pressed={!service.active}
                style={{
                  // Quiet while it is on offer — taking something off the menu
                  // should not be the loudest thing on the row — and the clear
                  // way back once it is not.
                  border: `1px solid ${service.active ? "var(--line)" : "var(--accent)"}`,
                  background: service.active ? "var(--raised)" : "var(--accent-soft)",
                  color: service.active ? "var(--muted)" : "var(--accent-strong)",
                  fontWeight: service.active ? 400 : 600,
                }}
                onClick={() =>
                  void act(() =>
                    api.updateService(token, business.id, service.id, {
                      active: !service.active,
                    }),
                  )
                }
              >
                {service.active ? copy.hideService : copy.showService}
              </button>
              <button className="chip" style={{ border: "1px solid var(--line)" }} onClick={() => setEditing(service)}>
                {copy.editService}
              </button>
            </Card>
          ))}
          {/* Withdrawing a service never touches bookings already made — each
              keeps the name, duration and price it was booked at. */}
          <Note>{copy.serviceHiddenNote}</Note>
          <Button intent="quiet" onClick={() => setEditing({ name: "", durationMinutes: 30, priceMinor: 0, bufferMinutes: null })}>
            {copy.addService}
          </Button>
        </>
      )}

      {panel === "resources" && (
        <>
          <Note>{copy.resourceNote}</Note>
          {resources.map((resource) => (
            <Card key={resource.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <span style={{ flex: 1, fontWeight: 500 }}>{resource.name}</span>
              <span className="hint">{resource.active ? copy.shown : copy.hidden}</span>
              {resources.length > 1 && (
                <button
                  onClick={() => act(() => api.deleteResource(token, business.id, resource.id))}
                  style={{ color: "var(--critical)", fontSize: 13, minHeight: 40 }}
                >
                  {copy.delete}
                </button>
              )}
            </Card>
          ))}
          <Button intent="quiet" onClick={() => setNewResource("")}>{copy.add}</Button>
        </>
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
            {/* Held as E.164 like the API wants it, typed as local digits like
                everywhere else a number is entered. */}
            <PhoneField id="s-phone" label={copy.fPhone} hint={copy.fPhoneHint}
              value={fromE164(settings.phone)}
              onChange={(local) => { setSettings({ ...settings, phone: toE164(local) }); setSaved(false); }} />
            <Field id="s-address" label={copy.fAddress} hint={copy.fAddressHint} value={settings.address ?? ""}
              problem={problem.text(settings.address ?? "", TEXT_RULES.address)}
              onChange={(e) => { setSettings({ ...settings, address: e.target.value }); setSaved(false); }} />
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
            <Field id="s-buffer" label={`${copy.fBuffer} (${copy.unitMinutes})`} hint={copy.fBufferHint} type="number"
              value={settings.defaultBufferMinutes}
              onChange={(e) => { setSettings({ ...settings, defaultBufferMinutes: Number(e.target.value) }); setSaved(false); }} />
            <Field id="s-cancel" label={`${copy.fCancel} (${copy.unitHours})`} hint={copy.fCancelHint} type="number"
              value={settings.cancellationWindowHours}
              onChange={(e) => { setSettings({ ...settings, cancellationWindowHours: Number(e.target.value) }); setSaved(false); }} />
            {/* ADR 0012's two ends of the booking window. */}
            <Field id="s-notice" label={`${copy.fNotice} (${copy.unitMinutes})`} hint={copy.fNoticeHint} type="number"
              value={settings.minimumNoticeMinutes}
              onChange={(e) => { setSettings({ ...settings, minimumNoticeMinutes: Number(e.target.value) }); setSaved(false); }} />
            <Field id="s-horizon" label={`${copy.fHorizon} (${copy.unitDays})`} hint={copy.fHorizonHint} type="number"
              value={settings.bookingHorizonDays}
              onChange={(e) => { setSettings({ ...settings, bookingHorizonDays: Number(e.target.value) }); setSaved(false); }} />
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
                  address: settings.address === "" ? null : settings.address,
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
            disabled={blocking(
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

      {panel === "billing" && billing !== null && (
        <>
          {billing.state === "IN_GRACE" && <Warning>{copy.billingOverdue}</Warning>}
          <Card style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <Row label={copy.plan} value={billing.subscription.plan} />
            <Row label={copy.amount} value={formatPrice(billing.subscription.amountMinor, language, "—")} />
            <Row label={copy.paidThrough} value={formatLocalDate(billing.subscription.paidThrough, language)} />
            <Row label={copy.grace} value={billing.state} />
          </Card>
          <span className="label">{copy.recentPayments}</span>
          {billing.payments.map((payment) => (
            <Card key={payment.id} style={{ display: "flex", gap: 10 }}>
              <span style={{ flex: 1 }}>{formatLocalDate(payment.paidOn, language)}</span>
              <span className="tab">{formatPrice(payment.amountMinor, language, "—")}</span>
            </Card>
          ))}
          {/* The platform moves no money; a Payment records something that
              already happened elsewhere. */}
          <Note>{copy.billingNote}</Note>
        </>
      )}

      <Sheet open={editing !== null} onClose={() => setEditing(null)}>
        {editing !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 19 }}>{editing.id === undefined ? copy.newService : copy.editService}</h2>
            <Note>{copy.serviceFormHint}</Note>
            <Field id="svc-name" label={copy.serviceName} placeholder={copy.serviceNamePlaceholder}
              problem={problem.text(editing?.name ?? "", TEXT_RULES.serviceName)}
              value={editing.name ?? ""} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <Field id="svc-duration" label={copy.durationMinutes} hint={copy.durationHint} type="number"
              value={editing.durationMinutes ?? 30}
              onChange={(e) => setEditing({ ...editing, durationMinutes: Number(e.target.value) })} />
            <Field id="svc-price" label={copy.price} placeholder={copy.pricePlaceholder} hint={copy.priceHint} type="number"
              value={(editing.priceMinor ?? 0) / MINOR_UNITS_PER_MAJOR}
              onChange={(e) => setEditing({ ...editing, priceMinor: Math.round(Number(e.target.value) * MINOR_UNITS_PER_MAJOR) })} />
            <Field id="svc-buffer" label={copy.buffer} hint={copy.bufferHint} type="number"
              value={editing.bufferMinutes ?? ""}
              placeholder={copy.defaultBuffer}
              onChange={(e) =>
                setEditing({ ...editing, bufferMinutes: e.target.value === "" ? null : Number(e.target.value) })
              } />
            <Button
              busy={busy}
              onClick={() =>
                act(() =>
                  editing.id === undefined
                    ? api.createService(token, business.id, {
                        name: editing.name ?? "",
                        durationMinutes: editing.durationMinutes ?? 30,
                        priceMinor: editing.priceMinor ?? 0,
                        bufferMinutes: editing.bufferMinutes ?? null,
                      })
                    : api.updateService(token, business.id, editing.id, {
                        name: editing.name,
                        durationMinutes: editing.durationMinutes,
                        priceMinor: editing.priceMinor,
                        bufferMinutes: editing.bufferMinutes ?? null,
                      }),
                )
              }
              disabled={checkText(editing.name ?? "", TEXT_RULES.serviceName) !== null}
            >
              {copy.save}
            </Button>
            {editing.id !== undefined && (
              <Button intent="danger" busy={busy}
                onClick={() => act(() => api.deleteService(token, business.id, editing.id as string))}>
                {copy.removeService}
              </Button>
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={newResource !== null} onClose={() => setNewResource(null)}>
        {newResource !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 style={{ fontSize: 19 }}>{copy.resources}</h2>
            <Field id="res-name" label={copy.resources} placeholder={copy.resourceNamePlaceholder}
              problem={problem.text(newResource ?? "", TEXT_RULES.resourceName)}
              value={newResource} onChange={(e) => setNewResource(e.target.value)} />
            <Button busy={busy}
              disabled={checkText(newResource, TEXT_RULES.resourceName) !== null}
              onClick={() => act(() => api.createResource(token, business.id, newResource.trim()))}>
              {copy.add}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
};

const Row = ({ label, value }: { label: string; value: string }) => (
  <div style={{ display: "flex", gap: 10 }}>
    <span className="label" style={{ flex: 1 }}>{label}</span>
    <span style={{ fontWeight: 500, fontSize: 14.5 }}>{value}</span>
  </div>
);
