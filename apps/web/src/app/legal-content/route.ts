import { LEGAL_DOCS } from "@/lib/legal.ts";
import { readLegal } from "@/lib/legal-content.ts";

// Every document, both languages, for the sheet the consent lines open — so
// reading the terms mid-booking does not navigate away from the slot.
export const dynamic = "force-static";

export const GET = () =>
  Response.json(Object.fromEntries(LEGAL_DOCS.map((doc) => [doc, readLegal(doc)])));
