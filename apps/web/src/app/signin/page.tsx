"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useCopy } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { AppHeader } from "@/components/app-header.tsx";
import { Logo } from "@/components/logo.tsx";
import { Button, Note } from "@/components/ui.tsx";
import { VerifyPanel } from "@/components/verify-panel.tsx";

/**
 * ADR 0004: exactly the same door for customers, owners and administrators —
 * a phone number and a code. There is no separate registration, and the two
 * notes below say so, because a sign-in screen that hides that fact invites
 * people to look for a sign-up link that does not exist.
 */
export default function SignInPage() {
  const copy = useCopy("signIn");
  const router = useRouter();
  const errorText = useErrorText();
  const { signIn, user } = useSession();
  const [done, setDone] = useState(false);

  return (
    <>
      <AppHeader languageLabel={copy.langSwitch} />

      <main className="scroll" style={{ flex: 1, minHeight: 0, padding: "32px 20px" }}>
        {done && user !== null ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 16, alignItems: "center", textAlign: "center", paddingTop: 40 }}>
            <Logo size={34} />
            <h1 style={{ fontSize: 24 }}>{copy.doneTitle}</h1>
            <p className="hint" style={{ margin: 0 }}>{copy.doneBody}</p>
            <Button onClick={() => router.push("/")}>{copy.enter}</Button>
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 10, alignItems: "center", textAlign: "center" }}>
              <Logo size={34} />
              <p style={{ margin: 0, color: "var(--muted)", fontSize: 14.5 }}>{copy.tagline}</p>
            </div>

            <VerifyPanel
              labels={{
                title: copy.title,
                body: copy.body,
                phoneLabel: copy.phoneLabel,
                sendCode: copy.sendCode,
                codeLabel: copy.codeTitle,
                verify: copy.enter,
                nameTitle: copy.nameTitle,
                nameBody: copy.nameBody,
                firstName: copy.firstName,
                firstPlaceholder: copy.firstPlaceholder,
              }}
              errorText={errorText}
              onVerified={(token, verified) => {
                signIn(token, verified);
                setDone(true);
              }}
            />

            <Note>{copy.noteSame}</Note>
            {/* ADR 0010: the allowlist is a second, independent condition. */}
            <Note>{copy.noteAllowlist}</Note>
          </div>
        )}
      </main>
    </>
  );
}
