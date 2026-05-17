export interface ParsedSearchQueryFilters {
  folder?: string;
  fromIncludes?: string;
  fromDomainIncludes?: string;
  subjectIncludes?: string;
  snippetIncludes?: string;
  hasFlag?: string;
  dateAfter?: string;
  dateBefore?: string;
}

export interface SearchQueryWarning {
  code: "unsupported_operator" | "invalid_date";
  operator: string;
  token: string;
}

export interface ParsedSearchQuery {
  filters: ParsedSearchQueryFilters;
  remainder: string;
  warnings: SearchQueryWarning[];
}

const SUPPORTED_OPERATORS = new Set(["from", "subject", "snippet", "after", "before", "in"]);

export function parseSearchQuery(query: string): ParsedSearchQuery {
  const filters: ParsedSearchQueryFilters = {};
  const warnings: SearchQueryWarning[] = [];
  const remainder: string[] = [];

  for (const token of tokenizeQuery(query)) {
    const match = /^([a-zA-Z][a-zA-Z_-]*):(.*)$/.exec(token);
    if (!match) {
      remainder.push(token);
      continue;
    }

    const operator = match[1]?.toLowerCase() ?? "";
    const rawValue = unwrapValue(match[2] ?? "");
    if (!SUPPORTED_OPERATORS.has(operator)) {
      warnings.push({ code: "unsupported_operator", operator, token });
      continue;
    }

    if (operator === "from") {
      if (rawValue.includes("@")) {
        filters.fromIncludes = rawValue;
      } else {
        filters.fromDomainIncludes = rawValue;
      }
      continue;
    }
    if (operator === "subject") {
      filters.subjectIncludes = rawValue;
      continue;
    }
    if (operator === "snippet") {
      filters.snippetIncludes = rawValue;
      continue;
    }
    if (operator === "in") {
      filters.folder = rawValue;
      continue;
    }

    const normalizedDate = normalizeQueryDate(rawValue);
    if (!normalizedDate) {
      warnings.push({ code: "invalid_date", operator, token });
      continue;
    }
    if (operator === "after") {
      filters.dateAfter = normalizedDate;
    } else {
      filters.dateBefore = normalizedDate;
    }
  }

  return {
    filters,
    remainder: remainder.join(" "),
    warnings,
  };
}

function tokenizeQuery(query: string): string[] {
  return query.match(/\S+:\([^)]*\)|\S+/g) ?? [];
}

function unwrapValue(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function normalizeQueryDate(value: string): string | undefined {
  const match = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(value.trim());
  if (!match) return undefined;
  const year = match[1];
  const month = match[2]?.padStart(2, "0");
  const day = match[3]?.padStart(2, "0");
  return `${year}-${month}-${day}`;
}
