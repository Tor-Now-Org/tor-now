"use client";

import { useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, ChangeDto } from "@/lib/api/types.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Critical, Note, Sheet } from "../ui.tsx";
import { markOf, mayChange, sentenceOf, type Who } from "./change-model.ts";
import { ChangeSentence } from "./change-sheet.tsx";

export type OpenedChange =
  | { readonly change: ChangeDto; readonly date: string | null }
  | { readonly error: string };

/**
 * A change already on the calendar, said in full — the same words the sheet
 * showed before saving, hours included — with the way to edit it and the way
 * back out of it, whole or for the one day it was opened from. A worker reads
 * the business's changes and changes only their own calendars'.
 */
export const ChangeDetail = ({
  opened,
  token,
  business,
  who,
  onClose,
  onEdit,
  onChanged,
}: {
  opened: OpenedChange | null;
  token: string;
  business: BusinessDto;
  who: Who;
  onClose: () => void;
  onEdit: (change: ChangeDto) => void;
  onChanged: () => void;
}) => {
  const copy = useCopy("change");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remove = async (change: ChangeDto, date: string | null) => {
    setBusy(true);
    setError(null);
    try {
      await api.removeChange(token, business.id, change.id, date);
      onChanged();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const close = () => {
    setError(null);
    onClose();
  };

  if (opened !== null && "error" in opened) {
    return (
      <Sheet open onClose={close}>
        <Critical>{opened.error}</Critical>
      </Sheet>
    );
  }

  const change = opened?.change ?? null;
  const names = Object.fromEntries(who.calendars.map((one) => [one.id, one.name]));
  const sentence =
    change === null
      ? null
      : sentenceOf({ ...change, usual: [], calendars: who.calendars.length }, copy, language, names);
  const days = change?.days.length ?? 0;
  const focus = opened !== null && "change" in opened ? opened.date : null;
  const oneOf = change !== null && days > 1 && focus !== null && change.days.some((day) => day.date === focus);
  const scopeName =
    change === null
      ? ""
      : change.scope.kind === "BUSINESS"
        ? copy.wholeBusiness
        : (names[change.scope.resourceId] ?? "");

  return (
    <Sheet open={change !== null} onClose={close} labelledBy="change-detail-title">
      {change !== null && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <h2 id="change-detail-title" style={{ fontSize: 18 }}>
            {change.note ?? copy[`mark${markOf(change)}`]}
          </h2>
          <p style={{ margin: 0, display: "flex", gap: 6, flexWrap: "wrap" }}>
            <span className={change.scope.kind === "BUSINESS" ? "change-scope business" : "change-scope"}>{scopeName}</span>
            <span className="change-scope">{copy[`mark${markOf(change)}`]}</span>
          </p>
          {sentence !== null && <ChangeSentence sentence={sentence} />}
          {error !== null && <Critical>{error}</Critical>}
          {mayChange(change, who) ? (
            <>
              <Button intent="quiet" disabled={busy} onClick={() => onEdit(change)}>
                {copy.edit}
              </Button>
              <Button intent="danger" busy={busy} onClick={() => void remove(change, null)}>
                {days > 1 ? fillText(copy.removeAllDays, { days: String(days) }) : copy.removeTheDay}
              </Button>
              {oneOf && focus !== null && (
                <Button intent="danger" busy={busy} onClick={() => void remove(change, focus)}>
                  {fillText(copy.removeOnly, { date: formatLocalDate(focus, language) })}
                </Button>
              )}
            </>
          ) : (
            <Note>{copy.readOnly}</Note>
          )}
        </div>
      )}
    </Sheet>
  );
};
