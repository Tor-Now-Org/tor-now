"use client";

import { useState } from "react";
import { useCopy } from "@/lib/i18n/index.tsx";
import { Button, Field } from "../ui.tsx";

/**
 * Changing what something on the calendar is called.
 *
 * The words are the one part of a blockage or a closure that somebody can get
 * wrong and want back. The days and the hours can be undone by removing the
 * thing and saying it again; a typo in "מילואים" could only be lived with.
 *
 * Folded away until it is asked for, because most of the time the sheet is
 * opened to read the thing or to remove it, and a text field sitting open
 * invites neither.
 */
export const RenameNote = ({
  note,
  busy,
  onSave,
}: {
  note: string | null;
  busy: boolean;
  onSave: (note: string) => void;
}) => {
  const copy = useCopy("owner");
  const [editing, setEditing] = useState(false);
  const [said, setSaid] = useState(note ?? "");

  // A different thing was opened: its own words, not the last one's.
  const [about, setAbout] = useState(note);
  if (about !== note) {
    setAbout(note);
    setSaid(note ?? "");
    setEditing(false);
  }

  if (!editing) {
    return (
      <Button intent="quiet" onClick={() => setEditing(true)}>
        {(note ?? "").trim() === "" ? copy.addNote : copy.changeNote}
      </Button>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Field
        id="rename-note"
        label={copy.noteOptional}
        value={said}
        onChange={(event) => setSaid(event.target.value)}
        placeholder={copy.notePlaceholder}
      />
      <Button busy={busy} onClick={() => onSave(said)}>
        {copy.save}
      </Button>
      <Button
        intent="quiet"
        disabled={busy}
        onClick={() => {
          setSaid(note ?? "");
          setEditing(false);
        }}
      >
        {copy.cancelSelection}
      </Button>
    </div>
  );
};
