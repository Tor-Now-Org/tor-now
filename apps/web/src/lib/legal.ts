/**
 * The legal documents. Their text lives in `docs/legal/` as Markdown, one
 * file per document and language, and is read at build time — every route that
 * shows them is static, so nothing touches the filesystem in production.
 */
export const LEGAL_DOCS = ["terms", "privacy", "accessibility"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];

export const LEGAL_FILES: Readonly<Record<LegalDoc, string>> = {
  terms: "terms-of-service",
  privacy: "privacy-policy",
  accessibility: "accessibility-statement",
};

export const isLegalDoc = (value: string): value is LegalDoc =>
  (LEGAL_DOCS as readonly string[]).includes(value);

export const legalPath = (doc: LegalDoc) => `/legal/${doc}`;

/** Where the sheet fetches every document from, once, when first opened. */
export const LEGAL_CONTENT_PATH = "/legal-content";

export type LegalHtml = { readonly he: string; readonly en: string };

const escape = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

// Links only to our own pages or https, so a "[date]" placeholder stays text.
const inline = (text: string) =>
  escape(text.trim())
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\(((?:\/|https:\/\/)[^)\s"]*)\)/g, '<a href="$2">$1</a>');

const cells = (row: string) => row.trim().replace(/^\||\|$/g, "").split("|").map(inline);

/**
 * Just the Markdown these documents use: headings, paragraphs (a single line
 * break kept as one), bullet lists, pipe tables, bold and links.
 * ponytail: a hand-rolled subset, not a Markdown library — swap in one if the
 * documents start needing numbered lists or nesting.
 */
export const markdownToHtml = (markdown: string): string => {
  const out: string[] = [];
  let paragraph: string[] = [];
  let list: string[] = [];
  let table: string[][] = [];

  const flush = () => {
    if (paragraph.length > 0) out.push(`<p>${paragraph.join("<br>")}</p>`);
    if (list.length > 0) out.push(`<ul>${list.map((item) => `<li>${item}</li>`).join("")}</ul>`);
    if (table.length > 0) {
      const [head = [], ...body] = table;
      out.push(
        `<table><thead><tr>${head.map((cell) => `<th>${cell}</th>`).join("")}</tr></thead>` +
          `<tbody>${body.map((row) => `<tr>${row.map((cell) => `<td>${cell}</td>`).join("")}</tr>`).join("")}</tbody></table>`,
      );
    }
    paragraph = [];
    list = [];
    table = [];
  };

  for (const line of markdown.split("\n")) {
    const heading = /^(#{1,3}) (.*)$/.exec(line);
    const item = /^\s*- (.*)$/.exec(line);
    if (line.trim() === "") {
      flush();
    } else if (heading !== null) {
      flush();
      const level = (heading[1] ?? "#").length;
      out.push(`<h${level}>${inline(heading[2] ?? "")}</h${level}>`);
    } else if (item !== null) {
      if (list.length === 0) flush();
      list.push(inline(item[1] ?? ""));
    } else if (line.trimStart().startsWith("|")) {
      if (table.length === 0) flush();
      // The row of dashes under the header carries no content.
      if (!/^\s*\|[\s|:-]+\|\s*$/.test(line)) table.push(cells(line));
    } else {
      if (list.length > 0 || table.length > 0) flush();
      paragraph.push(inline(line));
    }
  }
  flush();
  return out.join("\n");
};
