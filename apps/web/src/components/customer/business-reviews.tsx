"use client";

import { useCallback, useEffect, useState } from "react";
import { REVIEW_STARS, TEXT_RULES } from "@tor-now/domain";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessReviewsDto, ReviewDto } from "@/lib/api/types.ts";
import { fillParts } from "@/lib/i18n/fill.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { useErrorText } from "@/lib/use-error-text.ts";
import { useSession } from "@/lib/session.tsx";
import { Button, Chip, Critical, MultilineField, Note } from "../ui.tsx";

const fill = (template: string, values: Record<string, string>): string =>
  fillParts(template, values)
    .map((part) => part.text)
    .join("");

const STARS = Array.from(
  { length: REVIEW_STARS.max - REVIEW_STARS.min + 1 },
  (_, at) => REVIEW_STARS.min + at,
);

const STAR = "var(--caution)";

/**
 * The reviews of one business and what the caller may do about them. One load
 * serves the header's rating, the prompt near the top and the list below.
 */
export const useBusinessReviews = (businessId: string) => {
  const { token } = useSession();
  const errorText = useErrorText();
  const [held, setHeld] = useState<BusinessReviewsDto | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .reviews(token, businessId)
      .then((loaded) => live && setHeld(loaded))
      .catch((cause) => live && setError(errorText(isApiError(cause) ? cause.code : "INTERNAL")));
    return () => {
      live = false;
    };
  }, [token, businessId, errorText]);

  const save = useCallback(
    async (review: { stars: number; comment: string; anonymous: boolean }) => {
      if (token === null) return;
      const mine = await api.writeReview(token, businessId, review);
      setHeld((current) =>
        current === null
          ? current
          : {
              ...current,
              mine,
              reviews: [mine, ...current.reviews.filter((each) => each.id !== mine.id)],
            },
      );
    },
    [token, businessId],
  );

  const average =
    held === null || held.reviews.length === 0
      ? null
      : held.reviews.reduce((sum, review) => sum + review.stars, 0) / held.reviews.length;

  return { held, error, save, average, signedIn: token !== null };
};

type Reviews = ReturnType<typeof useBusinessReviews>;

const StarRow = ({ count, size = 13 }: { count: number; size?: number }) => (
  <span aria-hidden="true" style={{ color: STAR, fontSize: size, letterSpacing: 1 }}>
    {"★".repeat(count)}
    <span style={{ color: "var(--line)" }}>{"★".repeat(REVIEW_STARS.max - count)}</span>
  </span>
);

type Draft = { stars: number; comment: string; anonymous: boolean };

/** Five stars to pick from, each its own radio so a screen reader counts them. */
const StarPicker = ({
  value,
  onPick,
  size,
}: {
  value: number;
  onPick: (stars: number) => void;
  size: number;
}) => {
  const copy = useCopy("customer");
  return (
    <div role="radiogroup" aria-label={copy.starsLabel} style={{ display: "flex", gap: 2 }}>
      {STARS.map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={fill(copy.starOf, { stars: String(star) })}
          onClick={() => onPick(star)}
          style={{
            width: 44,
            height: 44,
            padding: 0,
            fontSize: size,
            lineHeight: 1,
            background: "none",
            border: "none",
            color: star <= value ? STAR : "var(--line)",
          }}
        >
          ★
        </button>
      ))}
    </div>
  );
};

/**
 * Stars, words and whether to show a name — the one form, whether the review
 * is being written from the prompt or edited where it stands in the list.
 */
const ReviewForm = ({
  title,
  initial,
  editing,
  save,
  onSaved,
  onCancel,
  cancelLabel,
}: {
  title: string | null;
  initial: Draft;
  editing: boolean;
  save: Reviews["save"];
  onSaved: () => void;
  onCancel: () => void;
  cancelLabel: string;
}) => {
  const copy = useCopy("customer");
  const errorText = useErrorText();
  const [stars, setStars] = useState(initial.stars);
  const [comment, setComment] = useState(initial.comment);
  const [anonymous, setAnonymous] = useState(initial.anonymous);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      await save({ stars, comment: comment.trim(), anonymous });
      onSaved();
    } catch (cause) {
      setError(errorText(isApiError(cause) ? cause.code : "INTERNAL"));
      setBusy(false);
    }
  };

  return (
    <div
      className="card"
      style={{ display: "flex", flexDirection: "column", gap: 12, padding: 16, border: "1px solid var(--accent)" }}
    >
      {title !== null && <h2 style={{ fontSize: 17 }}>{title}</h2>}
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <StarPicker value={stars} onPick={setStars} size={26} />
        <span style={{ fontWeight: 600, color: "var(--muted)" }}>{copy.starWords[stars - 1]}</span>
      </div>
      <MultilineField
        id="review-comment"
        label={copy.reviewComment}
        hint={copy.reviewCommentHint}
        maxLength={TEXT_RULES.reviewComment.max}
        value={comment}
        onChange={(event) => setComment(event.target.value)}
      />
      <label
        htmlFor="review-anonymous"
        style={{ display: "flex", alignItems: "center", gap: 12, minHeight: 44, cursor: "pointer" }}
      >
        <input
          id="review-anonymous"
          type="checkbox"
          checked={anonymous}
          onChange={(event) => setAnonymous(event.target.checked)}
          style={{ width: 22, height: 22, margin: 0, accentColor: "var(--accent)" }}
        />
        <span style={{ fontWeight: 600, fontSize: 14.5 }}>{copy.showAnonymous}</span>
      </label>
      {error !== null && <Critical>{error}</Critical>}
      <Button onClick={() => void send()} busy={busy}>
        {editing ? copy.editReview : copy.writeReview}
      </Button>
      <Button intent="quiet" onClick={onCancel}>
        {cancelLabel}
      </Button>
    </div>
  );
};

/**
 * Asks a customer who may review how it was, right under the business's name.
 * A tap on a star opens the rest. Once written it is gone from here — the
 * review stands in the list below, and is edited there. Shown only once a
 * confirmed appointment here has ended.
 */
export const ReviewPrompt = ({
  businessName,
  reviews: { held, save, signedIn },
}: {
  businessName: string;
  reviews: Reviews;
}) => {
  const copy = useCopy("customer");
  const [picked, setPicked] = useState<number | null>(null);

  if (held === null || !held.mayReview || !signedIn || held.mine !== null) return null;
  const title = fill(copy.reviewAsk, { business: businessName });

  if (picked === null) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 16,
          borderRadius: 18,
          background: "var(--accent-soft)",
        }}
      >
        <h2 style={{ fontSize: 17 }}>{title}</h2>
        <StarPicker value={0} onPick={setPicked} size={30} />
      </div>
    );
  }

  return (
    <ReviewForm
      title={title}
      initial={{ stars: picked, comment: "", anonymous: false }}
      editing={false}
      save={save}
      onSaved={() => setPicked(null)}
      onCancel={() => setPicked(null)}
      cancelLabel={copy.notNow}
    />
  );
};

type Sort = "newest" | "highest" | "lowest" | "withText";

const SORTS: Record<Sort, (list: readonly ReviewDto[]) => ReviewDto[]> = {
  newest: (list) => [...list],
  highest: (list) => [...list].sort((a, b) => b.stars - a.stars),
  lowest: (list) => [...list].sort((a, b) => a.stars - b.stars),
  withText: (list) => list.filter((review) => review.comment !== ""),
};

const DAY = 86_400_000;

/** "3 days ago", in the reader's language. */
const ago = (iso: string, language: string): string => {
  const days = Math.round((new Date(iso).getTime() - Date.now()) / DAY);
  const format = new Intl.RelativeTimeFormat(language, { numeric: "auto" });
  if (days > -7) return format.format(days, "day");
  if (days > -30) return format.format(Math.round(days / 7), "week");
  if (days > -365) return format.format(Math.round(days / 30), "month");
  return format.format(Math.round(days / 365), "year");
};

/** The average, how the stars fall, and every review — sortable. */
export const ReviewSummary = ({ reviews: { held, error, average, save } }: { reviews: Reviews }) => {
  const copy = useCopy("customer");
  const { language } = useLanguage();
  const [sort, setSort] = useState<Sort>("newest");
  const [editing, setEditing] = useState(false);

  if (held === null) return error === null ? null : <Critical>{error}</Critical>;
  const { reviews, mine } = held;

  return (
    <section id="reviews" style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <h2 style={{ fontSize: 18 }}>{copy.reviewsTitle}</h2>

      {average === null ? (
        <span className="hint">{copy.noReviews}</span>
      ) : (
        <>
          <div className="card" style={{ display: "flex", gap: 18, alignItems: "center", padding: 18 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 2, minWidth: 90 }}>
              <span style={{ fontFamily: "Rubik, sans-serif", fontSize: 44, fontWeight: 600, lineHeight: 1 }}>
                {average.toFixed(1)}
              </span>
              <StarRow count={Math.round(average)} size={16} />
              <span className="hint" style={{ fontSize: 12 }}>
                {fill(copy.reviewsTotal, { count: String(reviews.length) })}
              </span>
            </div>
            <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 6 }}>
              {[...STARS].reverse().map((level) => {
                const count = reviews.filter((review) => review.stars === level).length;
                return (
                  <div
                    key={level}
                    style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)" }}
                  >
                    <span style={{ width: 22 }} aria-label={fill(copy.starOf, { stars: String(level) })}>
                      {level}★
                    </span>
                    <div style={{ flex: 1, height: 8, borderRadius: 999, background: "var(--sunken)", overflow: "hidden" }}>
                      <div
                        style={{
                          height: 8,
                          borderRadius: 999,
                          background: STAR,
                          width: `${(count / reviews.length) * 100}%`,
                        }}
                      />
                    </div>
                    <span className="tab" style={{ width: 14, textAlign: "end" }}>{count}</span>
                  </div>
                );
              })}
            </div>
          </div>

          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            {(
              [
                ["newest", copy.sortNewest],
                ["highest", copy.sortHighest],
                ["lowest", copy.sortLowest],
                ["withText", copy.sortWithText],
              ] as const
            ).map(([key, label]) => (
              <Chip key={key} selected={sort === key} onClick={() => setSort(key)}>
                {label}
              </Chip>
            ))}
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {SORTS[sort](reviews).map((review) => {
              const isMine = review.id === mine?.id;
              const name = review.authorName ?? copy.anonymousReview;
              if (isMine && editing) {
                return (
                  <ReviewForm
                    key={review.id}
                    title={null}
                    initial={{ stars: review.stars, comment: review.comment, anonymous: review.anonymous }}
                    editing
                    save={save}
                    onSaved={() => setEditing(false)}
                    onCancel={() => setEditing(false)}
                    cancelLabel={copy.cancelEdit}
                  />
                );
              }
              return (
                <div
                  key={review.id}
                  className="card"
                  style={{
                    display: "flex",
                    gap: 12,
                    padding: 14,
                    ...(isMine && { borderColor: "var(--accent)" }),
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      display: "grid",
                      placeItems: "center",
                      width: 36,
                      height: 36,
                      flexShrink: 0,
                      borderRadius: 999,
                      fontWeight: 600,
                      background: review.anonymous ? "var(--sunken)" : "var(--accent-soft)",
                      color: review.anonymous ? "var(--muted)" : "var(--accent-strong)",
                    }}
                  >
                    {review.authorName?.charAt(0) ?? "?"}
                  </div>
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: 3 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span
                        style={{
                          fontWeight: 600,
                          fontSize: 14,
                          color: review.anonymous ? "var(--muted)" : "var(--ink)",
                        }}
                      >
                        {name}
                      </span>
                      {isMine && (
                        <span
                          style={{
                            fontSize: 11,
                            fontWeight: 600,
                            padding: "2px 7px",
                            borderRadius: 999,
                            background: "var(--accent-soft)",
                            color: "var(--accent-strong)",
                          }}
                        >
                          {copy.yourReviewTag}
                        </span>
                      )}
                      <span className="hint" style={{ marginInlineStart: "auto", fontSize: 12 }}>
                        {ago(review.updatedAt, language)}
                      </span>
                      {isMine && (
                        <Chip onClick={() => setEditing(true)}>
                          {copy.editReviewShort}
                        </Chip>
                      )}
                    </div>
                    <span role="img" aria-label={fill(copy.starOf, { stars: String(review.stars) })}>
                      <StarRow count={review.stars} />
                    </span>
                    {review.comment !== "" && (
                      <p style={{ margin: "2px 0 0", fontSize: 14, lineHeight: 1.6, whiteSpace: "pre-line" }}>
                        {review.comment}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {!held.mayReview && <Note>{copy.reviewsOnlyCustomers}</Note>}
    </section>
  );
};
