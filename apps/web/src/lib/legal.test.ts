import { describe, expect, it } from "vitest";
import { markdownToHtml } from "./legal.ts";

describe("markdownToHtml", () => {
  it("renders the subset the legal documents use", () => {
    const html = markdownToHtml(
      [
        "# Terms",
        "",
        "**Last updated:** [date]",
        "",
        "6.4. The Business is responsible for:",
        "   - using it <only> for appointments;",
        "   - consent.",
        "",
        "| Provider | Where |",
        "| --- | --- |",
        "| Supabase | EU |",
        "",
        "Company Ltd.",
        "Address: here",
        "",
        "Write to us on the [support page](/support), not [here](javascript:alert).",
      ].join("\n"),
    );
    expect(html).toBe(
      [
        "<h1>Terms</h1>",
        "<p><strong>Last updated:</strong> [date]</p>",
        "<p>6.4. The Business is responsible for:</p>",
        "<ul><li>using it &lt;only&gt; for appointments;</li><li>consent.</li></ul>",
        "<table><thead><tr><th>Provider</th><th>Where</th></tr></thead><tbody><tr><td>Supabase</td><td>EU</td></tr></tbody></table>",
        "<p>Company Ltd.<br>Address: here</p>",
        '<p>Write to us on the <a href="/support">support page</a>, not [here](javascript:alert).</p>',
      ].join("\n"),
    );
  });
});
