"use client";

import { useState } from "react";
import { calculate } from "@tor-now/domain";
import type { CalculatorBasisDto, ReferenceBusinessDto } from "@/lib/api/cost-types.ts";
import { isApiError } from "@/lib/api/errors.ts";
import { calculatorInputs, formatCost } from "@/lib/costs.ts";
import { formatLocalDate } from "@/lib/format.ts";
import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Critical, Field, Note, Sheet } from "@/components/ui.tsx";

/**
 * The calculator's saved Businesses (ADR 0023): saving the numbers on screen
 * under a name, and renaming or deleting one — each confirmed where it is,
 * never in a pop-up. The two measured examples are never here to change.
 */

export const NAME_LENGTH = { min: 2, max: 30 } as const;
export const MAX_SAVED = 8;

/** The name as the server will judge it: trimmed, 2 to 30 characters, not another's. */
export const nameProblemOf = (
  name: string,
  saved: readonly ReferenceBusinessDto[],
  exceptId: string | null,
): "length" | "taken" | null => {
  const trimmed = name.trim();
  if (trimmed.length < NAME_LENGTH.min || trimmed.length > NAME_LENGTH.max) return "length";
  const taken = saved.some(
    (other) => other.id !== exceptId && other.name.trim().toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
  );
  return taken ? "taken" : null;
};

const useFailure = () => {
  const errorText = useErrorText();
  return (cause: unknown) => errorText(isApiError(cause) ? cause.code : "INTERNAL");
};

export const SaveNewSheet = ({
  open,
  saved,
  onSave,
  onClose,
}: {
  open: boolean;
  saved: readonly ReferenceBusinessDto[];
  onSave: (name: string) => Promise<void>;
  onClose: () => void;
}) => {
  const words = useCopy("costs");
  const failure = useFailure();
  const [name, setName] = useState("");
  const [touched, setTouched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const problem = nameProblemOf(name, saved, null);

  const save = async () => {
    setTouched(true);
    if (problem !== null) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(name.trim());
      setName("");
      setTouched(false);
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={onClose} labelledBy="save-new-title">
      <form
        style={{ display: "flex", flexDirection: "column", gap: 14 }}
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <h2 id="save-new-title" style={{ fontSize: 19 }}>
          {words.saveNew}
        </h2>
        <Note>{words.saveNewNote}</Note>
        <Field
          id="calc-new-name"
          label={words.name}
          placeholder={words.namePlaceholder}
          maxLength={NAME_LENGTH.max}
          autoComplete="off"
          value={name}
          problem={touched && problem !== null ? (problem === "taken" ? words.nameTaken : words.nameProblem) : null}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => setTouched(name !== "")}
        />
        {error !== null && <Critical>{error}</Critical>}
        <Button type="submit" busy={busy}>
          {words.save}
        </Button>
        <Button type="button" intent="quiet" onClick={onClose}>
          {words.cancel}
        </Button>
      </form>
    </Sheet>
  );
};

type Mode = { kind: "list" } | { kind: "rename"; id: string } | { kind: "delete"; id: string };

export const ManageSheet = ({
  open,
  basis,
  saved,
  onRename,
  onDelete,
  onClose,
}: {
  open: boolean;
  basis: CalculatorBasisDto;
  saved: readonly ReferenceBusinessDto[];
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onClose: () => void;
}) => {
  const words = useCopy("costs");
  const { language } = useLanguage();
  const failure = useFailure();
  const [mode, setMode] = useState<Mode>({ kind: "list" });
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputs = calculatorInputs(basis);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      setMode({ kind: "list" });
    } catch (cause) {
      setError(failure(cause));
    } finally {
      setBusy(false);
    }
  };

  const renameProblem = mode.kind === "rename" ? nameProblemOf(name, saved, mode.id) : null;

  return (
    <Sheet open={open} onClose={mode.kind === "list" ? onClose : () => setMode({ kind: "list" })} labelledBy="manage-title">
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <h2 id="manage-title" style={{ fontSize: 19 }}>
          {words.manageTitle}
        </h2>
        <Note>{words.manageNote}</Note>
        {saved.length === 0 ? (
          <p className="hint" style={{ margin: 0 }}>
            {words.noneSaved}
          </p>
        ) : (
          <div className="card manage-list">
            {saved.map((one) => {
              const cost = calculate({ use: one.use, ...inputs }).total;
              if (mode.kind === "rename" && mode.id === one.id) {
                return (
                  <form
                    key={one.id}
                    className="manage-row editing"
                    onSubmit={(event) => {
                      event.preventDefault();
                      if (renameProblem === null) void run(() => onRename(one.id, name.trim()));
                    }}
                  >
                    <Field
                      id="calc-rename"
                      label={words.name}
                      maxLength={NAME_LENGTH.max}
                      autoComplete="off"
                      value={name}
                      problem={renameProblem === null ? null : renameProblem === "taken" ? words.nameTaken : words.nameProblem}
                      onChange={(event) => setName(event.target.value)}
                    />
                    <div className="row-actions">
                      <Button type="submit" busy={busy} disabled={renameProblem !== null}>
                        {words.save}
                      </Button>
                      <button type="button" className="link" onClick={() => setMode({ kind: "list" })}>
                        {words.cancel}
                      </button>
                    </div>
                  </form>
                );
              }
              if (mode.kind === "delete" && mode.id === one.id) {
                return (
                  <div key={one.id} className="manage-row confirming" role="group" aria-label={words.delete}>
                    <span>{fillText(words.deleteConfirm, { name: one.name })}</span>
                    <div className="row-actions">
                      <Button intent="danger" busy={busy} onClick={() => void run(() => onDelete(one.id))}>
                        {words.delete}
                      </Button>
                      <button type="button" className="link" onClick={() => setMode({ kind: "list" })}>
                        {words.cancel}
                      </button>
                    </div>
                  </div>
                );
              }
              return (
                <div key={one.id} className="manage-row" data-saved={one.name}>
                  <span className="what">
                    <strong>{one.name}</strong>
                    <span className="hint">
                      {fillText(one.use.calendars === 1 ? words.savedRowOne : words.savedRow, {
                        cost: formatCost(cost, language),
                        n: String(one.use.calendars),
                        date: formatLocalDate(one.savedOn, language, { day: "numeric", month: "numeric" }),
                      })}
                    </span>
                  </span>
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      setName(one.name);
                      setMode({ kind: "rename", id: one.id });
                    }}
                  >
                    {words.rename}
                  </button>
                  <button type="button" className="link critical" onClick={() => setMode({ kind: "delete", id: one.id })}>
                    {words.delete}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {error !== null && <Critical>{error}</Critical>}
        <span className="hint">{fillText(words.savedCount, { n: String(saved.length) })}</span>
        <Button intent="quiet" onClick={onClose}>
          {words.close}
        </Button>
      </div>
    </Sheet>
  );
};
