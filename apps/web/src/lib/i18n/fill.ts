/**
 * A sentence with its facts marked, rather than flattened into it.
 *
 * Copy in the dictionaries carries `{placeholders}`, and every screen filled
 * them with `.replace`, which produces a string — so the one thing the reader
 * actually needs from the sentence, the name and the time, reads exactly like
 * the words around it. "You already have a haircut with Shaked on Sunday at
 * 10:00" is a paragraph to skim; the same sentence with those three facts in
 * bold is a glance.
 *
 * So filling a template returns its pieces instead, and the component decides
 * how a filled piece looks. Pure and separate from React, because the rule —
 * where the seams fall — is what is worth testing.
 */

export type Part = {
  readonly text: string;
  /** True for a value that was substituted in, false for the surrounding copy. */
  readonly filled: boolean;
};

const PLACEHOLDER = /\{(\w+)\}/g;

export const fillParts = (
  template: string,
  values: Readonly<Record<string, string>>,
): Part[] => {
  const parts: Part[] = [];
  let cursor = 0;

  for (const match of template.matchAll(PLACEHOLDER)) {
    const at = match.index;
    const name = match[1] ?? "";
    // A placeholder nobody supplied is left as written: a sentence with a
    // visible {gap} is a bug report, where a silently empty one is a mystery.
    if (!(name in values)) continue;

    if (at > cursor) parts.push({ text: template.slice(cursor, at), filled: false });
    const value = values[name] ?? "";
    if (value !== "") parts.push({ text: value, filled: true });
    cursor = at + match[0].length;
  }

  if (cursor < template.length) {
    parts.push({ text: template.slice(cursor), filled: false });
  }
  return parts;
};
