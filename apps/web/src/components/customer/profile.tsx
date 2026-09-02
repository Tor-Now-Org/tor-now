"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { TEXT_RULES } from "@tor-now/domain";
import { useErrorText } from "@/lib/use-error-text.ts";
import {
  blocking,
  checkText,
  useFieldProblem,
} from "@/lib/use-field-problem.ts";
import { SignOutButton } from "../sign-out.tsx";
import { SupportLink } from "../support-link.tsx";
import { Button, Card, Critical, Field, Note, Sheet } from "../ui.tsx";

/**
 * The person's own details, which belong to them rather than to any business —
 * changing a name here changes it everywhere they have booked.
 */
export const Profile = ({ onSignedOut }: { onSignedOut: () => void }) => {
  const copy = useCopy("customer");
  const { token, user, signOut, refresh } = useSession();
  const errorText = useErrorText();

  const [givenName, setGivenName] = useState(user?.givenName ?? "");
  const [familyName, setFamilyName] = useState(user?.familyName ?? "");
  const [birthDate, setBirthDate] = useState(user?.birthDate ?? "");
  const [saved, setSaved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  const problem = useFieldProblem();
  const givenProblem = problem.text(givenName, TEXT_RULES.personName);
  const familyProblem = problem.text(familyName, TEXT_RULES.personName);

  if (token === null || user === null) return null;

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.updateProfile(token, {
        givenName: givenName.trim(),
        familyName: familyName.trim(),
        birthDate: birthDate.trim() === "" ? null : birthDate.trim(),
      });
      await refresh();
      setSaved(true);
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const deleteAccount = async () => {
    setBusy(true);
    try {
      await api.deleteAccount(token);
      signOut();
      onSignedOut();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ padding: "22px 18px 28px", display: "flex", flexDirection: "column", gap: 18 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <h1 style={{ fontSize: 22 }}>{copy.profile}</h1>
        <span className="hint">{copy.profileHint}</span>
      </div>

      <Card style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        {/* Said before the fields it is about, rather than after the phone
            number three fields further down. */}
        <Note>{copy.nameShared}</Note>
        <Field
          id="profile-given-name"
          label={copy.firstName}
          autoComplete="given-name"
          value={givenName}
          problem={givenProblem}
          onChange={(event) => { setGivenName(event.target.value); setSaved(false); }}
        />
        <Field
          id="profile-family-name"
          label={copy.lastName}
          autoComplete="family-name"
          value={familyName}
          problem={familyProblem}
          onChange={(event) => { setFamilyName(event.target.value); setSaved(false); }}
        />
        <Field
          id="profile-birth"
          label={copy.birthDate}
          type="date"
          value={birthDate}
          onChange={(event) => { setBirthDate(event.target.value); setSaved(false); }}
        />
        <Field id="profile-phone" label={copy.phoneLabel} value={user.phone} dir="ltr" readOnly disabled />
        <Note>{copy.phoneLocked}</Note>
        {error !== null && <Critical>{error}</Critical>}
        {saved && <p className="hint" style={{ margin: 0 }} role="status">{copy.profileSaved}</p>}
        <Button
          onClick={save}
          busy={busy}
          disabled={blocking(
            checkText(givenName, TEXT_RULES.personName),
            checkText(familyName, TEXT_RULES.personName),
          )}
        >
          {copy.saveDetails}
        </Button>
      </Card>

      <SignOutButton label={copy.signOut} onSignedOut={onSignedOut} />

      <SupportLink />

      <button
        onClick={() => setDeleting(true)}
        style={{ color: "var(--critical)", fontSize: 14, minHeight: 44 }}
      >
        {copy.deleteAccountLink}
      </button>

      <Sheet open={deleting} onClose={() => setDeleting(false)} labelledBy="delete-title">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <h2 id="delete-title" style={{ fontSize: 20 }}>{copy.deleteAccount}</h2>
          <p className="hint" style={{ margin: 0 }}>{copy.deleteBody}</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <span className="label">{copy.deleteWhat}</span>
            {/* ADR 0008 states these consequences plainly rather than leaving
                them to be discovered after the fact. */}
            <span className="hint">{copy.deleteP1}</span>
            <span className="hint">{copy.deleteP2}</span>
            <span className="hint">{copy.deleteP3}</span>
          </div>
          <Note>{copy.deleteLegal}</Note>
          <Button intent="danger" onClick={deleteAccount} busy={busy}>{copy.deleteAccount}</Button>
          <Button intent="quiet" onClick={() => setDeleting(false)}>{copy.keepIt}</Button>
        </div>
      </Sheet>
    </div>
  );
};
