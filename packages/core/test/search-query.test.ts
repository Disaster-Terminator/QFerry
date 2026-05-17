import { describe, expect, it } from "vitest";
import { parseSearchQuery } from "../src/search-query.js";

describe("search query parser", () => {
  it("parses basic Gmail-like operators into structured filters", () => {
    expect(parseSearchQuery("from:alpha.example subject:(invoice) snippet:paid after:2025/01/01 before:2026/01/01 in:INBOX")).toEqual({
      filters: {
        fromDomainIncludes: "alpha.example",
        subjectIncludes: "invoice",
        snippetIncludes: "paid",
        dateAfter: "2025-01-01",
        dateBefore: "2026-01-01",
        folder: "INBOX",
      },
      remainder: "",
      warnings: [],
    });
  });

  it("keeps plain text as query remainder and reports unsupported operators", () => {
    expect(parseSearchQuery("invoice label:work from:alpha@example.com")).toEqual({
      filters: {
        fromIncludes: "alpha@example.com",
      },
      remainder: "invoice",
      warnings: [
        {
          code: "unsupported_operator",
          operator: "label",
          token: "label:work",
        },
      ],
    });
  });
});
