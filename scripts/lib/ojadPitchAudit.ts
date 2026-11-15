import { DOMParser } from "@xmldom/xmldom";

export const OJAD_PRINT_SEARCH_URL_PREFIX =
  "https://www.gavo.t.u-tokyo.ac.jp/ojad/search/index/display:print/sortprefix:accent/narabi1:kata_asc/narabi2:accent_asc/narabi3:mola_asc/yure:visible/curve:visible/details:visible/limit:20/word:";

export type OjadAuditStatus =
  | "matches"
  | "reading-mismatch"
  | "accent-mismatch"
  | "no-ojad-match"
  | "ojad-ambiguous"
  | "ojad-parse-uncertain"
  | "ojad-fetch-error";

export interface OjadAccentVariant {
  reading: string;
  accentNumber: number;
  moraTexts: string[];
  rawMoraClasses: string[];
}

export interface OjadWordEntry {
  headword: string;
  accentVariants: OjadAccentVariant[];
}

export interface OjadParseResult {
  entries: OjadWordEntry[];
  warnings: string[];
}

export interface OjadLookupResult extends OjadParseResult {
  lookupTerm: string;
  url: string;
  error: string | null;
}

export interface OjadComparisonInput {
  canonicalForm?: string | null;
  canonicalReading?: string | null;
  displayReading?: string | null;
  accentNumbers: number[];
}

export interface OjadComparisonEntrySummary {
  headword: string;
  readings: string[];
  accentNumbers: number[];
}

export interface OjadComparisonResult {
  status: OjadAuditStatus;
  lookupTerm: string;
  url: string;
  localAccents: number[];
  ojadEntries: OjadComparisonEntrySummary[];
  warnings: string[];
  error: string | null;
}

type FetchLike = typeof fetch;
type XmlNode = {
  nodeType?: number;
  nodeName?: string;
  childNodes?: ArrayLike<XmlNode>;
  data?: string;
  textContent?: string | null;
};

type XmlElement = XmlNode & {
  getAttribute?: (name: string) => string | null;
  tagName?: string;
};

const normalizeText = (value: string | null | undefined) => {
  const normalized = value?.normalize("NFKC").trim();
  return normalized ? normalized : null;
};

const normalizeKatakanaToHiragana = (value: string) =>
  Array.from(value)
    .map((char) => {
      const code = char.codePointAt(0);
      if (!code) return char;
      if (code >= 0x30a1 && code <= 0x30f6) {
        return String.fromCodePoint(code - 0x60);
      }
      return char;
    })
    .join("");

const normalizeKanaForComparison = (value: string | null | undefined) => {
  const normalized = normalizeText(value);
  if (!normalized) return null;
  return normalizeKatakanaToHiragana(normalized).replace(/\s+/gu, "");
};

const uniqueSortedNumbers = (values: number[]) => [...new Set(values)].sort((left, right) => left - right);

const classList = (node: XmlElement) =>
  (node.getAttribute?.("class") ?? "")
    .split(/\s+/u)
    .map((token) => token.trim())
    .filter(Boolean);

const hasClass = (node: XmlElement, expectedClass: string) => classList(node).includes(expectedClass);

const isElementNode = (node: XmlNode | null | undefined): node is XmlElement => node?.nodeType === 1;

const isTextNode = (node: XmlNode | null | undefined) => node?.nodeType === 3 || node?.nodeType === 4;

const walkElements = (node: XmlNode | null | undefined, visit: (element: XmlElement) => void) => {
  if (!node?.childNodes) return;

  for (const child of Array.from(node.childNodes)) {
    if (!child) continue;
    if (isElementNode(child)) {
      visit(child);
      walkElements(child, visit);
    } else {
      walkElements(child, visit);
    }
  }
};

const findDescendants = (node: XmlNode | null | undefined, predicate: (element: XmlElement) => boolean) => {
  const matches: XmlElement[] = [];
  walkElements(node, (element) => {
    if (predicate(element)) matches.push(element);
  });
  return matches;
};

const findFirstDescendant = (
  node: XmlNode | null | undefined,
  predicate: (element: XmlElement) => boolean,
) => findDescendants(node, predicate)[0] ?? null;

const getNodeText = (node: XmlNode | null | undefined): string => {
  if (!node) return "";
  if (isTextNode(node)) return node.data ?? "";
  if (typeof node.textContent === "string") return node.textContent;
  if (!node.childNodes) return "";
  return Array.from(node.childNodes).map((child) => getNodeText(child)).join("");
};

const getTrimmedNodeText = (node: XmlNode | null | undefined) =>
  getNodeText(node)
    .replace(/\s+/gu, " ")
    .trim();

const getMoraText = (moraNode: XmlElement) => {
  const charNodes = findDescendants(moraNode, (element) => hasClass(element, "char"));
  if (charNodes.length > 0) {
    return charNodes.map((node) => getTrimmedNodeText(node)).join("");
  }
  return getTrimmedNodeText(moraNode);
};

const parseAccentVariant = (procNode: XmlElement): OjadAccentVariant | null => {
  const accentNode = findFirstDescendant(procNode, (element) => hasClass(element, "katsuyo_accent"));
  if (!accentNode) return null;

  const moraNodes = findDescendants(accentNode, (element) =>
    classList(element).some((token) => token.startsWith("mola_")),
  );
  if (moraNodes.length === 0) return null;

  const moraTexts = moraNodes.map((node) => getMoraText(node));
  const reading = moraTexts.join("");
  if (!reading) return null;

  const accentTopIndex = moraNodes.findIndex((node) => hasClass(node, "accent_top"));

  return {
    reading,
    accentNumber: accentTopIndex === -1 ? 0 : accentTopIndex + 1,
    moraTexts,
    rawMoraClasses: moraNodes.map((node) => classList(node).join(" ")),
  };
};

const toEntrySummary = (entry: OjadWordEntry): OjadComparisonEntrySummary => ({
  headword: entry.headword,
  readings: [...new Set(entry.accentVariants.map((variant) => variant.reading))].sort(),
  accentNumbers: uniqueSortedNumbers(entry.accentVariants.map((variant) => variant.accentNumber)),
});

export const buildOjadSearchUrl = (term: string) => `${OJAD_PRINT_SEARCH_URL_PREFIX}${encodeURIComponent(term)}`;

export const getOjadLookupTerm = ({
  canonicalForm,
  canonicalReading,
  displayReading,
}: {
  canonicalForm?: string | null;
  canonicalReading?: string | null;
  displayReading?: string | null;
}) =>
  normalizeText(displayReading) ??
  normalizeText(canonicalReading) ??
  normalizeText(canonicalForm) ??
  null;

export const parseOjadSearchHtml = (html: string): OjadParseResult => {
  const parser = new DOMParser({
    errorHandler: () => undefined,
  });
  const document = parser.parseFromString(html, "text/html");
  const rows = findDescendants(document, (element) => {
    if ((element.tagName ?? "").toLowerCase() !== "tr") return false;
    const rowId = element.getAttribute?.("id") ?? "";
    return rowId.startsWith("word_");
  });

  const warnings: string[] = [];
  const entries: OjadWordEntry[] = [];

  for (const row of rows) {
    const headwordNode = findFirstDescendant(row, (element) => hasClass(element, "midashi_word"));
    const jishoCell = findFirstDescendant(row, (element) => hasClass(element, "katsuyo_jisho_js"));
    const headword = normalizeText(getTrimmedNodeText(headwordNode));

    if (!headword || !jishoCell) {
      const rowId = row.getAttribute?.("id") ?? "unknown";
      warnings.push(`row-missing-headword-or-jisho:${rowId}`);
      continue;
    }

    const accentVariants = findDescendants(jishoCell, (element) => hasClass(element, "katsuyo_proc"))
      .map((procNode) => parseAccentVariant(procNode))
      .filter((variant): variant is OjadAccentVariant => variant !== null)
      .filter((variant, index, allVariants) => {
        return (
          allVariants.findIndex(
            (candidate) =>
              candidate.reading === variant.reading &&
              candidate.accentNumber === variant.accentNumber,
          ) === index
        );
      });

    if (accentVariants.length === 0) {
      const rowId = row.getAttribute?.("id") ?? "unknown";
      warnings.push(`row-without-accent-variants:${rowId}`);
      continue;
    }

    entries.push({
      headword,
      accentVariants,
    });
  }

  if (rows.length === 0) {
    warnings.push("no-word-rows");
  }

  return {
    entries,
    warnings,
  };
};

export const fetchOjadSearch = async (
  term: string,
  fetchImpl: FetchLike = fetch,
): Promise<OjadLookupResult> => {
  const lookupTerm = normalizeText(term);
  const url = buildOjadSearchUrl(term);

  if (!lookupTerm) {
    return {
      lookupTerm: term,
      url,
      entries: [],
      warnings: ["empty-lookup-term"],
      error: "empty lookup term",
    };
  }

  try {
    const response = await fetchImpl(url);
    if (!response.ok) {
      return {
        lookupTerm,
        url,
        entries: [],
        warnings: [],
        error: `HTTP ${response.status} ${response.statusText}`.trim(),
      };
    }

    const html = await response.text();
    const parsed = parseOjadSearchHtml(html);
    return {
      lookupTerm,
      url,
      entries: parsed.entries,
      warnings: parsed.warnings,
      error: null,
    };
  } catch (error) {
    return {
      lookupTerm,
      url,
      entries: [],
      warnings: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
};

export const compareLocalPitchAgainstOjad = ({
  lookupTerm,
  input,
  lookupResult,
}: {
  lookupTerm: string;
  input: OjadComparisonInput;
  lookupResult: OjadLookupResult;
}): OjadComparisonResult => {
  const localAccents = uniqueSortedNumbers(input.accentNumbers);
  if (lookupResult.error) {
    return {
      status: "ojad-fetch-error",
      lookupTerm,
      url: lookupResult.url,
      localAccents,
      ojadEntries: [],
      warnings: lookupResult.warnings,
      error: lookupResult.error,
    };
  }

  const normalizedForm = normalizeText(input.canonicalForm);
  const readingCandidates = new Set(
    [normalizeKanaForComparison(input.canonicalReading), normalizeKanaForComparison(input.displayReading)].filter(
      (value): value is string => Boolean(value),
    ),
  );

  const exactHeadwordEntries = normalizedForm
    ? lookupResult.entries.filter((entry) => normalizeText(entry.headword) === normalizedForm)
    : [];

  const exactEntries = exactHeadwordEntries.filter((entry) => {
    if (readingCandidates.size === 0) return true;
    return entry.accentVariants.some((variant) =>
      readingCandidates.has(normalizeKanaForComparison(variant.reading) ?? ""),
    );
  });

  const readingMatches = lookupResult.entries.filter((entry) =>
    entry.accentVariants.some((variant) =>
      readingCandidates.has(normalizeKanaForComparison(variant.reading) ?? ""),
    ),
  );

  const exactAccentNumbers = uniqueSortedNumbers(
    exactEntries.flatMap((entry) =>
      entry.accentVariants
        .filter((variant) =>
          readingCandidates.size === 0
            ? true
            : readingCandidates.has(normalizeKanaForComparison(variant.reading) ?? ""),
        )
        .map((variant) => variant.accentNumber),
    ),
  );

  const hasAccentMatch = exactAccentNumbers.some((accentNumber) => localAccents.includes(accentNumber));
  if (exactEntries.length > 0) {
    return {
      status: hasAccentMatch ? "matches" : "accent-mismatch",
      lookupTerm,
      url: lookupResult.url,
      localAccents,
      ojadEntries: exactEntries.map(toEntrySummary),
      warnings: lookupResult.warnings,
      error: null,
    };
  }

  if (exactHeadwordEntries.length > 0) {
    return {
      status: "reading-mismatch",
      lookupTerm,
      url: lookupResult.url,
      localAccents,
      ojadEntries: exactHeadwordEntries.map(toEntrySummary),
      warnings: lookupResult.warnings,
      error: null,
    };
  }

  if (normalizedForm && readingMatches.length > 0) {
    return {
      status: readingMatches.length > 1 ? "ojad-ambiguous" : "no-ojad-match",
      lookupTerm,
      url: lookupResult.url,
      localAccents,
      ojadEntries: readingMatches.map(toEntrySummary),
      warnings: lookupResult.warnings,
      error: null,
    };
  }

  if (readingMatches.length > 1) {
    return {
      status: "ojad-ambiguous",
      lookupTerm,
      url: lookupResult.url,
      localAccents,
      ojadEntries: readingMatches.map(toEntrySummary),
      warnings: lookupResult.warnings,
      error: null,
    };
  }

  if (readingMatches.length === 1) {
    const entry = readingMatches[0]!;
    const accentNumbers = uniqueSortedNumbers(entry.accentVariants.map((variant) => variant.accentNumber));
    return {
      status: accentNumbers.some((accentNumber) => localAccents.includes(accentNumber))
        ? "matches"
        : "ojad-ambiguous",
      lookupTerm,
      url: lookupResult.url,
      localAccents,
      ojadEntries: [toEntrySummary(entry)],
      warnings: lookupResult.warnings,
      error: null,
    };
  }

  const nonEmptyResultWarnings = lookupResult.warnings.filter((warning) => warning !== "no-word-rows");
  if (nonEmptyResultWarnings.length > 0) {
    return {
      status: "ojad-parse-uncertain",
      lookupTerm,
      url: lookupResult.url,
      localAccents,
      ojadEntries: [],
      warnings: nonEmptyResultWarnings,
      error: null,
    };
  }

  return {
    status: "no-ojad-match",
    lookupTerm,
    url: lookupResult.url,
    localAccents,
    ojadEntries: [],
    warnings: [],
    error: null,
  };
};
