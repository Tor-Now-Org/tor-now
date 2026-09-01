"use client";

import { useState } from "react";
import { needsName, TEXT_RULES } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import {
  blocking,
  checkPhone,
  checkText,
  useFieldProblem,
} from "@/lib/use-field-problem.ts";
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
  /**
   * Nothing is marked wrong until it has been left, so the first character of a
   * phone number is not greeted with a complaint that it is not one yet.
   */
  const [touched, setTouched] = useState<ReadonlySet<string>>(new Set());
  const leave = (field: string) =>
    setTouched((previous) => new Set(previous).add(field));

  const problem = useFieldProblem();
  const phoneProblem = problem.phone(phone, touched.has("phone"));
  const givenProblem = problem.text(givenName, TEXT_RULES.personName, touched.has("given"));
  const familyProblem = problem.text(familyName, TEXT_RULES.personName, touched.has("family"));

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
      // Not `isNewUser`: someone who closed this sheet on the name step last
      // time is a returning user with no name, and would otherwise never be
      // asked again.
      if (!needsName(verified.user)) {
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
   * Both halves are required. The account exists by now — the code was checked
   * to get here — so this saves a name onto it rather than creating anything,
   * and until it succeeds the app is never handed the session.
   */
  const saveName = async () => {
    if (session === null) return;
    setBusy(true);
    setError(null);
    try {
      const named = await api.updateProfile(session.token, {
        givenName: givenName.trim(),
        // Required here, so it is never the null that means "not asked yet".
        familyName: familyName.trim(),
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
            problem={phoneProblem}
            onBlur={() => leave("phone")}
            onChange={(event) => setPhone(event.target.value)}
          />
          {labels.notHeld !== undefined && <Note>{labels.notHeld}</Note>}
          {error !== null && <Critical>{error}</Critical>}
          <Button
            onClick={send}
            busy={busy}
            disabled={checkPhone(phone) !== null}
          >
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
            problem={givenProblem}
            onBlur={() => leave("given")}
            onChange={(event) => setGivenName(event.target.value)}
          />
          {/* Both halves are required: a business looking at tomorrow's diary
              needs more than a first name to tell two customers apart. */}
          <Field
            id="verify-family-name"
            label={labels.lastName}
            autoComplete="family-name"
            value={familyName}
            problem={familyProblem}
            onBlur={() => leave("family")}
            onChange={(event) => setFamilyName(event.target.value)}
          />
          {error !== null && <Critical>{error}</Critical>}
          <Button
            onClick={saveName}
            busy={busy}
            disabled={blocking(
              checkText(givenName, TEXT_RULES.personName),
              checkText(familyName, TEXT_RULES.personName),
            )}
          >
            {labels.saveName}
          </Button>
        </>
      )}
    </div>
  );
};
