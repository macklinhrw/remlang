import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { DrizzleInstance } from "./DrizzleContext";
import {
  entries,
  entryExamples,
  entryForms,
  entryReadings,
  entrySenses,
  exampleTranslations,
  examples,
  jaPitchAccents,
  jaEntryData,
  senseGlosses,
  zhEntryData,
} from "./schema";
import { buildEntrySearchMatchQuery, ENTRY_SEARCH_TABLE } from "./searchIndex";

export interface EntrySearchResult {
  id: string;
  languageId: string;
  canonicalForm: string | null;
  canonicalReading: string | null;
  glossPreview: string[];
  forms: { text: string; script: string | null; isPrimary: boolean | null }[];
  hsk: string | null;
  frequencyRank: number | null;
  isCommon: boolean | null;
}

interface SearchGlossRow {
  entryId: string;
  text: string;
  senseOrder: number;
  glossOrder: number;
}

interface SearchReadingRow {
  entryId: string;
  text: string;
  isPrimary: boolean | null;
}

interface SearchCandidateRow {
  id: string;
  languageId: string;
  canonicalForm: string | null;
  canonicalReading: string | null;
  hsk: string | null;
  frequencyRank: number | null;
  isCommon: boolean | null;
}

export interface EntryDetailResult {
  id: string;
  languageId: string;
  canonicalForm: string | null;
  canonicalReading: string | null;
  forms: { text: string; script: string | null; isPrimary: boolean | null }[];
  readings: { text: string; system: string | null; isPrimary: boolean | null }[];
  pitchAccents: {
    dictionaryId: string | null;
    reading: string;
    pronunciation: string | null;
    accentNumber: number;
    accentOrder: number;
    accentPattern: string | null;
    sourcePosClass: string | null;
  }[];
  senses: {
    id: string;
    senseOrder: number;
    partOfSpeech: string | null;
    glosses: { text: string; glossLanguage: string; glossOrder: number }[];
  }[];
  examples: {
    id: string;
    text: string;
    translations: { languageCode: string; text: string }[];
  }[];
  zhData: {
    hsk: string | null;
    frequencyRank: number | null;
    decompositionData: string | null;
  } | null;
  jaData: {
    jlpt: string | null;
    isCommon: boolean | null;
    frequencyRank: number | null;
  } | null;
}

const normalizeSearch = (value: string) => value.trim().toLowerCase();

const splitLatinTokens = (value: string) =>
  value.split(/[^a-z0-9]+/i).map((token) => token.trim()).filter(Boolean);

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const stripParentheticalQualifiers = (value: string) =>
  value.replace(/\([^)]*\)/g, " ").replace(/\s+/g, " ").trim();

const getTextMatchStrength = (text: string | null | undefined, query: string) => {
  if (!text) return 0;

  const normalized = normalizeSearch(text);
  if (!normalized) return 0;

  if (normalized === query) return 1000;
  if (normalized.startsWith(query)) return 880;

  const isLatinQuery = /^[a-z0-9\s'-]+$/i.test(query);
  if (isLatinQuery) {
    const tokens = splitLatinTokens(normalized);
    if (tokens.includes(query)) return 840;
    if (tokens.some((token) => token.startsWith(query))) return 800;
    return 0;
  }

  if (normalized.includes(query)) return 680;
  return 0;
};

const getGlossMatchScore = (gloss: SearchGlossRow, query: string) => {
  const matchStrength = getTextMatchStrength(gloss.text, query);
  if (matchStrength === 0) return 0;

  const normalizedGloss = normalizeSearch(gloss.text);
  const normalizedHeadGloss = normalizeSearch(stripParentheticalQualifiers(gloss.text));
  const clauses = normalizedGloss
    .split(/[;,/]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const headClauses = normalizedHeadGloss
    .split(/[;,/]/)
    .map((clause) => clause.trim())
    .filter(Boolean);
  const exactClauseMatch = clauses.some((clause) => clause === query);
  const prefixClauseMatch = clauses.some((clause) => clause.startsWith(query));
  const exactHeadClauseMatch = headClauses.some((clause) => clause === query);
  const prefixHeadClauseMatch = headClauses.some((clause) => clause.startsWith(query));
  const parentheticalQueryMatch = /^[a-z0-9\s'-]+$/i.test(query)
    ? new RegExp(`\\([^)]*\\b${escapeRegExp(query)}\\b[^)]*\\)`, "i").test(normalizedGloss)
    : false;
  const contextualInfinitiveMatch =
    /^[a-z0-9\s'-]+$/i.test(query) &&
    new RegExp(`^to\\s+[a-z0-9\\s'-]+\\([^)]*\\b${escapeRegExp(query)}\\b[^)]*\\)`, "i").test(
      normalizedGloss,
    );

  const sensePenalty = (gloss.senseOrder - 1) * 250;
  const glossPenalty = (gloss.glossOrder - 1) * 40;
  const clauseBoost = exactClauseMatch
    ? 900
    : exactHeadClauseMatch
      ? 1020
      : prefixClauseMatch
        ? 280
        : prefixHeadClauseMatch
          ? 260
          : 0;
  const parentheticalPenalty =
    parentheticalQueryMatch && !exactHeadClauseMatch && !prefixHeadClauseMatch ? 520 : 0;
  const contextualPenalty = contextualInfinitiveMatch ? 180 : 0;
  const lengthPenalty = exactClauseMatch
    ? Math.min(90, normalizedGloss.length / 2)
    : exactHeadClauseMatch
      ? Math.min(70, normalizedHeadGloss.length / 2)
      : prefixClauseMatch || prefixHeadClauseMatch
      ? Math.min(150, normalizedGloss.length)
      : Math.min(220, normalizedGloss.length + 20);

  return (
    3000 +
    matchStrength +
    clauseBoost -
    sensePenalty -
    glossPenalty -
    lengthPenalty -
    parentheticalPenalty -
    contextualPenalty
  );
};

const getEntrySearchScore = ({
  row,
  forms,
  readings,
  glosses,
  query,
}: {
  row: {
    canonicalForm: string | null;
    canonicalReading: string | null;
    frequencyRank: number | null;
    isCommon: boolean | null;
  };
  forms: EntrySearchResult["forms"];
  readings: SearchReadingRow[];
  glosses: SearchGlossRow[];
  query: string;
}) => {
  const directScores = [
    getTextMatchStrength(row.canonicalForm, query) > 0
      ? 5000 + getTextMatchStrength(row.canonicalForm, query)
      : 0,
    getTextMatchStrength(row.canonicalReading, query) > 0
      ? 4850 + getTextMatchStrength(row.canonicalReading, query)
      : 0,
    ...forms.map((form) => {
      const strength = getTextMatchStrength(form.text, query);
      if (strength === 0) return 0;
      return 4700 + strength + (form.isPrimary ? 30 : 0);
    }),
    ...readings.map((reading) => {
      const strength = getTextMatchStrength(reading.text, query);
      if (strength === 0) return 0;
      return 4600 + strength + (reading.isPrimary ? 30 : 0);
    }),
  ];
  const glossScores = glosses.map((gloss) => getGlossMatchScore(gloss, query));
  const bestTextScore = Math.max(...directScores, ...glossScores, 0);
  if (bestTextScore === 0) return 0;

  const commonBoost = row.isCommon ? 100 : 0;
  const frequencyBoost =
    row.frequencyRank && row.frequencyRank > 0
      ? Math.max(0, 120 - Math.min(120, Math.floor(row.frequencyRank / 250)))
      : 0;
  const isLatinQuery = /^[a-z0-9\s'-]+$/i.test(query);
  const glossOnlyMatch = Math.max(...directScores, 0) === 0 && Math.max(...glossScores, 0) > 0;
  const hasPrimaryExactGlossMatch = glosses.some((gloss) => {
    const normalizedGloss = normalizeSearch(gloss.text);
    const normalizedHeadGloss = normalizeSearch(stripParentheticalQualifiers(gloss.text));
    return (
      gloss.senseOrder === 1 &&
      gloss.glossOrder === 1 &&
      (normalizedGloss === query || normalizedHeadGloss === query)
    );
  });
  const sensePenalty = hasPrimaryExactGlossMatch
    ? Math.min(36, Math.max(0, glosses.length - 5) * 3)
    : Math.min(140, Math.max(0, glosses.length - 3) * 8);
  const primaryGlossFrequencyBoost =
    hasPrimaryExactGlossMatch && row.frequencyRank && row.frequencyRank > 0
      ? Math.max(0, 120 - Math.min(120, Math.floor(row.frequencyRank / 15)))
      : 0;
  const singleCharacterPenalty =
    isLatinQuery && glossOnlyMatch && (row.canonicalForm?.length ?? 0) === 1 ? 260 : 0;

  return (
    bestTextScore +
    commonBoost +
    frequencyBoost -
    sensePenalty +
    primaryGlossFrequencyBoost -
    singleCharacterPenalty
  );
};

export const searchEntries = async (
  db: DrizzleInstance,
  search: string,
  options?: {
    languageId?: string;
  },
): Promise<EntrySearchResult[]> => {
  const lowerSearch = normalizeSearch(search);
  if (!lowerSearch) return [];
  const matchQuery = buildEntrySearchMatchQuery(lowerSearch);
  if (!matchQuery) return [];
  const isLatinQuery = /^[a-z0-9\s'-]+$/i.test(lowerSearch);

  const ftsCandidateRows = await db.all<{ id: string }>(sql`
    SELECT
      e.id AS id
    FROM ${sql.raw(`${ENTRY_SEARCH_TABLE} es`)}
    INNER JOIN ${entries} e ON e.id = ${sql.raw("es.entry_id")}
    WHERE ${sql.raw(ENTRY_SEARCH_TABLE)} MATCH ${matchQuery}
      ${options?.languageId ? sql`AND es.language_id = ${options.languageId}` : sql.empty()}
    ORDER BY bm25(${sql.raw(ENTRY_SEARCH_TABLE)}, 12.0, 10.0, 7.0, 7.0, 4.0, 2.0) ASC
    LIMIT 400
  `);

  const glossCandidateRows = isLatinQuery
    ? await db
        .selectDistinct({
          id: entries.id,
        })
        .from(senseGlosses)
        .innerJoin(entrySenses, eq(senseGlosses.senseId, entrySenses.id))
        .innerJoin(entries, eq(entrySenses.entryId, entries.id))
        .where(
          and(
            options?.languageId ? eq(entries.languageId, options.languageId) : undefined,
            eq(senseGlosses.glossLanguage, "eng"),
            sql`(
              LOWER(${senseGlosses.text}) = ${lowerSearch}
              OR LOWER(${senseGlosses.text}) LIKE ${`${lowerSearch} %`}
              OR LOWER(${senseGlosses.text}) LIKE ${`${lowerSearch} (%`}
              OR LOWER(${senseGlosses.text}) LIKE ${`${lowerSearch},%`}
              OR LOWER(${senseGlosses.text}) LIKE ${`${lowerSearch};%`}
              OR LOWER(${senseGlosses.text}) LIKE ${`${lowerSearch}/%`}
            )`,
          ),
        )
        .orderBy(asc(entrySenses.senseOrder), asc(senseGlosses.glossOrder))
        .limit(300)
    : [];

  const ids = [...new Set([...ftsCandidateRows, ...glossCandidateRows].map((row) => row.id))];
  if (ids.length === 0) return [];

  const [rows, formsRows, readingsRows, glossRows] = await Promise.all([
    db
      .select({
        id: entries.id,
        languageId: entries.languageId,
        canonicalForm: entries.canonicalForm,
        canonicalReading: entries.canonicalReading,
        hsk: zhEntryData.hsk,
        frequencyRank: sql<number | null>`COALESCE(${zhEntryData.frequencyRank}, ${jaEntryData.frequencyRank})`,
        isCommon: jaEntryData.isCommon,
      })
      .from(entries)
      .leftJoin(zhEntryData, eq(zhEntryData.entryId, entries.id))
      .leftJoin(jaEntryData, eq(jaEntryData.entryId, entries.id))
      .where(inArray(entries.id, ids)),
    db
      .select({
        entryId: entryForms.entryId,
        text: entryForms.text,
        script: entryForms.script,
        isPrimary: entryForms.isPrimary,
        rawRank: entryForms.rawRank,
      })
      .from(entryForms)
      .where(inArray(entryForms.entryId, ids))
      .orderBy(asc(entryForms.rawRank), asc(entryForms.text)),
    db
      .select({
        entryId: entryReadings.entryId,
        text: entryReadings.text,
        isPrimary: entryReadings.isPrimary,
        rawRank: entryReadings.rawRank,
      })
      .from(entryReadings)
      .where(inArray(entryReadings.entryId, ids))
      .orderBy(desc(entryReadings.isPrimary), asc(entryReadings.rawRank), asc(entryReadings.text)),
    db
      .select({
        entryId: entrySenses.entryId,
        text: senseGlosses.text,
        senseOrder: entrySenses.senseOrder,
        glossOrder: senseGlosses.glossOrder,
      })
      .from(senseGlosses)
      .innerJoin(entrySenses, eq(senseGlosses.senseId, entrySenses.id))
      .where(
        and(
          inArray(entrySenses.entryId, ids),
          eq(senseGlosses.glossLanguage, "eng"),
        ),
      )
      .orderBy(asc(entrySenses.senseOrder), asc(senseGlosses.glossOrder)),
  ]);

  const rowsById = new Map(rows.map((row) => [row.id, row]));
  const orderedRows = ids.map((id) => rowsById.get(id)).filter(Boolean) as SearchCandidateRow[];

  const formsByEntry = new Map<string, EntrySearchResult["forms"]>();
  for (const form of formsRows) {
    const current = formsByEntry.get(form.entryId) ?? [];
    current.push({
      text: form.text,
      script: form.script,
      isPrimary: form.isPrimary,
    });
    formsByEntry.set(form.entryId, current);
  }

  const readingsByEntry = new Map<string, SearchReadingRow[]>();
  for (const reading of readingsRows) {
    const current = readingsByEntry.get(reading.entryId) ?? [];
    current.push({
      entryId: reading.entryId,
      text: reading.text,
      isPrimary: reading.isPrimary,
    });
    readingsByEntry.set(reading.entryId, current);
  }

  const glossesByEntry = new Map<string, SearchGlossRow[]>();
  for (const gloss of glossRows) {
    const current = glossesByEntry.get(gloss.entryId) ?? [];
    current.push(gloss);
    glossesByEntry.set(gloss.entryId, current);
  }

  const glossPreviewByEntry = new Map<string, string[]>();
  for (const [entryId, entryGlosses] of glossesByEntry.entries()) {
    glossPreviewByEntry.set(
      entryId,
      entryGlosses
        .slice()
        .sort((a, b) =>
          a.senseOrder !== b.senseOrder
            ? a.senseOrder - b.senseOrder
            : a.glossOrder - b.glossOrder,
        )
        .slice(0, 3)
        .map((gloss) => gloss.text),
    );
  }

  return orderedRows
    .map((row) => ({
      id: row.id,
      languageId: row.languageId,
      canonicalForm: row.canonicalForm,
      canonicalReading: row.canonicalReading,
      glossPreview: glossPreviewByEntry.get(row.id) ?? [],
      forms: formsByEntry.get(row.id) ?? [],
      hsk: row.hsk,
      frequencyRank: row.frequencyRank,
      isCommon: row.isCommon,
      score: getEntrySearchScore({
        row,
        forms: formsByEntry.get(row.id) ?? [],
        readings: readingsByEntry.get(row.id) ?? [],
        glosses: glossesByEntry.get(row.id) ?? [],
        query: lowerSearch,
      }),
    }))
    .filter((row) => row.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if ((b.isCommon ? 1 : 0) !== (a.isCommon ? 1 : 0)) {
        return (b.isCommon ? 1 : 0) - (a.isCommon ? 1 : 0);
      }
      if ((a.frequencyRank ?? Number.MAX_SAFE_INTEGER) !== (b.frequencyRank ?? Number.MAX_SAFE_INTEGER)) {
        return (a.frequencyRank ?? Number.MAX_SAFE_INTEGER) - (b.frequencyRank ?? Number.MAX_SAFE_INTEGER);
      }
      return (a.canonicalForm ?? "").localeCompare(b.canonicalForm ?? "");
    })
    .slice(0, 100)
    .map(({ score: _score, ...row }) => row);
};

export const getEntryDetail = async (
  db: DrizzleInstance,
  entryId: string,
): Promise<EntryDetailResult | null> => {
  const [entryRow] = await db
    .select({
      id: entries.id,
      languageId: entries.languageId,
      canonicalForm: entries.canonicalForm,
      canonicalReading: entries.canonicalReading,
      hsk: zhEntryData.hsk,
      frequencyRank: sql<number | null>`COALESCE(${zhEntryData.frequencyRank}, ${jaEntryData.frequencyRank})`,
      decompositionData: zhEntryData.decompositionData,
      jlpt: jaEntryData.jlpt,
      isCommon: jaEntryData.isCommon,
    })
    .from(entries)
    .leftJoin(zhEntryData, eq(zhEntryData.entryId, entries.id))
    .leftJoin(jaEntryData, eq(jaEntryData.entryId, entries.id))
    .where(eq(entries.id, entryId))
    .limit(1);

  if (!entryRow) return null;

  const [
    formsRows,
    readingsRows,
    pitchAccentRows,
    sensesRows,
    glossRows,
    exampleRows,
    translationRows,
  ] =
    await Promise.all([
      db
        .select({
          text: entryForms.text,
          script: entryForms.script,
          isPrimary: entryForms.isPrimary,
          rawRank: entryForms.rawRank,
        })
        .from(entryForms)
        .where(eq(entryForms.entryId, entryId))
        .orderBy(desc(entryForms.isPrimary), asc(entryForms.rawRank), asc(entryForms.text)),
      db
        .select({
          text: entryReadings.text,
          system: entryReadings.system,
          isPrimary: entryReadings.isPrimary,
          rawRank: entryReadings.rawRank,
        })
        .from(entryReadings)
        .where(eq(entryReadings.entryId, entryId))
        .orderBy(
          desc(entryReadings.isPrimary),
          asc(entryReadings.rawRank),
          asc(entryReadings.text),
        ),
      db
        .select({
          dictionaryId: jaPitchAccents.dictionaryId,
          reading: jaPitchAccents.reading,
          pronunciation: jaPitchAccents.pronunciation,
          accentNumber: jaPitchAccents.accentNumber,
          accentOrder: jaPitchAccents.accentOrder,
          accentPattern: jaPitchAccents.accentPattern,
          sourcePosClass: jaPitchAccents.sourcePosClass,
        })
        .from(jaPitchAccents)
        .where(eq(jaPitchAccents.entryId, entryId))
        .orderBy(
          asc(
            sql`CASE
              WHEN ${jaPitchAccents.dictionaryId} = 'dict_unidic_cwj' THEN 0
              WHEN ${jaPitchAccents.dictionaryId} = 'dict_kanjium_pitch' THEN 1
              ELSE 2
            END`,
          ),
          asc(jaPitchAccents.accentOrder),
          asc(jaPitchAccents.accentNumber),
        ),
      db
        .select({
          id: entrySenses.id,
          senseOrder: entrySenses.senseOrder,
          partOfSpeech: entrySenses.partOfSpeech,
        })
        .from(entrySenses)
        .where(eq(entrySenses.entryId, entryId))
        .orderBy(asc(entrySenses.senseOrder)),
      db
        .select({
          senseId: senseGlosses.senseId,
          text: senseGlosses.text,
          glossLanguage: senseGlosses.glossLanguage,
          glossOrder: senseGlosses.glossOrder,
        })
        .from(senseGlosses)
        .where(
          inArray(
            senseGlosses.senseId,
            db
              .select({ id: entrySenses.id })
              .from(entrySenses)
              .where(eq(entrySenses.entryId, entryId)),
          ),
        )
        .orderBy(asc(senseGlosses.glossOrder)),
      db
        .select({
          id: examples.id,
          text: examples.text,
        })
        .from(examples)
        .where(
          inArray(
            examples.id,
            db
              .select({ exampleId: entryExamples.exampleId })
              .from(entryExamples)
              .where(eq(entryExamples.entryId, entryId)),
          ),
        )
        .orderBy(asc(examples.text)),
      db
        .select({
          exampleId: exampleTranslations.exampleId,
          languageCode: exampleTranslations.languageCode,
          text: exampleTranslations.text,
        })
        .from(exampleTranslations)
        .where(
          inArray(
            exampleTranslations.exampleId,
            db
              .select({ exampleId: entryExamples.exampleId })
              .from(entryExamples)
              .where(eq(entryExamples.entryId, entryId)),
          ),
        )
        .orderBy(
          asc(exampleTranslations.exampleId),
          asc(exampleTranslations.languageCode),
          asc(exampleTranslations.text),
        ),
    ]);

  const glossesBySense = new Map<string, EntryDetailResult["senses"][number]["glosses"]>();
  for (const gloss of glossRows) {
    const current = glossesBySense.get(gloss.senseId) ?? [];
    current.push({
      text: gloss.text,
      glossLanguage: gloss.glossLanguage,
      glossOrder: gloss.glossOrder,
    });
    glossesBySense.set(gloss.senseId, current);
  }

  const translationsByExample = new Map<
    string,
    EntryDetailResult["examples"][number]["translations"]
  >();
  for (const translation of translationRows) {
    const current = translationsByExample.get(translation.exampleId) ?? [];
    current.push({
      languageCode: translation.languageCode,
      text: translation.text,
    });
    translationsByExample.set(translation.exampleId, current);
  }

  return {
    id: entryRow.id,
    languageId: entryRow.languageId,
    canonicalForm: entryRow.canonicalForm,
    canonicalReading: entryRow.canonicalReading,
    forms: formsRows.map((form) => ({
      text: form.text,
      script: form.script,
      isPrimary: form.isPrimary,
    })),
    readings: readingsRows.map((reading) => ({
      text: reading.text,
      system: reading.system,
      isPrimary: reading.isPrimary,
    })),
    pitchAccents: pitchAccentRows.map((pitchAccent) => ({
      dictionaryId: pitchAccent.dictionaryId,
      reading: pitchAccent.reading,
      pronunciation: pitchAccent.pronunciation,
      accentNumber: pitchAccent.accentNumber,
      accentOrder: pitchAccent.accentOrder,
      accentPattern: pitchAccent.accentPattern,
      sourcePosClass: pitchAccent.sourcePosClass,
    })),
    senses: sensesRows.map((sense) => ({
      id: sense.id,
      senseOrder: sense.senseOrder,
      partOfSpeech: sense.partOfSpeech,
      glosses: glossesBySense.get(sense.id) ?? [],
    })),
    examples: exampleRows.map((example) => ({
      id: example.id,
      text: example.text,
      translations: translationsByExample.get(example.id) ?? [],
    })),
    zhData:
      entryRow.hsk !== null ||
      entryRow.frequencyRank !== null ||
      entryRow.decompositionData !== null
        ? {
            hsk: entryRow.hsk,
            frequencyRank: entryRow.frequencyRank,
            decompositionData: entryRow.decompositionData,
          }
        : null,
    jaData:
      entryRow.jlpt !== null || entryRow.isCommon !== null || entryRow.frequencyRank !== null
        ? {
            jlpt: entryRow.jlpt,
            isCommon: entryRow.isCommon,
            frequencyRank: entryRow.frequencyRank,
          }
        : null,
  };
};
