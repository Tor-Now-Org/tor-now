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
import { Button, Card, Chip, Critical, Empty, Field, Note, Sheet, Spinner } from "../ui.tsx";

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
}: {
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
  /** The actor may have just changed their own terms, so the screen reloads. */
  onChanged: () => void;
}) => {
  const copy = useCopy("owner");
  const { user } = useSession();
  const errorText = useErrorText();
  const problem = useFieldProblem();

  const [members, setMembers] = useState<TeamMemberDto[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [removing, setRemoving] = useState<TeamMemberDto | null>(null);
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
      onChanged();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  if (members === null) return <Spinner />;

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

  return (
    <div style={{ padding: "16px 18px 28px", display: "flex", flexDirection: "column", gap: 14 }}>
      <h3 style={{ fontSize: 25, margin: 0, fontWeight: 500 }}>{copy.team}</h3>

      {error !== null && <Critical>{error}</Critical>}

      {members.length === 0 ? (
        <Empty title={copy.noTeam} />
      ) : (
        members.map((member) => (
          <Card
            key={member.membershipId}
            style={{ display: "flex", alignItems: "center", gap: 10 }}
          >
              <span style={{ flex: 1, display: "flex", flexDirection: "column", gap: 4 }}>
                <span style={{ fontWeight: 500 }}>
                  {member.name}
                  {member.id === user?.id && (
                    <span className="hint" style={{ marginInlineStart: 6 }}>
                      {copy.you}
                    </span>
                  )}
                  {member.pending && (
                    <span className="hint" style={{ marginInlineStart: 6 }}>
                      {copy.pendingMember}
                    </span>
                  )}
                </span>
                <span className="hint">
                  {copy[`role${member.role === "CUSTOMER" ? "WORKER" : member.role}`]}
                  {member.role === "WORKER" && member.resourceIds.length > 0
                    ? ` · ${named(member.resourceIds)}`
                    : ""}
                </span>
              </span>
              <span className="hint tab" dir="ltr" style={{ minWidth: "max-content" }}>
                {member.phone}
              </span>
              {mayTouch(member) && member.id !== user?.id && (
                <button
                  className="chip"
                  style={{ border: "1px solid var(--line)", textAlign: "center" }}
                  onClick={() =>
                    setDraft({
                      member,
                      phone: "",
                      givenName: member.givenName,
                      familyName: member.familyName ?? "",
                      role: member.role === "CUSTOMER" ? "WORKER" : member.role,
                      resourceIds: [...member.resourceIds],
                      locked: false,
                    })
                  }
                >
                  {copy.editMember}
                </button>
              )}
              {mayTouch(member) && member.id !== user?.id && (
                <button
                  onClick={() => setRemoving(member)}
                  style={{ color: "var(--critical)", fontSize: 13, minHeight: 40 }}
                >
                  {copy.removeMember}
                </button>
              )}
            </Card>
          ))
      )}

      <Button intent="quiet" onClick={() => setDraft(EMPTY)}>
        {copy.invite}
      </Button>

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
                    onChange={(phone) => setDraft({ ...draft, phone, locked: false })}
                    onBlur={() => {
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
                  problem={problem.text(draft.givenName, TEXT_RULES.personName)}
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
