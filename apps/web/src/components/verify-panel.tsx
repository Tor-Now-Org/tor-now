"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { UserDto } from "@/lib/api/types.ts";
import { Button, Critical, Field, Note } from "./ui.tsx";

/**
 * ADR 0004: phone plus a code, and nothing else. Registering and signing in are
 * the same flow — an unrecognised number becomes a new User, a recognised one
 * is signed in — which is why this panel appears inline inside the booking flow
 * rather than redirecting anywhere.
 *
 * Being one flow is exactly what makes the name awkward. A returning customer
 * has a name already and must not be asked for it again, but "is this number
 * already someone" cannot be asked before the code is checked without turning
 * the endpoint into an oracle: anyone could type a number and learn from the
 * answer whether that person has an account here, and each guess would send
 * them a message. So the code is checked first, and the name is asked
 * afterwards and only of someone the API says is new.
 *
 * The cost of that order is one extra request for a genuinely new customer, and
 * a moment where their account exists under the API's own placeholder. That is
 * the same state as someone who declines to give a name at all, which the
 * system already allows and the profile screen already fixes.
 */
export type VerifyLabels = {
  title: string;
  body: string;
  phoneLabel: string;
  sendCode: string;
  codeLabel: string;
  verify: string;
  notHeld?: string;
  nameTitle: string;
  nameBody: string;
  firstName: string;
  lastName: string;
  saveName: string;
};

/** The API returns the code only on a deployment with no delivery channel. */
const developmentCodeNotice = (code: string) =>
  `No delivery channel is configured on this deployment, so the code is returned here: ${code}`;

export const VerifyPanel = ({
  labels,
  onVerified,
  errorText,
}: {
  labels: VerifyLabels;
  onVerified: (token: string, user: UserDto) => void;
  errorText: (code: string) => string;
}) => {
  const [phone, setPhone] = useState("+972");
  const [code, setCode] = useState("");
  const [givenName, setGivenName] = useState("");
  const [familyName, setFamilyName] = useState("");
  const [stage, setStage] = useState<"phone" | "code" | "name">("phone");
  /** Held between verifying and naming; the session is real from here on. */
  const [session, setSession] = useState<{ token: string; user: UserDto } | null>(null);
  const [devCode, setDevCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fail = (cause: unknown) =>
    setError(isApiError(cause) ? errorText(cause.code) : errorText("INTERNAL"));

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const result = await api.requestCode(phone.trim());
      setDevCode(result.code ?? null);
      setStage("code");
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  const verify = async () => {
    setBusy(true);
    setError(null);
    try {
      // No name here: nobody has been asked for one yet, and a returning
      // customer never will be.
      const verified = await api.verifyCode(phone.trim(), code.trim(), null);
      if (!verified.isNewUser) {
        onVerified(verified.token, verified.user);
        return;
      }
      setSession({ token: verified.token, user: verified.user });
      setStage("name");
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  /**
   * The name is the last step rather than a gate: someone who leaves it empty
   * is signed in regardless, under the placeholder the API gives them, and the
   * profile screen is where they change their mind.
   */
  const saveName = async () => {
    if (session === null) return;
    if (givenName.trim() === "") {
      onVerified(session.token, session.user);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const named = await api.updateProfile(session.token, {
        givenName: givenName.trim(),
        familyName: familyName.trim() === "" ? null : familyName.trim(),
      });
      onVerified(session.token, named);
    } catch (cause) {
      fail(cause);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <h2 style={{ fontSize: 20 }}>
          {stage === "name" ? labels.nameTitle : labels.title}
        </h2>
        <p className="hint" style={{ margin: 0 }}>
          {stage === "name" ? labels.nameBody : labels.body}
        </p>
      </div>

      {stage === "phone" ? (
        <>
          <Field
            id="verify-phone"
            label={labels.phoneLabel}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
          />
          {labels.notHeld !== undefined && <Note>{labels.notHeld}</Note>}
          {error !== null && <Critical>{error}</Critical>}
          <Button onClick={send} busy={busy} disabled={phone.trim().length < 10}>
            {labels.sendCode}
          </Button>
        </>
      ) : stage === "code" ? (
        <>
          <Field
            id="verify-code"
            label={labels.codeLabel}
            inputMode="numeric"
            autoComplete="one-time-code"
            dir="ltr"
            value={code}
            onChange={(event) => setCode(event.target.value)}
          />
          {devCode !== null && <Note>{developmentCodeNotice(devCode)}</Note>}
          {error !== null && <Critical>{error}</Critical>}
          <Button onClick={verify} busy={busy} disabled={code.trim().length < 4}>
            {labels.verify}
          </Button>
        </>
      ) : (
        <>
          <Field
            id="verify-given-name"
            label={labels.firstName}
            autoComplete="given-name"
            value={givenName}
            onChange={(event) => setGivenName(event.target.value)}
          />
          {/* Optional: a customer who gives only a first name is still a
              customer, and the business has something to call them. */}
          <Field
            id="verify-family-name"
            label={labels.lastName}
            autoComplete="family-name"
            value={familyName}
            onChange={(event) => setFamilyName(event.target.value)}
          />
          {error !== null && <Critical>{error}</Critical>}
          <Button onClick={saveName} busy={busy}>
            {labels.saveName}
          </Button>
        </>
      )}
    </div>
  );
};
