"use client";

import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TERMS_VERSION } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useSession } from "@/lib/session.tsx";
import {
  LEGAL_CONTENT_PATH,
  LEGAL_DOCS,
  legalPath,
  type LegalDoc,
  type LegalHtml,
} from "@/lib/legal.ts";
import { AppHeader } from "./app-header.tsx";
import { Button, Card, Critical, Sheet, Spinner } from "./ui.tsx";

/** One document in the current language, drawn from the build's own HTML. */
const LegalArticle = ({ html }: { html: LegalHtml }) => {
  const { language, direction } = useLanguage();
  return (
    <article
      className="legal"
      lang={language}
      dir={direction}
      // Our own documents, rendered and escaped at build time.
      dangerouslySetInnerHTML={{ __html: html[language] }}
    />
  );
};

/** The page: the three documents behind one row of tabs. */
export const LegalView = ({ doc, html }: { doc: LegalDoc; html: LegalHtml }) => {
  const copy = useCopy("legal");
  const router = useRouter();
  return (
    <>
      <AppHeader title={copy.title} onBack={() => router.back()} backLabel={copy.back} showBackLabel={false} />
      <main
        className="scroll"
        style={{ flex: 1, minHeight: 0, padding: 18, display: "flex", flexDirection: "column", gap: 16 }}
      >
        <nav
          aria-label={copy.title}
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: 4,
            padding: 4,
            borderRadius: 14,
            background: "var(--sunken)",
          }}
        >
          {LEGAL_DOCS.map((option) => {
            const selected = option === doc;
            return (
              <Link
                key={option}
                href={legalPath(option)}
                replace
                aria-current={selected ? "page" : undefined}
                style={{
                  display: "grid",
                  placeItems: "center",
                  minHeight: 40,
                  padding: "0 6px",
                  borderRadius: 11,
                  fontSize: 13.5,
                  fontWeight: 600,
                  textAlign: "center",
                  color: selected ? "var(--ink)" : "var(--muted)",
                  background: selected ? "var(--raised)" : "transparent",
                  boxShadow: selected ? "var(--shadow)" : undefined,
                }}
              >
                {copy[option]}
              </Link>
            );
          })}
        </nav>
        <Card style={{ flexShrink: 0 }}>
          <LegalArticle html={html} />
        </Card>
      </main>
    </>
  );
};

/** Links to all three, for a footer. */
export const LegalLinks = ({ style }: { style?: CSSProperties }) => {
  const copy = useCopy("legal");
  return (
    <nav
      aria-label={copy.title}
      style={{ display: "flex", flexWrap: "wrap", justifyContent: "center", gap: "4px 14px", fontSize: 13, ...style }}
    >
      {LEGAL_DOCS.map((doc) => (
        <Link key={doc} href={legalPath(doc)}>
          {copy[doc]}
        </Link>
      ))}
    </nav>
  );
};

// Fetched once per visit, and only by someone who actually opens a document.
let content: Promise<Record<LegalDoc, LegalHtml>> | null = null;
const loadContent = () => {
  content ??= fetch(LEGAL_CONTENT_PATH).then((response) => {
    if (!response.ok) throw new Error(String(response.status));
    return response.json() as Promise<Record<LegalDoc, LegalHtml>>;
  });
  content.catch(() => {
    content = null;
  });
  return content;
};

const LegalSheet = ({ doc, onClose }: { doc: LegalDoc; onClose: () => void }) => {
  const copy = useCopy("legal");
  const [html, setHtml] = useState<LegalHtml | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    loadContent().then(
      (all) => live && setHtml(all[doc]),
      () => live && setFailed(true),
    );
    return () => {
      live = false;
    };
  }, [doc]);
  return (
    <Sheet open onClose={onClose} labelledBy="legal-sheet-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
          <h2 id="legal-sheet-title" style={{ fontSize: 19 }}>
            {copy[doc]}
          </h2>
          <button onClick={onClose} style={{ minHeight: 44, padding: "0 8px", fontWeight: 600, color: "var(--accent)" }}>
            {copy.close}
          </button>
        </div>
        {failed ? <Critical>{copy.failed}</Critical> : html === null ? <Spinner /> : <LegalArticle html={html} />}
        {/* A new tab, so whatever this sheet was opened over — a half-made
            booking, the wizard — is still there to come back to. */}
        <a href={legalPath(doc)} target="_blank" rel="noopener" style={{ textAlign: "center", padding: 8, fontSize: 13.5 }}>
          {copy.openFull}
        </a>
      </div>
    </Sheet>
  );
};

/**
 * A document opened over the current screen rather than instead of it. The
 * sheet is returned separately because the words that open it sit inside a
 * paragraph or a label, where a dialog's markup cannot.
 */
export const useLegalSheet = () => {
  const [open, setOpen] = useState<LegalDoc | null>(null);
  return {
    open: setOpen,
    sheet: open === null ? null : <LegalSheet doc={open} onClose={() => setOpen(null)} />,
  };
};

const InlineLink = ({ onClick, children }: { onClick: () => void; children: ReactNode }) => (
  <button
    type="button"
    onClick={onClick}
    style={{ display: "inline", font: "inherit", fontWeight: 600, color: "var(--accent)", textDecoration: "underline" }}
  >
    {children}
  </button>
);

/**
 * "By continuing you agree to the Terms and the Privacy Policy", with both
 * names opening their document. `agree` is the wording for a checkbox.
 */
export const ConsentText = ({
  variant,
  onOpen,
}: {
  variant: "continue" | "agree";
  onOpen: (doc: LegalDoc) => void;
}) => {
  const copy = useCopy("legal");
  const [lead, and, end] =
    variant === "continue"
      ? [copy.continueLead, copy.continueAnd, copy.continueEnd]
      : [copy.agreeLead, copy.agreeAnd, copy.agreeEnd];
  return (
    <>
      {lead}
      <InlineLink onClick={() => onOpen("terms")}>{copy.termsInline}</InlineLink>
      {and}
      <InlineLink onClick={() => onOpen("privacy")}>{copy.privacyInline}</InlineLink>
      {end}
    </>
  );
};

/**
 * Shown to anyone signed in on an older TERMS_VERSION than the one in force.
 * Acknowledging records the new version; dismissing hides it until the next
 * visit — the Terms already say continued use is agreement, so this is notice,
 * not a gate.
 */
export const TermsNotice = () => {
  const copy = useCopy("legal");
  const { token, user, signIn } = useSession();
  const legal = useLegalSheet();
  const [dismissed, setDismissed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  if (token === null || user === null || user.termsVersion === TERMS_VERSION || dismissed) return null;

  const accept = async () => {
    setBusy(true);
    setFailed(false);
    try {
      signIn(token, await api.acceptTerms(token));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Sheet open onClose={() => setDismissed(true)} labelledBy="terms-notice-title">
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <h2 id="terms-notice-title" style={{ fontSize: 20 }}>
              {copy.updateTitle}
            </h2>
            <p className="hint" style={{ margin: 0, fontSize: 14 }}>
              {copy.updateBody}
            </p>
          </div>
          <div style={{ display: "flex", justifyContent: "center", gap: 16, fontSize: 14 }}>
            <InlineLink onClick={() => legal.open("terms")}>{copy.terms}</InlineLink>
            <InlineLink onClick={() => legal.open("privacy")}>{copy.privacy}</InlineLink>
          </div>
          {failed && <Critical>{copy.acceptFailed}</Critical>}
          <Button onClick={() => void accept()} busy={busy}>
            {copy.understood}
          </Button>
        </div>
      </Sheet>
      {legal.sheet}
    </>
  );
};
