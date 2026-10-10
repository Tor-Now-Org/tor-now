"use client";

import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, ResourceDto, TeamMemberDto } from "@/lib/api/types.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { TEXT_RULES } from "@tor-now/domain";
import { useErrorText } from "@/lib/use-error-text.ts";
import { blocking, checkText, useFieldProblem } from "@/lib/use-field-problem.ts";
import { checkLocalPhone, toE164 } from "@/lib/phone.ts";
import { PhoneField } from "../phone-field.tsx";
import { Button, Chip, Critical, Empty, Field, Note, Sheet, Spinner } from "../ui.tsx";
import { Locked, useLockText } from "../locked.tsx";
import { includes } from "@/lib/entitlement.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { phoneShown } from "@/lib/phone.ts";
import { PhoneActions } from "../phone-actions.tsx";
import { laneColourOf } from "./event-colour.ts";
import { DangerRow, Initial, ListCard, ListHead, ListRow, ListTag, SheetIdentity, SheetRow, SheetRows } from "./list-ui.tsx";

/** The three a person can be given. CUSTOMER is not a thing you invite somebody as. */
const ROLES = ["OWNER", "MANAGER", "WORKER"] as const;
type Role = (typeof ROLES)[number];

/** What the sheet holds, whether it is inviting somebody or changing their terms. */
type Draft = {
  /** The membership being changed, or null while inviting. */
  member: TeamMemberDto | null;
  /** Local digits, as PhoneField holds them. Unused on an edit. */
  phone: string;
  givenName: string;
  familyName: string;
  role: Role;
  resourceIds: string[];
  /** Set once the phone matched a real User; locks the name fields to theirs. */
  locked: boolean;
};

const EMPTY: Draft = {
  member: null,
  phone: "",
  givenName: "",
  familyName: "",
  role: "WORKER",
  resourceIds: [],
  locked: false,
};

/**
 * Who else gets into this Business, and how far (ADR 0016).
 *
 * The role is the whole of the answer, so it is what a row shows and what the
 * sheet asks. Calendars are asked for only where they mean something — an
 * OWNER and a MANAGER reach all of them, and ticking boxes that change nothing
 * would read as though they did.
 */
export const Team = ({
  token,
  business,
  resources,
  onChanged,
  onSeePlans,
}: {
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
  /** The actor may have just changed their own terms, so the screen reloads. */
  onChanged?: () => void;
  /** Opens the plans; absent for someone who cannot change the plan. */
  onSeePlans?: (() => void) | undefined;
}) => {
  const copy = useCopy("owner");
  const words = useCopy("lists");
  const billingCopy = useCopy("billing");
  const locks = useLockText();
  const { user } = useSession();
  const errorText = useErrorText();
  const problem = useFieldProblem();
  /**
   * Which fields have been left, so a form does not scold somebody for not
   * having filled it in yet. An empty box is only wrong once it has been
   * visited and abandoned; on the way in it is simply empty, and "שדה חובה"
   * under every field of a sheet that just opened reads as a form already
   * failing.
   */
  const [left, setLeft] = useState<Record<string, boolean>>({});

  const [members, setMembers] = useState<TeamMemberDto[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<TeamMemberDto | null>(null);
  /** The colleague whose sheet is open: their number, their terms, and removing them. */
  const [viewing, setViewing] = useState<TeamMemberDto | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  const load = useCallback(async () => {
    try {
      setMembers(await api.listUsers(token, business.id));
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
      setDraft(null);
      setRemoving(null);
      await load();
      onChanged?.();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  if (members === null) return <Spinner page />;

  // Absent means an API deployed before roles existed, where anybody staffing
  // was an owner. Treating the absence as the weakest role would lock the
  // screen against the very person allowed to use it.
  const mine = business.role ?? "OWNER";

  /** A MANAGER may not add, change or remove an OWNER. Only an OWNER may. */
  const mayTouch = (member: TeamMemberDto) => mine === "OWNER" || member.role !== "OWNER";
  const named = (ids: readonly string[]) =>
    resources
      .filter((resource) => ids.includes(resource.id))
      .map((resource) => resource.name)
      .join(", ");

  const draftBlocked =
    draft === null ||
    (draft.role === "WORKER" && draft.resourceIds.length === 0) ||
    (draft.member === null &&
      blocking(
        checkLocalPhone(draft.phone),
        checkText(draft.givenName, TEXT_RULES.personName),
      ));

  const roleWord = (member: TeamMemberDto) => copy[`role${member.role === "CUSTOMER" ? "WORKER" : member.role}`];
  /** A worker's calendars, each in its colour from the day view. */
  const calendarsOf = (member: TeamMemberDto) =>
    resources
      .map((resource, index) => ({ resource, index }))
      .filter(({ resource }) => member.resourceIds.includes(resource.id));
  const edit = (member: TeamMemberDto) => {
    setViewing(null);
    setDraft({
      member,
      phone: "",
      givenName: member.givenName,
      familyName: member.familyName ?? "",
      role: member.role === "CUSTOMER" ? "WORKER" : member.role,
      resourceIds: [...member.resourceIds],
      locked: false,
    });
  };
  const mayInvite = includes(business, "TEAM_ROLES");

  return (
    <div style={{ padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
      <ListHead
        id="team-title"
        title={words.team}
        count={members.length}
        countLabel={fillText(words.countOf, { title: words.team, n: String(members.length) })}
        action={
          mayInvite
            ? {
                label: words.invite,
                onClick: () => {
                  setLeft({});
                  setDraft(EMPTY);
                },
              }
            : undefined
        }
      />

      {error !== null && <Critical>{error}</Critical>}

      {members.length === 0 ? (
        <Empty title={copy.noTeam} />
      ) : (
        <ListCard labelledBy="team-title">
          {members.map((member) => {
            const yours = member.id === user?.id;
            const calendars = member.role === "WORKER" ? calendarsOf(member) : [];
            return (
              <ListRow
                key={member.membershipId}
                dataId={member.membershipId}
                title={member.name}
                titleExtra={yours ? <span className="list-you">{words.you}</span> : undefined}
                leading={<Initial name={member.name} pending={member.pending} />}
                line={
                  <>
                    <span>{roleWord(member)}</span>
                    {calendars.map(({ resource, index }) => (
                      <span key={resource.id} style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        <span className="list-dot" style={{ background: laneColourOf(index) }} aria-hidden="true" />
                        {resource.name}
                      </span>
                    ))}
                  </>
                }
                tags={member.pending ? <ListTag text={words.pending} tone="caution" /> : undefined}
                // Your own terms are not yours to change, and a MANAGER may
                // not change an OWNER's: those rows open nothing.
                onClick={mayTouch(member) && !yours ? () => setViewing(member) : undefined}
              />
            );
          })}
        </ListCard>
      )}

      {/* Whoever is on the team already stays; what the plan holds back is
          adding someone new (ADR 0019). */}
      {!mayInvite && (
        <Locked
          {...locks.feature("TEAM_ROLES")}
          {...(onSeePlans === undefined ? {} : { action: billingCopy.seePlans, onAction: onSeePlans })}
        />
      )}
      <p className="list-foot">{words.teamFoot}</p>

      <Sheet open={viewing !== null} onClose={() => setViewing(null)} labelledBy="member-sheet-title">
        {viewing !== null && (
          <div className="sheet-body">
            <SheetIdentity
              id="member-sheet-title"
              title={viewing.name}
              line={<span dir="ltr">{phoneShown(viewing.phone)}</span>}
              leading={<Initial name={viewing.name} pending={viewing.pending} size="big" />}
            />
            {viewing.pending && <ListTag text={words.pending} tone="caution" />}
            <PhoneActions
              phone={viewing.phone}
              labels={{ call: words.call, whatsapp: words.whatsapp }}
              named
            />
            <SheetRows>
              <SheetRow label={words.role} value={roleWord(viewing)} onClick={() => edit(viewing)} />
              {viewing.role === "WORKER" && (
                <SheetRow
                  label={words.memberCalendars}
                  value={named(viewing.resourceIds)}
                  onClick={() => edit(viewing)}
                />
              )}
            </SheetRows>
            <DangerRow
              label={words.removeMember}
              onClick={() => {
                setRemoving(viewing);
                setViewing(null);
              }}
            />
          </div>
        )}
      </Sheet>

      <Sheet open={draft !== null} onClose={() => setDraft(null)} labelledBy="team-draft-title">
        {draft !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 id="team-draft-title" style={{ fontSize: 19 }}>
              {draft.member === null ? copy.inviteTitle : copy.editMember}
            </h2>

            {draft.member === null && (
              <>
                <span className="hint">{copy.inviteHint}</span>
                <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <PhoneField
                    id="team-phone"
                    label={copy.memberPhone}
                    value={draft.phone}
                    // The number is the identity here, and it is what decides
                    // whether the name below is even asked for — so it is where
                    // the sheet opens.
                    autoFocus
                    showProblem={left["phone"] === true}
                    onChange={(phone) => setDraft({ ...draft, phone, locked: false })}
                    onBlur={() => {
                      setLeft((was) => ({ ...was, phone: true }));
                      if (checkLocalPhone(draft.phone) !== null) return;
                      const phone = draft.phone;
                      setLooking(true);
                      api
                        .lookupUserByPhone(token, business.id, toE164(phone))
                        .then((result) => {
                          setDraft((current) => {
                            if (current === null || current.phone !== phone) return current;
                            return result.exists
                              ? {
                                  ...current,
                                  givenName: result.givenName,
                                  familyName: result.familyName ?? "",
                                  locked: true,
                                }
                              : current;
                          });
                        })
                        .catch(() => {})
                        .finally(() => setLooking(false));
                    }}
                  />
                  {looking && <Spinner />}
                </span>
                <Field
                  id="team-given-name"
                  label={copy.memberFirstName}
                  autoComplete="given-name"
                  value={draft.givenName}
                  disabled={draft.locked}
                  problem={problem.text(
                    draft.givenName,
                    TEXT_RULES.personName,
                    left["givenName"] === true,
                  )}
                  onBlur={() => setLeft((was) => ({ ...was, givenName: true }))}
                  onChange={(event) => setDraft({ ...draft, givenName: event.target.value })}
                />
                <Field
                  id="team-family-name"
                  label={copy.memberLastName}
                  autoComplete="family-name"
                  value={draft.familyName}
                  disabled={draft.locked}
                  onChange={(event) => setDraft({ ...draft, familyName: event.target.value })}
                />
              </>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {ROLES.filter((role) => role !== "OWNER" || mine === "OWNER").map((role) => (
                <Chip
                  key={role}
                  selected={draft.role === role}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      role,
                      // An owner and a manager reach every calendar, so an
                      // assignment made before the role changed is now noise.
                      resourceIds: role === "WORKER" ? draft.resourceIds : [],
                    })
                  }
                  style={{ justifyContent: "flex-start", textAlign: "start" }}
                >
                  {copy[`role${role}`]}
                  <span className="hint" style={{ marginInlineStart: 6 }}>
                    {copy[`role${role}Hint`]}
                  </span>
                </Chip>
              ))}
            </div>

            {draft.role === "WORKER" && (
              <>
                <span className="label">{copy.whichCalendars}</span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {resources.map((resource) => (
                    <Chip
                      key={resource.id}
                      selected={draft.resourceIds.includes(resource.id)}
                      onClick={() =>
                        setDraft({
                          ...draft,
                          resourceIds: draft.resourceIds.includes(resource.id)
                            ? draft.resourceIds.filter((id) => id !== resource.id)
                            : [...draft.resourceIds, resource.id],
                        })
                      }
                    >
                      {resource.name}
                    </Chip>
                  ))}
                </div>
                {draft.resourceIds.length === 0 && (
                  <span className="hint">{copy.pickACalendar}</span>
                )}
              </>
            )}

            <Button
              busy={busy}
              disabled={draftBlocked}
              onClick={() =>
                act(() =>
                  draft.member === null
                    ? api.inviteUser(token, business.id, {
                        phone: toE164(draft.phone),
                        givenName: draft.givenName.trim(),
                        familyName: draft.familyName.trim() === "" ? null : draft.familyName.trim(),
                        role: draft.role,
                        ...(draft.role === "WORKER" ? { resourceIds: draft.resourceIds } : {}),
                      })
                    : api.updateUser(token, business.id, draft.member.membershipId, {
                        role: draft.role,
                        ...(draft.role === "WORKER" ? { resourceIds: draft.resourceIds } : {}),
                      }),
                )
              }
            >
              {draft.member === null ? copy.invite : copy.save}
            </Button>
          </div>
        )}
      </Sheet>

      <Sheet
        open={removing !== null}
        onClose={() => setRemoving(null)}
        labelledBy="remove-member-title"
      >
        {removing !== null && (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <h2 id="remove-member-title" style={{ fontSize: 19 }}>
              {copy.removeMemberTitle.replace("{name}", removing.name)}
            </h2>
            <Note>{copy.removeMemberBody}</Note>
            <Button
              busy={busy}
              intent="danger"
              onClick={() => act(() => api.removeUser(token, business.id, removing.membershipId))}
            >
              {copy.removeMemberConfirm}
            </Button>
            <Button intent="quiet" onClick={() => setRemoving(null)}>
              {copy.removeMemberBack}
            </Button>
          </div>
        )}
      </Sheet>
    </div>
  );
};
