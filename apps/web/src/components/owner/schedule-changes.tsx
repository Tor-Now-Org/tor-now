"use client";

import type { ChangeDto } from "@/lib/api/types.ts";
import { useCopy, useLanguage } from "@/lib/i18n/index.tsx";
import { Button, Empty } from "../ui.tsx";
import { rowOf } from "./change-model.ts";
import { WithClocks } from "./clock-text.tsx";
import { withMonths } from "./list-model.ts";
import { Chevron, ListDivider, ListTag } from "./list-ui.tsx";
import { CHANGE_MONTHS_FROM, changeMonth, dateBlockOf, isBusinessIn, type ChangeView } from "./schedule-model.ts";

/**
 * The changes one view lists, as dated rows in the one list design: the day
 * large at the start, what happens, the note and the days it runs, and in a
 * calendar's view the business's own changes marked as the business's.
 */
export const ScheduleChanges = ({
  changes,
  view,
  addLabel,
  showWorkerFoot,
  onOpen,
  onAdd,
}: {
  /** Already the view's, in date order. */
  changes: readonly ChangeDto[];
  view: ChangeView;
  /** Absent when this person may not add here: a worker under the whole business. */
  addLabel: string | null;
  showWorkerFoot: boolean;
  onOpen: (change: ChangeDto) => void;
  onAdd: () => void;
}) => {
  const words = useCopy("schedule");
  const changeWords = useCopy("change");
  const { language } = useLanguage();

  return (
    <>
      {changes.length === 0 ? (
        <Empty title={words.noChangesTitle} body={words.noChangesBody} />
      ) : (
        <ul className="list-card" aria-label={changeWords.listLabel}>
          {withMonths(changes, (change) => changeMonth(change, language), CHANGE_MONTHS_FROM).map((entry) =>
            entry.kind === "month" ? (
              <ListDivider key={`month-${entry.text}`} text={entry.text} />
            ) : (
              <ChangeItem key={entry.item.id} change={entry.item} view={view} onOpen={onOpen} />
            ),
          )}
        </ul>
      )}
      {addLabel !== null && <Button onClick={onAdd}>{addLabel}</Button>}
      {showWorkerFoot && <p className="list-foot">{words.workerFoot}</p>}
    </>
  );
};

const ChangeItem = ({ change, view, onOpen }: { change: ChangeDto; view: ChangeView; onOpen: (change: ChangeDto) => void }) => {
  const words = useCopy("schedule");
  const changeWords = useCopy("change");
  const { language } = useLanguage();
  const row = rowOf(change, changeWords, language);
  const block = dateBlockOf(change.fromDate, language);
  const business = isBusinessIn(change, view);
  const title = row.note === null ? row.what : `${row.what} · ${row.note}`;
  return (
    <li>
      <button type="button" className="list-row change-item" onClick={() => onOpen(change)}>
        <span className="date-block" aria-hidden="true">
          <b>{block.day}</b>
          <small>{block.month}</small>
        </span>
        <span className="list-text">
          <span className="list-title">
            <span>
              <WithClocks text={title} />
            </span>
          </span>
          <span className="list-line">
            <span className="tab">
              <WithClocks text={row.when} />
            </span>
          </span>
        </span>
        {business && (
          <span className="list-tags">
            <ListTag text={words.businessTag} />
          </span>
        )}
        <Chevron />
      </button>
    </li>
  );
};
