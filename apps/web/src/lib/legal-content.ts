import { readFileSync } from "node:fs";
import path from "node:path";
import { LEGAL_FILES, markdownToHtml, type LegalDoc, type LegalHtml } from "./legal.ts";

// `next build` runs from apps/web, and only static routes call this, so the
// read happens once at build and never in production.
const DIRECTORY = path.join(process.cwd(), "..", "..", "docs", "legal");

const read = (doc: LegalDoc, language: keyof LegalHtml) =>
  markdownToHtml(readFileSync(path.join(DIRECTORY, `${LEGAL_FILES[doc]}.${language}.md`), "utf8"));

export const readLegal = (doc: LegalDoc): LegalHtml => ({ he: read(doc, "he"), en: read(doc, "en") });
