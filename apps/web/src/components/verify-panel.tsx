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
  firstPlaceholder: string;
  lastName: string;
  lastPlaceholder: string;
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
  const [stage, setStage] = useState<"phone" | "code">("phone");
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
      const session = await api.verifyCode(
        phone.trim(),
        code.trim(),
        givenName.trim() === ""
          ? null
          : {
              givenName: givenName.trim(),
              familyName: familyName.trim() === "" ? null : familyName.trim(),
            },
      );
      onVerified(session.token, session.user);
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
          {stage === "phone" ? labels.title : labels.nameTitle}
        </h2>
        <p className="hint" style={{ margin: 0 }}>
          {stage === "phone" ? labels.body : labels.nameBody}
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
      ) : (
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
          <Field
            id="verify-given-name"
            label={labels.firstName}
            placeholder={labels.firstPlaceholder}
            autoComplete="given-name"
            value={givenName}
            onChange={(event) => setGivenName(event.target.value)}
          />
          {/* Optional: a customer who gives only a first name is still a
              customer, and the business has something to call them. */}
          <Field
            id="verify-family-name"
            label={labels.lastName}
            placeholder={labels.lastPlaceholder}
            autoComplete="family-name"
            value={familyName}
            onChange={(event) => setFamilyName(event.target.value)}
          />
          {devCode !== null && <Note>{developmentCodeNotice(devCode)}</Note>}
          {error !== null && <Critical>{error}</Critical>}
          <Button onClick={verify} busy={busy} disabled={code.trim().length < 4}>
            {labels.verify}
          </Button>
        </>
      )}
    </div>
  );
};
