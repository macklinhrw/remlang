import { openSeedDatabase } from "@/scripts/seed/core/db";
import {
  compareLocalPitchAgainstOjad,
  fetchOjadSearch,
  getOjadLookupTerm,
  type OjadComparisonInput,
} from "@/scripts/lib/ojadPitchAudit";

export interface AuditArgs {
  limit: number;
  terms: string[];
  ojad: boolean;
}

interface SummaryRow {
  totalAmbiguous: number;
  kanjiumOnly: number;
  suspiciousUnidicMultiLemma: number;
  unidicSingleLemmaMultiVariant: number;
}

interface SuspiciousBucketRow {
  canonicalForm: string | null;
  canonicalReading: string | null;
  entryId: string;
  displayReading: string | null;
  accents: string | null;
  variantCount: number;
  unidicLemmaCount: number;
}

interface FocusedRow {
  entryId: string;
  canonicalForm: string | null;
  canonicalReading: string | null;
  dictionaryId: string | null;
  surfaceForm: string | null;
  reading: string | null;
  pronunciation: string | null;
  accentNumber: number;
  accentOrder: number;
  accentPattern: string | null;
  matchType: string | null;
  sourceLexemeId: string | null;
  sourceLemmaId: string | null;
}

interface OjadAuditTarget extends OjadComparisonInput {
  entryId: string;
  dictionaryIds?: string[];
}

const parsePositiveInteger = (value: string | undefined, fallbackValue: number) => {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue;
};

export const parseAuditArgs = (argv: string[] = process.argv): AuditArgs => {
  let limit = 25;
  let ojad = false;
  const terms: string[] = [];

  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";

    if (arg === "--ojad") {
      ojad = true;
      continue;
    }

    if (arg.startsWith("--limit=")) {
      limit = parsePositiveInteger(arg.split("=")[1], limit);
      continue;
    }

    if (arg === "--limit") {
      limit = parsePositiveInteger(argv[index + 1], limit);
      index += 1;
      continue;
    }

    if (arg.startsWith("--")) continue;
    if (arg) terms.push(arg);
  }

  return {
    limit,
    terms,
    ojad,
  };
};

const parseAccentNumbers = (value: string | null | undefined) =>
  (value ?? "")
    .split(",")
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((accentNumber) => Number.isFinite(accentNumber));

const uniqueSortedStrings = (values: (string | null | undefined)[]) =>
  [...new Set(values.map((value) => value?.trim()).filter((value): value is string => Boolean(value)))].sort();

const printRows = (label: string, rows: unknown[]) => {
  console.log(`\n${label}`);
  if (rows.length === 0) {
    console.log("  none");
    return;
  }

  for (const row of rows) {
    console.log(`  ${JSON.stringify(row)}`);
  }
};

const buildSuspiciousBucketOjadTarget = (row: SuspiciousBucketRow): OjadAuditTarget => ({
  entryId: row.entryId,
  canonicalForm: row.canonicalForm,
  canonicalReading: row.canonicalReading,
  displayReading: row.displayReading,
  accentNumbers: parseAccentNumbers(row.accents),
  dictionaryIds: ["dict_unidic_cwj"],
});

const groupFocusedRowsForOjad = (rows: FocusedRow[]): OjadAuditTarget[] => {
  const grouped = new Map<string, OjadAuditTarget>();

  for (const row of rows) {
    const displayReading = row.pronunciation ?? row.reading;
    const key = [row.entryId, row.dictionaryId ?? "", displayReading ?? ""].join("\u241f");
    const existing = grouped.get(key);

    if (existing) {
      if (!existing.accentNumbers.includes(row.accentNumber)) {
        existing.accentNumbers.push(row.accentNumber);
        existing.accentNumbers.sort((left, right) => left - right);
      }
      if (row.dictionaryId && !existing.dictionaryIds?.includes(row.dictionaryId)) {
        existing.dictionaryIds = [...(existing.dictionaryIds ?? []), row.dictionaryId].sort();
      }
      continue;
    }

    grouped.set(key, {
      entryId: row.entryId,
      canonicalForm: row.canonicalForm,
      canonicalReading: row.canonicalReading,
      displayReading,
      accentNumbers: [row.accentNumber],
      dictionaryIds: row.dictionaryId ? [row.dictionaryId] : [],
    });
  }

  return [...grouped.values()].sort((left, right) => {
    const formDelta = (left.canonicalForm ?? "").localeCompare(right.canonicalForm ?? "", "ja");
    if (formDelta !== 0) return formDelta;
    const readingDelta = (left.displayReading ?? "").localeCompare(right.displayReading ?? "", "ja");
    if (readingDelta !== 0) return readingDelta;
    return left.entryId.localeCompare(right.entryId);
  });
};

const createOjadLookupCache = () => {
  const cache = new Map<string, ReturnType<typeof fetchOjadSearch>>();

  return async (term: string) => {
    const existing = cache.get(term);
    if (existing) return existing;
    const next = fetchOjadSearch(term);
    cache.set(term, next);
    return next;
  };
};

const enrichTargetsWithOjad = async (targets: OjadAuditTarget[]) => {
  const lookupWithCache = createOjadLookupCache();
  const enrichedRows: Record<string, unknown>[] = [];

  for (const target of targets) {
    const lookupTerm = getOjadLookupTerm(target);
    if (!lookupTerm) {
      enrichedRows.push({
        entryId: target.entryId,
        canonicalForm: target.canonicalForm,
        canonicalReading: target.canonicalReading,
        displayReading: target.displayReading,
        dictionaryIds: target.dictionaryIds,
        localAccents: target.accentNumbers,
        ojadStatus: "ojad-parse-uncertain",
        ojadWarnings: ["missing-lookup-term"],
      });
      continue;
    }

    const lookupResult = await lookupWithCache(lookupTerm);
    const comparison = compareLocalPitchAgainstOjad({
      lookupTerm,
      input: target,
      lookupResult,
    });

    const outputRow: Record<string, unknown> = {
      entryId: target.entryId,
      canonicalForm: target.canonicalForm,
      canonicalReading: target.canonicalReading,
      displayReading: target.displayReading,
      dictionaryIds: target.dictionaryIds,
      localAccents: target.accentNumbers,
      lookupTerm,
      ojadStatus: comparison.status,
      ojadUrl: comparison.url,
      ojadMatches: comparison.ojadEntries,
    };

    if (comparison.warnings.length > 0) {
      outputRow.ojadWarnings = comparison.warnings;
    }
    if (comparison.error) {
      outputRow.ojadError = comparison.error;
    }

    enrichedRows.push(outputRow);
  }

  return enrichedRows;
};

export const runAudit = async (argv: string[] = process.argv) => {
  const args = parseAuditArgs(argv);
  const { sqlite } = openSeedDatabase();

  try {
    const summary = sqlite
      .prepare(
        `
          with normalized as (
            select
              jpa.entry_id as entryId,
              e.canonical_form as canonicalForm,
              e.canonical_reading as canonicalReading,
              jpa.dictionary_id as dictionaryId,
              coalesce(jpa.pronunciation, jpa.reading) as displayReading,
              jpa.accent_number as accentNumber,
              coalesce(jpa.accent_pattern, '') as accentPattern,
              jpa.source_lemma_id as sourceLemmaId
            from ja_pitch_accents jpa
            join entries e on e.id = jpa.entry_id
            where e.language_id = 'lang_ja'
          ),
          dedup as (
            select *,
              row_number() over (
                partition by entryId, dictionaryId, displayReading, accentNumber, accentPattern
                order by accentNumber
              ) as variantRank
            from normalized
          ),
          variants as (
            select * from dedup where variantRank = 1
          ),
          grouped as (
            select
              entryId,
              canonicalForm,
              canonicalReading,
              displayReading,
              count(*) as variantCount,
              sum(case when dictionaryId = 'dict_unidic_cwj' then 1 else 0 end) as unidicCount,
              sum(case when dictionaryId = 'dict_kanjium_pitch' then 1 else 0 end) as kanjiumCount,
              count(distinct case when dictionaryId = 'dict_unidic_cwj' then sourceLemmaId end) as unidicLemmaCount
            from variants
            group by entryId, canonicalForm, canonicalReading, displayReading
            having count(*) > 1
          )
          select
            count(*) as totalAmbiguous,
            sum(case when kanjiumCount > 1 and unidicCount = 0 then 1 else 0 end) as kanjiumOnly,
            sum(case when unidicCount > 1 and unidicLemmaCount > 1 then 1 else 0 end) as suspiciousUnidicMultiLemma,
            sum(case when unidicCount > 1 and unidicLemmaCount <= 1 then 1 else 0 end) as unidicSingleLemmaMultiVariant
          from grouped
        `,
      )
      .get() as SummaryRow;

    console.log("JA pitch accent import audit");
    console.log(`  total ambiguous same-reading buckets: ${summary.totalAmbiguous}`);
    console.log(`  Kanjium-only buckets: ${summary.kanjiumOnly}`);
    console.log(`  suspicious UniDic multi-lemma buckets: ${summary.suspiciousUnidicMultiLemma}`);
    console.log(
      `  UniDic single-lemma multi-variant buckets: ${summary.unidicSingleLemmaMultiVariant}`,
    );

    const suspiciousBuckets = sqlite
      .prepare(
        `
          with normalized as (
            select
              jpa.entry_id as entryId,
              e.canonical_form as canonicalForm,
              e.canonical_reading as canonicalReading,
              jpa.dictionary_id as dictionaryId,
              coalesce(jpa.pronunciation, jpa.reading) as displayReading,
              jpa.accent_number as accentNumber,
              coalesce(jpa.accent_pattern, '') as accentPattern,
              jpa.source_lemma_id as sourceLemmaId
            from ja_pitch_accents jpa
            join entries e on e.id = jpa.entry_id
            where e.language_id = 'lang_ja'
          ),
          dedup as (
            select *,
              row_number() over (
                partition by entryId, dictionaryId, displayReading, accentNumber, accentPattern
                order by accentNumber
              ) as variantRank
            from normalized
          ),
          variants as (
            select * from dedup where variantRank = 1
          )
          select
            canonicalForm,
            canonicalReading,
            entryId,
            displayReading,
            group_concat(accentNumber) as accents,
            count(*) as variantCount,
            count(distinct sourceLemmaId) as unidicLemmaCount
          from variants
          where dictionaryId = 'dict_unidic_cwj'
          group by entryId, canonicalForm, canonicalReading, displayReading
          having count(*) > 1 and count(distinct sourceLemmaId) > 1
          order by canonicalForm asc, canonicalReading asc, displayReading asc
          limit ?
        `,
      )
      .all(args.limit) as SuspiciousBucketRow[];

    printRows("Sample suspicious UniDic buckets", suspiciousBuckets);

    if (args.ojad) {
      const suspiciousOjadRows = await enrichTargetsWithOjad(
        suspiciousBuckets.map((row) => buildSuspiciousBucketOjadTarget(row)),
      );
      printRows("OJAD checks for suspicious UniDic buckets", suspiciousOjadRows);
    }

    if (args.terms.length === 0) return;

    const focusedRowsStmt = sqlite.prepare(
      `
        select
          e.id as entryId,
          e.canonical_form as canonicalForm,
          e.canonical_reading as canonicalReading,
          jpa.dictionary_id as dictionaryId,
          jpa.surface_form as surfaceForm,
          jpa.reading as reading,
          jpa.pronunciation as pronunciation,
          jpa.accent_number as accentNumber,
          jpa.accent_order as accentOrder,
          jpa.accent_pattern as accentPattern,
          jpa.match_type as matchType,
          jpa.source_lexeme_id as sourceLexemeId,
          jpa.source_lemma_id as sourceLemmaId
        from ja_pitch_accents jpa
        join entries e on e.id = jpa.entry_id
        where e.language_id = 'lang_ja'
          and (
            e.id = @term
            or e.canonical_form = @term
            or e.canonical_reading = @term
            or exists (
              select 1
              from entry_forms ef
              where ef.entry_id = e.id and ef.text = @term
            )
            or exists (
              select 1
              from entry_readings er
              where er.entry_id = e.id and er.text = @term
            )
          )
        order by e.canonical_form asc, e.canonical_reading asc, dictionaryId asc, accentOrder asc, accentNumber asc
      `,
    );

    for (const term of args.terms) {
      const rows = focusedRowsStmt.all({ term }) as FocusedRow[];
      printRows(`Focused rows for ${term}`, rows);

      if (!args.ojad) continue;

      const groupedTargets = groupFocusedRowsForOjad(rows);
      const ojadRows = await enrichTargetsWithOjad(groupedTargets);
      printRows(`OJAD checks for ${term}`, ojadRows);
    }
  } finally {
    sqlite.close();
  }
};

const isDirectExecution = process.argv[1]?.endsWith("audit-ja-pitch-accent-import.ts");

if (isDirectExecution) {
  void runAudit();
}
