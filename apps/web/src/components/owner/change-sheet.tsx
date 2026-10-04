"use client";

import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, ChangeOutcome, ChangePreviewDto, ChangeScopeDto } from "@/lib/api/types.ts";
import { formatLocalDate, todayIn } from "@/lib/format.ts";
import { fillParts, fillText } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { Button, Chip, Critical, Field, Sheet } from "../ui.tsx";
import { ChangeHours } from "./change-hours.tsx";
import {
  calendarPhrase,
  draftFor,
  problemsOf,
  rowOf,
  saveLabel,
  scopeOptions,
  sentenceOf,
  withOutcome,
  withUsual,
  noChangeOf,
  type Door,
  type Draft,
  type Sentence,
  type Who,
} from "./change-model.ts";
import { StrandedList } from "./stranded-list.tsx";
import { WithClocks } from "./clock-text.tsx";

const OUTCOMES: readonly ChangeOutcome[] = ["OFF_ALL_DAY", "OFF_PART", "OTHER_HOURS"];
/** Typing a time asks again after a pause rather than on every key. */
const PREVIEW_PAUSE_MS = 250;
/** Problems said under the hours; the missing answers are said by the button instead. */
const SAID = new Set(["END_BEFORE_START", "MISSING_HOURS", "NO_HOURS", "OVERLAP", "PAST_DAY", "DATES_REVERSED", "TOO_LONG"]);

/**
 * "שינוי ביומן": the one sheet every door opens. Whatever it was opened from, it
 * can change the days, choose for whom, and give any of the three outcomes —
 * from part of a day to closing the whole business. Permissions decide which
 * choices appear, never which sheet opens.
 */
export const ChangeSheet = (props: {
  door: Door | null;
  token: string;
  business: BusinessDto;
  who: Who;
  onClose: () => void;
  onDone: () => void;
}) => (
  <Sheet open={props.door !== null} onClose={props.onClose} labelledBy="change-title">
    {props.door !== null && <ChangeForm key={JSON.stringify(props.door)} {...props} door={props.door} />}
  </Sheet>
);

const sameScope = (left: ChangeScopeDto | null, right: ChangeScopeDto) =>
  left !== null &&
  left.kind === right.kind &&
  (left.kind === "BUSINESS" || (right.kind === "CALENDAR" && left.resourceId === right.resourceId));

const ChangeForm = ({
  door,
  token,
  business,
  who,
  onClose,
  onDone,
}: {
  door: Door;
  token: string;
  business: BusinessDto;
  who: Who;
  onClose: () => void;
  onDone: () => void;
}) => {
  const copy = useCopy("change");
  const { language } = useLanguage();
  const errorText = useErrorText();
  const today = todayIn(business.timeZone);
  const [draft, setDraft] = useState<Draft>(() => draftFor(door, who, today));
  /** The last answer, and the plan it answers — so nothing on screen is decided by an answer to an older plan. */
  const [answered, setAnswered] = useState<{ readonly asked: string; readonly preview: ChangePreviewDto } | null>(null);
  const preview = answered?.preview ?? null;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const names = useMemo(() => Object.fromEntries(who.calendars.map((one) => [one.id, one.name])), [who.calendars]);
  const options = scopeOptions(who);
  const problems = problemsOf(draft, today);
  const usual = preview?.usual ?? [];
  const datesProblem = problems.some((one) => one === "DATES_REVERSED" || one === "PAST_DAY" || one === "TOO_LONG");
  const hoursProblem = problems.some((one) => one === "END_BEFORE_START" || one === "MISSING_HOURS" || one === "NO_HOURS" || one === "OVERLAP");

  // What the plan would do, asked again whenever it changes. With the hours
  // still being typed it asks without an outcome, which still brings back the
  // usual day the hours start from.
  const asked = draft.scope === null || datesProblem
    ? null
    : JSON.stringify({
        scope: draft.scope,
        fromDate: draft.fromDate,
        toDate: draft.toDate,
        outcome: hoursProblem ? null : draft.outcome,
        ranges: hoursProblem || draft.outcome === null ? [] : draft.ranges,
        replacing: draft.replacing,
      });
  useEffect(() => {
    if (asked === null) {
      setAnswered(null);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      api
        .previewChange(token, business.id, JSON.parse(asked) as Parameters<typeof api.previewChange>[2])
        .then((answer) => {
          if (!current) return;
          setAnswered({ asked, preview: answer });
          setDraft((now) => withUsual(now, answer.usual));
        })
        .catch(() => {
          // A warning that could not be fetched must not read as "nobody is booked".
          if (current) setAnswered(null);
        });
    }, PREVIEW_PAUSE_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [asked, token, business.id]);

  // Only an answer to the plan on screen may say it changes nothing.
  const noChange = noChangeOf(draft, answered !== null && answered.asked === asked ? (preview ?? undefined) : undefined);
  const stranded = draft.outcome === null || hoursProblem ? 0 : (preview?.appointments.length ?? 0);
  const label = saveLabel(draft, stranded);
  const sentence = sentenceOf(
    // "Instead of" only of hours that were the usual ones on every day, for every calendar.
    { ...draft, ranges: draft.ranges, usual: preview?.usualEverywhere ?? [], calendars: who.calendars.length },
    copy,
    language,
    names,
  );
  const single = draft.fromDate === draft.toDate;
  const closing = draft.scope?.kind === "BUSINESS" && draft.outcome === "OFF_ALL_DAY";

  const save = async () => {
    if (draft.scope === null || draft.outcome === null) return;
    setBusy(true);
    setError(null);
    try {
      await api.applyChange(token, business.id, {
        scope: draft.scope,
        fromDate: draft.fromDate,
        toDate: draft.toDate,
        outcome: draft.outcome,
        ranges: draft.outcome === "OFF_ALL_DAY" ? [] : [...draft.ranges],
        note: draft.note.trim() === "" ? null : draft.note.trim(),
        upcoming: draft.upcoming,
        replacing: draft.replacing,
      });
      onDone();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
    } finally {
      setBusy(false);
    }
  };

  const daysSaid = single
    ? formatLocalDate(draft.fromDate, language, { weekday: "long", day: "numeric", month: "long" })
    : `${formatLocalDate(draft.fromDate, language, { day: "numeric", month: "long" })} – ${formatLocalDate(draft.toDate, language, { day: "numeric", month: "long" })}`;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap" }}>
        <h2 id="change-title" style={{ fontSize: 18, flex: 1 }}>
          {copy.title}
        </h2>
        {!draft.typing && (
          <button type="button" className="link-button" onClick={() => setDraft({ ...draft, typing: true })}>
            {copy.changeDays}
          </button>
        )}
      </div>
      {draft.typing ? (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
          <Field
            id="change-from"
            label={copy.fromDate}
            type="date"
            value={draft.fromDate}
            min={today}
            onChange={(event) =>
              setDraft({
                ...draft,
                fromDate: event.target.value,
                // The far end follows the near one: a range that ends before it starts is a slip.
                toDate: draft.toDate < event.target.value ? event.target.value : draft.toDate,
              })
            }
          />
          <Field
            id="change-to"
            label={copy.toDate}
            type="date"
            value={draft.toDate}
            min={draft.fromDate}
            onChange={(event) => setDraft({ ...draft, toDate: event.target.value })}
          />
        </div>
      ) : (
        <p className="hint" style={{ margin: 0 }}>{daysSaid}</p>
      )}

      {options.length > 1 ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span className="label" id="change-who">{copy.forWhom}</span>
          <div role="group" aria-labelledby="change-who" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {options.map((option) => {
              const scope: ChangeScopeDto = option.kind === "BUSINESS" ? option : { kind: "CALENDAR", resourceId: option.resourceId };
              const chosen = sameScope(draft.scope, scope);
              return (
                <Chip
                  key={option.kind === "BUSINESS" ? "business" : option.resourceId}
                  type="button"
                  selected={chosen}
                  className={option.kind === "BUSINESS" ? "chip change-business" : "chip"}
                  onClick={() => setDraft({ ...draft, scope })}
                >
                  {option.kind === "BUSINESS" ? copy.wholeBusiness : option.name}
                </Chip>
              );
            })}
          </div>
        </div>
      ) : (
        options[0]?.kind === "CALENDAR" && (
          <p className="change-fixed" style={{ margin: 0 }}>
            {calendarPhrase(options[0].name, copy)}
          </p>
        )
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
        <span className="label" id="change-what">{single ? copy.whatHappensDay : copy.whatHappensDays}</span>
        <div role="radiogroup" aria-labelledby="change-what" style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {OUTCOMES.map((outcome) => {
            const chosen = draft.outcome === outcome;
            return (
              <div key={outcome} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={chosen}
                  className={chosen ? "change-choice on" : "change-choice"}
                  onClick={() => setDraft(withOutcome(draft, outcome, usual))}
                >
                  <span className="change-dot" aria-hidden="true" />
                  <span style={{ display: "flex", flexDirection: "column", gap: 1, minWidth: 0 }}>
                    <b>{copy[outcome]}</b>
                    <small>
                      {outcome === "OFF_ALL_DAY" && draft.scope?.kind === "BUSINESS"
                        ? copy.OFF_ALL_DAY_business
                        : copy[`${outcome}_hint`]}
                    </small>
                  </span>
                </button>
                {chosen && outcome !== "OFF_ALL_DAY" && (
                  <ChangeHours
                    outcome={outcome}
                    ranges={draft.ranges}
                    usual={usual}
                    onChange={(ranges) => setDraft({ ...draft, ranges, touchedHours: true })}
                  />
                )}
              </div>
            );
          })}
        </div>
      </div>

      {problems.filter((one) => SAID.has(one)).slice(0, 1).map((one) => (
        <p key={one} className="warn" role="alert" style={{ margin: 0 }}>
          {copy[one === "NO_HOURS" ? "MISSING_HOURS" : (one as "END_BEFORE_START")]}
        </p>
      ))}

      {noChange !== null && (
        <p className="change-same" role="status" style={{ margin: 0 }}>
          {copy[noChange.key]}
          {noChange.backToUsual && ` ${copy.backToUsual}`}
        </p>
      )}

      {sentence !== null && noChange === null && !hoursProblem && !datesProblem && (
        <ChangeSentence sentence={sentence} />
      )}

      {preview !== null && preview.replaces.length > 0 && draft.outcome !== null && noChange === null && (
        <p className="change-replaces" role="note" style={{ margin: 0 }}>
          <WithClocks text={fillText(single ? copy.replacesDay : copy.replacesDays, {
            what: preview.replaces
              .map((one) => {
                const row = rowOf(one, copy, language);
                return row.note === null ? row.what : `${row.what} · ${row.note}`;
              })
              .join(" / "),
          })} />
        </p>
      )}

      {draft.outcome !== null && (
        <Field
          id="change-note"
          label={copy.noteLabel}
          value={draft.note}
          placeholder={copy[`${draft.outcome}_note`]}
          onChange={(event) => setDraft({ ...draft, note: event.target.value })}
        />
      )}

      {draft.outcome !== null && preview !== null && !hoursProblem && noChange === null && (
        <StrandedList
          appointments={preview.appointments}
          timeZone={business.timeZone}
          language={language}
          showCalendar={draft.scope?.kind === "BUSINESS"}
          when={draft.outcome === "OFF_PART" ? copy.whenHours : single ? copy.whenDay : copy.whenDays}
          upcoming={draft.upcoming}
          onUpcoming={(upcoming) => setDraft({ ...draft, upcoming })}
        />
      )}

      {error !== null && <Critical>{error}</Critical>}

      <Button
        intent={(label.key !== "save" && label.key !== "chooseWho" && label.key !== "chooseWhat") || closing ? "danger" : "primary"}
        busy={busy}
        disabled={problems.length > 0 || noChange !== null}
        onClick={() => void save()}
      >
        {"count" in label ? fillText(copy[label.key], { count: String(label.count) }) : copy[label.key]}
      </Button>
      <Button intent="quiet" disabled={busy} onClick={onClose}>
        {copy.dismiss}
      </Button>
    </div>
  );
};

/** The result in plain words, its facts — the days, whose, the hours — in bold. */
export const ChangeSentence = ({ sentence }: { sentence: Sentence }) => (
  <p className="change-sentence" aria-live="polite" style={{ margin: 0 }}>
    {fillParts(sentence.template, sentence.values).map((part, index) =>
      part.filled && sentence.filled.includes(part.text) ? (
        <b key={index}>
          <WithClocks text={part.text} />
        </b>
      ) : (
        <span key={index}>
          <WithClocks text={part.text} />
        </span>
      ),
    )}
  </p>
);
