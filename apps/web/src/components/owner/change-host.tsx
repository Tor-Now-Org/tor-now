"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import { api } from "@/lib/api/client.ts";
import { isApiError } from "@/lib/api/errors.ts";
import type { BusinessDto, ChangeDto, ResourceDto } from "@/lib/api/types.ts";
import { manages } from "@/lib/roles.ts";
import { useErrorText } from "@/lib/use-error-text.ts";
import { ChangeDetail, type OpenedChange } from "./change-detail.tsx";
import type { Door, Who } from "./change-model.ts";
import { ChangeSheet } from "./change-sheet.tsx";

/** What this person may change: an owner's or a manager's every calendar, a worker's own. */
export const whoOf = (business: BusinessDto, resources: readonly ResourceDto[]): Who => ({
  manages: manages(business),
  calendars: resources.filter((resource) => resource.active !== false).map((resource) => ({ id: resource.id, name: resource.name })),
});

/**
 * The sheet and the detail, hosted once per screen, so every door — the +, a
 * free stretch, the schedule, a band on the month, a change on the day — opens
 * the very same two and nothing has a flow of its own.
 */
export const useCalendarChanges = ({
  token,
  business,
  resources,
  onChanged,
}: {
  token: string;
  business: BusinessDto;
  resources: readonly ResourceDto[];
  onChanged: () => void;
}): {
  who: Who;
  openSheet: (door: Door) => void;
  openChange: (id: string, date: string | null) => void;
  showChange: (change: ChangeDto, date: string | null) => void;
  sheets: ReactNode;
} => {
  const errorText = useErrorText();
  const who = useMemo(() => whoOf(business, resources), [business, resources]);
  const [door, setDoor] = useState<Door | null>(null);
  const [opened, setOpened] = useState<OpenedChange | null>(null);

  const openChange = useCallback(
    (id: string, date: string | null) => {
      api
        .getChange(token, business.id, id)
        .then((change) => setOpened({ change, date }))
        .catch((cause: unknown) => setOpened({ error: errorText(isApiError(cause) ? cause.code : "INTERNAL") }));
    },
    [token, business.id, errorText],
  );

  const sheets = (
    <>
      <ChangeSheet
        door={door}
        token={token}
        business={business}
        who={who}
        onClose={() => setDoor(null)}
        onDone={() => {
          setDoor(null);
          onChanged();
        }}
      />
      <ChangeDetail
        opened={opened}
        token={token}
        business={business}
        who={who}
        onClose={() => setOpened(null)}
        onEdit={(change) => {
          setOpened(null);
          setDoor({ kind: "edit", change });
        }}
        onChanged={() => {
          setOpened(null);
          onChanged();
        }}
      />
    </>
  );

  return {
    who,
    openSheet: setDoor,
    openChange,
    showChange: (change, date) => setOpened({ change, date }),
    sheets,
  };
};
