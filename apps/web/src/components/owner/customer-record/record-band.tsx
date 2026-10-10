"use client";

import { fillText } from "@/lib/i18n/fill.ts";
import { useCopy } from "@/lib/i18n/index.tsx";
import { phoneShown } from "@/lib/phone.ts";
import { PhoneActions } from "../../phone-actions.tsx";

/**
 * Who this is and how to reach them: the customer's initial, name and number,
 * how long they have been a customer — or, louder, that they are blocked — and
 * the two ways to get hold of them, named.
 */
export const RecordBand = ({
  name,
  phone,
  since,
  blocked,
}: {
  name: string;
  phone: string;
  /** "ספטמבר 2026"; null before a first appointment, or without history. */
  since: string | null;
  blocked: boolean;
}) => {
  const words = useCopy("lists");
  return (
    <div className="record-band">
      <div className="record-who">
        <span className="record-initial" aria-hidden="true">
          {name.trim().charAt(0) || "?"}
        </span>
        <span className="record-name">
          <h1>{name}</h1>
          <span dir="ltr" className="record-phone">
            {phoneShown(phone)}
          </span>
        </span>
      </div>
      {blocked ? (
        <span className="record-blocked">{words.blockedBand}</span>
      ) : (
        since !== null && <span className="record-since">{fillText(words.customerSince, { month: since })}</span>
      )}
      <PhoneActions phone={phone} labels={{ call: words.call, whatsapp: words.whatsapp }} named tone="navy" />
    </div>
  );
};

/** The three numbers an owner reads a customer by; one that needs a look is coloured. */
export const RecordTiles = ({
  visits,
  noShows,
  lateCancels,
}: {
  visits: number;
  noShows: number;
  lateCancels: number;
}) => {
  const words = useCopy("lists");
  const tiles = [
    { key: "visits", value: visits, label: words.visits, warn: false },
    { key: "no-shows", value: noShows, label: words.noShows, warn: noShows > 0 },
    { key: "late", value: lateCancels, label: words.lateCancels, warn: lateCancels > 0 },
  ];
  return (
    <dl className="record-tiles" aria-label={words.counts}>
      {tiles.map((tile) => (
        <div key={tile.key} className={`record-tile${tile.warn ? " warn" : ""}`} data-tile={tile.key}>
          <dd>{tile.value}</dd>
          <dt>{tile.label}</dt>
        </div>
      ))}
    </dl>
  );
};
