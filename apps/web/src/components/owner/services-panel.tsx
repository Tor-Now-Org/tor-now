"use client";

import { useState } from "react";
import { SERVICE_MINUTES, TEXT_RULES } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import type { BusinessDto, ServiceDto } from "@/lib/api/types.ts";
import { formatPrice } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { checkText, useFieldProblem } from "@/lib/use-field-problem.ts";
import { NumberField } from "../number-field.tsx";
import { Button, Field, Note, Sheet } from "../ui.tsx";
import { BufferChoice } from "./buffer-choice.tsx";
import { colourOf } from "./event-colour.ts";
import { serviceLine } from "./list-model.ts";
import { DangerRow, ListCard, ListHead, ListRow, ListTag, SheetIdentity, ToggleRow } from "./list-ui.tsx";

const MINOR_UNITS_PER_MAJOR = 100;

/** A service as the sheet edits it: a new one has no id yet. */
type Draft = Partial<ServiceDto> & { readonly durationMinutes: number; readonly priceMinor: number };

const fresh = (): Draft => ({
  name: "",
  durationMinutes: SERVICE_MINUTES.initial,
  priceMinor: 0,
  bufferMinutes: null,
  active: true,
});

/**
 * What the business offers, in the one list design. Each service carries its
 * colour from the calendar as the row's edge — the way its appointments are
 * drawn in the day view — and the line a customer reads under its name. The
 * row opens the editing sheet, where showing or hiding it now lives too.
 */
export const ServicesPanel = ({
  token,
  business,
  services,
  busy,
  act,
  onBufferDefault,
}: {
  token: string;
  business: BusinessDto;
  services: readonly ServiceDto[];
  busy: boolean;
  /** Runs a change and reloads; true when it went through. */
  act: (action: () => Promise<unknown>) => Promise<boolean>;
  /** Where the business's own recovery time is set. */
  onBufferDefault: () => void;
}) => {
  const copy = useCopy("owner");
  const words = useCopy("lists");
  const { language } = useLanguage();
  const problem = useFieldProblem();
  const [editing, setEditing] = useState<Draft | null>(null);

  // The calendar colours a service by its place in this same list.
  const offered = services.map((service) => service.name);
  const price = (minor: number) => formatPrice(minor, language, words.noPrice);
  const lineOf = (service: { durationMinutes: number; priceMinor: number; bufferMinutes: number | null }) =>
    serviceLine(service, business.defaultBufferMinutes, words, price);

  const save = async (draft: Draft) => {
    const saved = await act(() =>
      draft.id === undefined
        ? api.createService(token, business.id, {
            name: (draft.name ?? "").trim(),
            durationMinutes: draft.durationMinutes,
            priceMinor: draft.priceMinor,
            bufferMinutes: draft.bufferMinutes ?? null,
          })
        : api.updateService(token, business.id, draft.id, {
            name: (draft.name ?? "").trim(),
            durationMinutes: draft.durationMinutes,
            priceMinor: draft.priceMinor,
            bufferMinutes: draft.bufferMinutes ?? null,
            active: draft.active !== false,
          }),
    );
    if (saved) setEditing(null);
  };

  const remove = async (id: string) => {
    if (await act(() => api.deleteService(token, business.id, id))) setEditing(null);
  };

  const colour = editing === null ? null : colourOf(editing.name ?? "", editing.id === undefined ? [] : offered);

  return (
    <>
      <ListHead
        id="services-title"
        title={words.services}
        count={services.length}
        countLabel={fillText(words.countOf, { title: words.services, n: String(services.length) })}
        action={{ label: words.add, onClick: () => setEditing(fresh()) }}
      />
      {services.length > 0 && (
        <ListCard labelledBy="services-title">
          {services.map((service) => (
            <ListRow
              key={service.id}
              dataId={service.id}
              title={service.name}
              line={lineOf(service)}
              rail={colourOf(service.name, offered).rail}
              muted={!service.active}
              tags={service.active ? undefined : <ListTag text={words.hidden} />}
              onClick={() => setEditing({ ...service })}
            />
          ))}
        </ListCard>
      )}
      <p className="list-foot">{words.serviceFoot}</p>

      <Sheet open={editing !== null} onClose={() => setEditing(null)} labelledBy="service-sheet-title">
        {editing !== null && (
          <div className="sheet-body">
            {editing.id === undefined ? (
              <h2 id="service-sheet-title" style={{ fontSize: 19 }}>{copy.newService}</h2>
            ) : (
              <SheetIdentity
                id="service-sheet-title"
                title={editing.name === undefined || editing.name.trim() === "" ? copy.editService : editing.name}
                line={lineOf(editing as Draft & { bufferMinutes: number | null })}
                rail={colour?.rail}
              />
            )}
            {/* Standing lives here now, once, rather than as a button on every
                row; a new service is offered from the start. */}
            {editing.id !== undefined && (
              <ToggleRow
                id="service-shown"
                label={words.shown}
                hint={words.serviceShownHint}
                checked={editing.active !== false}
                onChange={(active) => setEditing({ ...editing, active })}
              />
            )}
            <Note>{copy.serviceFormHint}</Note>
            <Field
              id="svc-name"
              label={copy.serviceName}
              placeholder={copy.serviceNamePlaceholder}
              problem={problem.text(editing.name ?? "", TEXT_RULES.serviceName)}
              value={editing.name ?? ""}
              onChange={(event) => setEditing({ ...editing, name: event.target.value })}
            />
            <div className="field-pair">
              <NumberField
                id="svc-duration"
                label={copy.durationMinutes}
                hint={copy.durationHint}
                value={editing.durationMinutes}
                fallback={SERVICE_MINUTES.initial}
                min={SERVICE_MINUTES.min}
                max={SERVICE_MINUTES.max}
                onValue={(minutes) => setEditing({ ...editing, durationMinutes: minutes ?? SERVICE_MINUTES.initial })}
              />
              {/* Nought is no price. The box selects itself when tapped and drops
                  a leading nought, so typing a price over it is one motion. */}
              <NumberField
                id="svc-price"
                label={copy.price}
                hint={copy.priceHint}
                value={editing.priceMinor / MINOR_UNITS_PER_MAJOR}
                fallback={0}
                decimals
                onValue={(shekels) =>
                  setEditing({ ...editing, priceMinor: Math.round((shekels ?? 0) * MINOR_UNITS_PER_MAJOR) })
                }
              />
            </div>
            <BufferChoice
              id="svc-buffer"
              durationMinutes={editing.durationMinutes}
              value={editing.bufferMinutes ?? null}
              businessDefault={business.defaultBufferMinutes}
              onChange={(bufferMinutes) => setEditing({ ...editing, bufferMinutes })}
              colour={colour ?? undefined}
              footer={
                <button
                  type="button"
                  className="buffer-link"
                  onClick={() => {
                    setEditing(null);
                    onBufferDefault();
                  }}
                >
                  {copy.bufferDefaultLink} ›
                </button>
              }
            />
            <Button
              busy={busy}
              disabled={checkText(editing.name ?? "", TEXT_RULES.serviceName) !== null}
              onClick={() => void save(editing)}
            >
              {copy.save}
            </Button>
            {editing.id !== undefined && (
              <DangerRow label={copy.removeService} onClick={() => void remove(editing.id as string)} />
            )}
          </div>
        )}
      </Sheet>
    </>
  );
};
