"use client";

import { useState } from "react";
import { TEXT_RULES } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import type { BillingDto, BusinessDto, ResourceDto } from "@/lib/api/types.ts";
import { calendarsFull } from "@/lib/entitlement.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { checkText, useFieldProblem } from "@/lib/use-field-problem.ts";
import { PlanBadge } from "../billing-badges.tsx";
import { Locked, useLockText } from "../locked.tsx";
import { Button, Field, Note, Sheet, Warning } from "../ui.tsx";
import { Mark } from "./lane-mark.tsx";
import { upcomingLine } from "./list-model.ts";
import { DangerRow, ListCard, ListHead, ListRow, ListTag, SheetIdentity, SheetRow, SheetRows, ToggleRow } from "./list-ui.tsx";

/**
 * Whose calendars the business keeps, in the one list design. Each wears its
 * colour from the day view, and the line under the name is what an owner
 * checks before touching one: the bookings still to come. Hours, renaming,
 * showing and deleting are in the sheet a row opens.
 */
export const CalendarsPanel = ({
  token,
  business,
  resources,
  billing,
  isOwner,
  busy,
  act,
  onEditCalendar,
  onSeePlans,
}: {
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
  billing: BillingDto | null;
  isOwner: boolean;
  busy: boolean;
  /** Runs a change and reloads the calendars; true when it went through. */
  act: (action: () => Promise<unknown>) => Promise<boolean>;
  onEditCalendar: (resourceId: string) => void;
  onSeePlans: () => void;
}) => {
  const copy = useCopy("owner");
  const words = useCopy("lists");
  const billingCopy = useCopy("billing");
  const locks = useLockText();
  const problem = useFieldProblem();

  const [openId, setOpenId] = useState<string | null>(null);
  const [newName, setNewName] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const [removing, setRemoving] = useState<ResourceDto | null>(null);

  const onOffer = resources.filter((resource) => resource.active && resource.paused !== true).length;
  const full = calendarsFull(business, onOffer);
  const allowance = business.entitlement?.resourceAllowance ?? onOffer;
  const pausedAny = resources.some((resource) => resource.active && resource.paused === true);
  // The last one on offer cannot be hidden or deleted: a business with nothing
  // bookable has no way to say so.
  const isLast = (resource: ResourceDto) =>
    resource.active && resources.filter((candidate) => candidate.active).length <= 1;
  const open = openId === null ? null : (resources.find((resource) => resource.id === openId) ?? null);
  const indexOf = (resource: ResourceDto) => resources.findIndex((candidate) => candidate.id === resource.id);
  const lineOf = (resource: ResourceDto) =>
    resource.active ? upcomingLine(resource.upcomingAppointments, words) : words.notShown;

  const renameIsBad = renaming === null || checkText(renaming.name, TEXT_RULES.resourceName) !== null;
  const saveRename = async () => {
    if (renaming === null || renameIsBad) return;
    const name = renaming.name.trim();
    if (await act(() => api.updateResource(token, business.id, renaming.id, { name }))) setRenaming(null);
  };
  const removeWith = async (resource: ResourceDto, upcoming: "KEEP" | "CANCEL") => {
    if (await act(() => api.deleteResource(token, business.id, resource.id, upcoming))) {
      setRemoving(null);
      setOpenId(null);
    }
  };

  return (
    <>
      {pausedAny && (
        <Warning>
          {allowance === 1 ? billingCopy.pausedNoteOne : fillText(billingCopy.pausedNoteMany, { n: String(allowance) })}
        </Warning>
      )}
      <ListHead
        id="calendars-title"
        title={words.calendars}
        count={resources.length}
        countLabel={fillText(words.countOf, { title: words.calendars, n: String(resources.length) })}
        action={full ? undefined : { label: words.add, onClick: () => setNewName("") }}
      />
      {/* Said only when there is no room left: while there is, the screen is
          what it always was. */}
      {full && (
        <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, color: "var(--muted)" }}>
          {billing !== null && <PlanBadge plan={billing.subscription.plan} />}
          <span>
            {allowance === 1 ? billingCopy.calendarsFullOne : fillText(billingCopy.calendarsFullMany, { n: String(allowance) })}
          </span>
        </div>
      )}
      <ListCard labelledBy="calendars-title">
        {resources.map((resource, index) => (
          <ListRow
            key={resource.id}
            dataId={resource.id}
            title={resource.name}
            line={lineOf(resource)}
            leading={<Mark name={resource.name} index={index} size={34} />}
            muted={!resource.active || resource.paused === true}
            tags={
              !resource.active ? (
                <ListTag text={words.hidden} />
              ) : resource.paused === true ? (
                <ListTag text={words.paused} tone="caution" />
              ) : undefined
            }
            onClick={() => setOpenId(resource.id)}
          />
        ))}
      </ListCard>
      {full && (
        <Locked
          {...locks.calendar(business.entitlement?.resourceAllowance ?? 1)}
          {...(isOwner ? { action: billingCopy.seePlans, onAction: onSeePlans } : {})}
        />
      )}
      <p className="list-foot">{words.calendarFoot}</p>

      <Sheet open={open !== null && renaming === null && removing === null} onClose={() => setOpenId(null)} labelledBy="calendar-sheet-title">
        {open !== null && (
          <div className="sheet-body">
            <SheetIdentity
              id="calendar-sheet-title"
              title={open.name}
              line={lineOf(open) ?? undefined}
              leading={<Mark name={open.name} index={indexOf(open)} size={44} />}
            />
            <SheetRows>
              <SheetRow label={words.calendarHours} onClick={() => onEditCalendar(open.id)} />
              <SheetRow label={words.calendarRename} onClick={() => setRenaming({ id: open.id, name: open.name })} />
              {!isLast(open) && (
                <ToggleRow
                  id="calendar-shown"
                  label={words.shown}
                  hint={!open.active && full ? words.calendarShowLocked : words.calendarShownHint}
                  checked={open.active}
                  // Showing a hidden calendar is adding one: with the
                  // allowance full it waits for room.
                  disabled={busy || (!open.active && full)}
                  onChange={(active) => void act(() => api.updateResource(token, business.id, open.id, { active }))}
                />
              )}
            </SheetRows>
            {isLast(open) ? (
              <Note>{words.calendarLast}</Note>
            ) : (
              <DangerRow label={words.deleteCalendar} onClick={() => setRemoving(open)} />
            )}
          </div>
        )}
      </Sheet>

      <Sheet open={renaming !== null} onClose={() => setRenaming(null)} labelledBy="rename-title">
        {renaming !== null && (
          <div className="sheet-body">
            <h2 id="rename-title" style={{ fontSize: 19 }}>{copy.renameCalendar}</h2>
            {/* Renaming touches nothing else: hours, blocks and appointments
                hang off the calendar's identity rather than its name. */}
            <Note>{copy.renameCalendarNote}</Note>
            <Field
              id="rename-resource"
              label={copy.resourceNamePlaceholder}
              value={renaming.name}
              autoFocus
              onFocus={(event) => event.target.select()}
              onKeyDown={(event) => {
                if (event.key !== "Enter" || renameIsBad) return;
                event.preventDefault();
                void saveRename();
              }}
              problem={problem.text(renaming.name, TEXT_RULES.resourceName)}
              onChange={(event) => setRenaming({ ...renaming, name: event.target.value })}
            />
            <Button busy={busy} disabled={renameIsBad} onClick={() => void saveRename()}>
              {copy.save}
            </Button>
            <Button intent="quiet" onClick={() => setRenaming(null)}>
              {copy.removeCalendarBack}
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={removing !== null} onClose={() => setRemoving(null)} labelledBy="remove-calendar-title">
        {removing !== null && (
          <div className="sheet-body">
            <h2 id="remove-calendar-title" style={{ fontSize: 19 }}>
              {copy.removeCalendarTitle.replace("{name}", removing.name)}
            </h2>
            {/* What happens to the past is not a question, so it is stated. */}
            <Note>{copy.removeCalendarPast}</Note>
            {(removing.upcomingAppointments ?? 0) > 0 ? (
              <>
                <Warning>
                  {copy.removeCalendarUpcoming.replace("{count}", String(removing.upcomingAppointments ?? 0))}
                </Warning>
                <Button busy={busy} intent="quiet" onClick={() => void removeWith(removing, "KEEP")}>
                  {copy.removeCalendarKeep}
                </Button>
                <Button busy={busy} intent="danger" onClick={() => void removeWith(removing, "CANCEL")}>
                  {copy.removeCalendarCancel}
                </Button>
              </>
            ) : (
              <Button busy={busy} intent="danger" onClick={() => void removeWith(removing, "KEEP")}>
                {copy.removeCalendarConfirm}
              </Button>
            )}
            <Button intent="quiet" onClick={() => setRemoving(null)}>
              {copy.removeCalendarBack}
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet open={newName !== null} onClose={() => setNewName(null)} labelledBy="new-calendar-title">
        {newName !== null && (
          <div className="sheet-body">
            <h2 id="new-calendar-title" style={{ fontSize: 19 }}>{copy.resources}</h2>
            <Field
              id="res-name"
              label={copy.resources}
              placeholder={copy.resourceNamePlaceholder}
              problem={problem.text(newName, TEXT_RULES.resourceName)}
              value={newName}
              onChange={(event) => setNewName(event.target.value)}
            />
            <Button
              busy={busy}
              disabled={checkText(newName, TEXT_RULES.resourceName) !== null}
              onClick={() =>
                void act(() => api.createResource(token, business.id, newName.trim())).then((made) => {
                  if (made) setNewName(null);
                })
              }
            >
              {copy.add}
            </Button>
          </div>
        )}
      </Sheet>
    </>
  );
};
