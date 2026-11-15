import fs from "fs";
import path from "path";
import readline from "readline";

export const UNIDIC_CWJ_VERSION = "3.1.1";
export const UNIDIC_CWJ_DIRNAME = `unidic-cwj-${UNIDIC_CWJ_VERSION}`;
export const UNIDIC_CWJ_LEX_FILE = "lex_3_1.csv";
export const UNIDIC_CWJ_README_FILE = "README";
export const UNIDIC_CWJ_FEATURE_FILE = "feature.def";
export const UNIDIC_CWJ_LICENSE_DIR = "licenses";
export const UNIDIC_CWJ_BASE_URL =
  "https://clrd.ninjal.ac.jp/unidic_archive/cwj/3.1.1/unidic-cwj-3.1.1";
export const KANJIUM_DIRNAME = "kanjium";
export const KANJIUM_ACCENTS_FILE = "accents.txt";
export const KANJIUM_README_FILE = "README.md";
export const KANJIUM_LICENSE_FILE = "LICENSE.txt";
export const KANJIUM_BASE_URL = "https://github.com/mifunetoshiro/kanjium";

// Pinned download URLs and checksums for these files live in scripts/data/sources.ts.

export interface JaJmdictWord {
  id: string;
  kanji?: { common?: boolean; text: string; tags?: string[] }[];
  kana: {
    common?: boolean;
    text: string;
    tags?: string[];
    appliesToKanji?: string[];
  }[];
  sense: {
    gloss?: { lang?: string; text: string; gender?: string | null; type?: string | null }[];
    partOfSpeech?: string[];
    field?: string[];
    dialect?: string[];
    misc?: string[];
    info?: string[];
    examples?: {
      source?: { type?: string; value?: string };
      text?: string;
      sentences?: { lang: string; text: string }[];
    }[];
  }[];
}

export type JaPitchAccentMatchType =
  | "form-reading"
  | "lemma-form-reading"
  | "reading-reading"
  | "canonical-form-reading"
  | "lemma-canonical-form-reading";

type JaPitchAccentPosClass =
  | "verb"
  | "adjective"
  | "adverb"
  | "interjection"
  | "pronoun"
  | "counter"
  | "numeral"
  | "noun-general"
  | "noun-proper"
  | "suffix-prefix-auxiliary"
  | "other";

type JaPitchAccentRejectionReason =
  | "lemma-mismatch"
  | "script-mismatch"
  | "pos-mismatch";

export interface JaPitchAccentImportStats {
  totalSourceRows: number;
  rowsWithoutAccent: number;
  rowsWithoutHeadword: number;
  rowsWithAccent: number;
  matchedRows: number;
  matchedVariants: number;
  duplicateVariantsSkipped: number;
  invalidAccentRows: number;
  noCandidateRows: number;
  skippedCoveredEntryRows: number;
  ambiguousFormReadingRows: number;
  ambiguousReadingRows: number;
  ambiguousCanonicalRows: number;
  rejectedLemmaMismatchRows: number;
  rejectedScriptMismatchRows: number;
  rejectedPosMismatchRows: number;
  rejectedAmbiguousCompatibleRows: number;
  samples: {
    noCandidate: { surfaceForm: string; reading: string; rawAccentType: string }[];
    ambiguous: {
      matchType: JaPitchAccentMatchType;
      surfaceForm: string;
      reading: string;
      rawAccentType: string;
      candidateEntryIds: string[];
    }[];
    rejectedLemmaMismatch: {
      surfaceForm: string;
      reading: string;
      lemma: string | null;
      rawAccentType: string;
      sourceLexemeId: string | null;
      sourceLemmaId: string | null;
    }[];
    rejectedScriptMismatch: {
      surfaceForm: string;
      reading: string;
      lemma: string | null;
      rawAccentType: string;
      sourceLexemeId: string | null;
      sourceLemmaId: string | null;
    }[];
    rejectedPosMismatch: {
      surfaceForm: string;
      reading: string;
      lemma: string | null;
      rawAccentType: string;
      sourceLexemeId: string | null;
      sourceLemmaId: string | null;
    }[];
    ambiguousCompatible: {
      matchType: JaPitchAccentMatchType;
      surfaceForm: string;
      reading: string;
      lemma: string | null;
      rawAccentType: string;
      candidateEntryIds: string[];
    }[];
  };
}

type JaPitchAccentInsert = {
  id: string;
  entryId: string;
  dictionaryId: string;
  surfaceForm: string;
  reading: string;
  pronunciation: string | null;
  accentNumber: number;
  accentOrder: number;
  accentPattern: string | null;
  rawAccentType: string;
  rawAccentConType: string | null;
  rawAccentModType: string | null;
  moraCount: number | null;
  sourcePosClass: JaPitchAccentPosClass | null;
  sourceLexemeId: string | null;
  sourceLemmaId: string | null;
  sourceLine: number;
  matchType: JaPitchAccentMatchType;
};

interface JaEntryPitchAccentIndex {
  byFormReading: Map<string, Set<string>>;
  byReadingReading: Map<string, Set<string>>;
  byCanonicalFormReading: Map<string, Set<string>>;
  byEntryId: Map<string, JaEntryPitchAccentEntry>;
}

interface JaEntryPitchAccentEntry {
  entryId: string;
  canonicalForm: string | null;
  canonicalReading: string | null;
  forms: Set<string>;
  kanaForms: Set<string>;
  posClasses: Set<JaPitchAccentPosClass>;
  allowsProperNoun: boolean;
}

interface UnidicLexRow {
  surface: string;
  pos1: string;
  pos2: string;
  pos3: string;
  pos4: string;
  lForm: string;
  lemma: string;
  orthBase: string;
  pronBase: string;
  kanaBase: string;
  rawAccentType: string;
  rawAccentConType: string;
  rawAccentModType: string;
  sourceLexemeId: string;
  sourceLemmaId: string;
}

export const getUnidicCwjPaths = (resourcesDir: string) => {
  const baseDir = path.join(resourcesDir, UNIDIC_CWJ_DIRNAME);
  return {
    baseDir,
    readmePath: path.join(baseDir, UNIDIC_CWJ_README_FILE),
    featurePath: path.join(baseDir, UNIDIC_CWJ_FEATURE_FILE),
    lexCsvPath: path.join(baseDir, UNIDIC_CWJ_LEX_FILE),
    licensesDir: path.join(baseDir, UNIDIC_CWJ_LICENSE_DIR),
    bsdLicensePath: path.join(baseDir, UNIDIC_CWJ_LICENSE_DIR, "BSD"),
  };
};

export const getKanjiumPaths = (resourcesDir: string) => {
  const baseDir = path.join(resourcesDir, KANJIUM_DIRNAME);
  return {
    baseDir,
    accentsPath: path.join(baseDir, KANJIUM_ACCENTS_FILE),
    readmePath: path.join(baseDir, KANJIUM_README_FILE),
    licensePath: path.join(baseDir, KANJIUM_LICENSE_FILE),
  };
};

export const normalizeKatakanaToHiragana = (value: string) =>
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

const SMALL_COMBINING_KANA = new Set([
  "ぁ",
  "ぃ",
  "ぅ",
  "ぇ",
  "ぉ",
  "ゃ",
  "ゅ",
  "ょ",
  "ゎ",
  "ゕ",
  "ゖ",
  "ァ",
  "ィ",
  "ゥ",
  "ェ",
  "ォ",
  "ャ",
  "ュ",
  "ョ",
  "ヮ",
  "ヵ",
  "ヶ",
]);

export const countJapaneseMora = (value: string) => {
  if (!value) return 0;

  let moraCount = 0;
  for (const [index, char] of Array.from(value).entries()) {
    if (SMALL_COMBINING_KANA.has(char)) {
      if (index === 0) moraCount += 1;
      continue;
    }
    moraCount += 1;
  }

  return moraCount;
};

const classifyAccentPattern = (accentNumber: number, moraCount: number | null) => {
  if (accentNumber === 0) return "heiban";
  if (!moraCount || moraCount <= 0) return null;
  if (accentNumber === 1) return "atamadaka";
  if (accentNumber === moraCount) return "odaka";
  if (accentNumber > 1 && accentNumber < moraCount) return "nakadaka";
  return null;
};

const normalizeKana = (value: string | null | undefined) => {
  if (!value || value === "*") return null;
  return normalizeKatakanaToHiragana(value);
};

const normalizeOrthographicForm = (value: string | null | undefined) => {
  if (!value || value === "*") return null;
  const normalized = value.normalize("NFC").trim();
  return normalized || null;
};

const KANA_ONLY_PATTERN = /^[\p{Script=Hiragana}\p{Script=Katakana}ー・]+$/u;

const isKanaOnly = (value: string) => KANA_ONLY_PATTERN.test(value);

const normalizePartOfSpeech = (value: string) => value.trim().toLowerCase();

const mapJmdictPartOfSpeechToClass = (value: string): JaPitchAccentPosClass | null => {
  const normalized = normalizePartOfSpeech(value);
  if (normalized === "ctr") return "counter";
  if (normalized === "num") return "numeral";
  if (normalized === "pn") return "pronoun";
  if (normalized === "int") return "interjection";
  if (normalized === "adv" || normalized === "adv-to") return "adverb";
  if (normalized.startsWith("adj")) return "adjective";
  if (normalized.startsWith("v")) return "verb";
  if (
    normalized === "pref" ||
    normalized === "suf" ||
    normalized === "n-suf" ||
    normalized === "n-pref" ||
    normalized.startsWith("aux")
  ) {
    return "suffix-prefix-auxiliary";
  }
  if (normalized.startsWith("n")) return "noun-general";
  return null;
};

const PROPER_NOUN_MISC_TAGS = new Set([
  "person",
  "surname",
  "given",
  "place",
  "company",
  "organization",
  "product",
  "group",
  "ship",
  "work",
]);

const mapUnidicPosToClass = (row: Pick<UnidicLexRow, "pos1" | "pos2">): JaPitchAccentPosClass => {
  if (row.pos1 === "動詞") return "verb";
  if (row.pos1 === "形容詞") return "adjective";
  if (row.pos1 === "副詞") return "adverb";
  if (row.pos1 === "感動詞") return "interjection";
  if (row.pos1 === "代名詞") return "pronoun";
  if (row.pos1 === "接頭辞" || row.pos1 === "接尾辞" || row.pos1 === "助動詞") {
    return "suffix-prefix-auxiliary";
  }
  if (row.pos1 === "名詞" && row.pos2 === "固有名詞") return "noun-proper";
  if (row.pos1 === "名詞" && row.pos2 === "数詞") return "numeral";
  if (row.pos1 === "名詞") return "noun-general";
  return "other";
};

const addEntryIdToIndex = (map: Map<string, Set<string>>, key: string, entryId: string) => {
  if (!key) return;
  const existing = map.get(key);
  if (existing) {
    existing.add(entryId);
    return;
  }
  map.set(key, new Set([entryId]));
};

const buildMatchKey = (surfaceForm: string, reading: string) => `${surfaceForm}\u241f${reading}`;

const buildEntryPitchAccentEntry = (word: JaJmdictWord): JaEntryPitchAccentEntry => {
  const entryId = `ja:jmdict:${word.id}`;
  const firstKanji = word.kanji?.[0]?.text ?? null;
  const firstKana = word.kana[0]?.text ?? null;
  const canonicalForm = firstKanji ?? firstKana;
  const forms = new Set<string>();
  const kanaForms = new Set<string>();

  const addForm = (value: string | null | undefined) => {
    const normalized = normalizeOrthographicForm(value);
    if (!normalized) return;
    forms.add(normalized);
    if (isKanaOnly(normalized)) {
      const normalizedKana = normalizeKana(normalized);
      if (normalizedKana) kanaForms.add(normalizedKana);
    }
  };

  addForm(canonicalForm);
  word.kanji?.forEach((kanji) => addForm(kanji.text));
  word.kana.forEach((kana) => addForm(kana.text));

  const posClasses = new Set<JaPitchAccentPosClass>();
  let allowsProperNoun = false;

  for (const sense of word.sense) {
    for (const partOfSpeech of sense.partOfSpeech ?? []) {
      const posClass = mapJmdictPartOfSpeechToClass(partOfSpeech);
      if (posClass) posClasses.add(posClass);
    }
    if ((sense.misc ?? []).some((value) => PROPER_NOUN_MISC_TAGS.has(value))) {
      allowsProperNoun = true;
    }
  }

  if (posClasses.size === 0) {
    posClasses.add("noun-general");
  }

  return {
    entryId,
    canonicalForm,
    canonicalReading: firstKana,
    forms,
    kanaForms,
    posClasses,
    allowsProperNoun,
  };
};

export const createJaEntryPitchAccentIndex = (words: JaJmdictWord[]): JaEntryPitchAccentIndex => {
  const byFormReading = new Map<string, Set<string>>();
  const byReadingReading = new Map<string, Set<string>>();
  const byCanonicalFormReading = new Map<string, Set<string>>();
  const byEntryId = new Map<string, JaEntryPitchAccentEntry>();

  for (const word of words) {
    const entry = buildEntryPitchAccentEntry(word);
    const entryId = entry.entryId;
    const canonicalForm = entry.canonicalForm;
    const firstKana = entry.canonicalReading;

    byEntryId.set(entryId, entry);

    if (canonicalForm && firstKana) {
      addEntryIdToIndex(
        byCanonicalFormReading,
        buildMatchKey(canonicalForm, firstKana),
        entryId,
      );
    }

    for (const kana of word.kana) {
      const reading = kana.text;
      addEntryIdToIndex(byReadingReading, buildMatchKey(reading, reading), entryId);

      const appliesToKanji =
        kana.appliesToKanji && kana.appliesToKanji.length > 0 ? kana.appliesToKanji : ["*"];
      const applicableKanji =
        word.kanji && word.kanji.length > 0
          ? appliesToKanji.includes("*")
            ? word.kanji.map((kanji) => kanji.text)
            : word.kanji
                .filter((kanji) => appliesToKanji.includes(kanji.text))
                .map((kanji) => kanji.text)
          : [];

      for (const formText of applicableKanji) {
        addEntryIdToIndex(byFormReading, buildMatchKey(formText, reading), entryId);
      }
    }
  }

  return {
    byFormReading,
    byReadingReading,
    byCanonicalFormReading,
    byEntryId,
  };
};

const parseUnidicLexRow = (line: string): UnidicLexRow | null => {
  const parts = line.split(",");
  if (parts.length < 33) return null;

  return {
    surface: parts[0] ?? "",
    pos1: parts[4] ?? "",
    pos2: parts[5] ?? "",
    pos3: parts[6] ?? "",
    pos4: parts[7] ?? "",
    lForm: parts[10] ?? "",
    lemma: parts[11] ?? "",
    orthBase: parts[14] ?? "",
    pronBase: parts[15] ?? "",
    kanaBase: parts[25] ?? "",
    rawAccentType: parts[28] ?? "",
    rawAccentConType: parts[29] ?? "",
    rawAccentModType: parts[30] ?? "",
    sourceLexemeId: parts[31] ?? "",
    sourceLemmaId: parts[32] ?? "",
  };
};

const parseAccentNumbers = (rawAccentType: string) => {
  if (!rawAccentType || rawAccentType === "*") return [];

  return rawAccentType
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean)
    .map((value) => {
      if (!/^\d+$/.test(value)) return null;
      return Number.parseInt(value, 10);
    })
    .filter((value): value is number => value !== null);
};

const addSample = <T>(items: T[], nextItem: T, sampleLimit: number) => {
  if (items.length >= sampleLimit) return;
  items.push(nextItem);
};

const matchesEntryOrthography = (
  value: string | null | undefined,
  entry: JaEntryPitchAccentEntry,
) => {
  const normalized = normalizeOrthographicForm(value);
  if (!normalized) {
    return {
      matched: false,
      usedKanaNormalization: false,
    } as const;
  }

  if (entry.forms.has(normalized)) {
    return {
      matched: true,
      usedKanaNormalization: false,
    } as const;
  }

  if (isKanaOnly(normalized)) {
    const normalizedKana = normalizeKana(normalized);
    if (normalizedKana && entry.kanaForms.has(normalizedKana)) {
      return {
        matched: true,
        usedKanaNormalization: true,
      } as const;
    }
  }

  return {
    matched: false,
    usedKanaNormalization: false,
  } as const;
};

const isUnidicPosCompatibleWithEntry = (
  row: Pick<UnidicLexRow, "pos1" | "pos2">,
  entry: JaEntryPitchAccentEntry,
) => {
  const posClass = mapUnidicPosToClass(row);
  if (posClass === "noun-proper") {
    return entry.allowsProperNoun;
  }

  if (posClass === "other" || posClass === "suffix-prefix-auxiliary") {
    return true;
  }

  if (posClass === "noun-general") {
    return entry.posClasses.has("noun-general") || entry.posClasses.has("numeral");
  }

  return entry.posClasses.has(posClass);
};

const getUnidicRowRejectionReasons = ({
  row,
  entry,
}: {
  row: {
    surfaceForm: string;
    reading: string;
    lemma: string | null;
    pos1: string;
    pos2: string;
  };
  entry: JaEntryPitchAccentEntry;
}) => {
  const reasons = new Set<JaPitchAccentRejectionReason>();
  const lemmaMatch = matchesEntryOrthography(row.lemma, entry);
  const surfaceMatch = matchesEntryOrthography(row.surfaceForm, entry);
  const hasDistinctLemma =
    Boolean(row.lemma) && row.lemma !== row.surfaceForm && row.lemma !== row.reading;
  const orthographyCompatible = lemmaMatch.matched || (!hasDistinctLemma && surfaceMatch.matched);

  if (!orthographyCompatible) {
    if (lemmaMatch.usedKanaNormalization || surfaceMatch.usedKanaNormalization) {
      reasons.add("script-mismatch");
    } else {
      reasons.add("lemma-mismatch");
    }
  }

  if (!isUnidicPosCompatibleWithEntry(row, entry)) {
    reasons.add("pos-mismatch");
  }

  return reasons;
};

const addRejectionSamples = ({
  stats,
  row,
  reasons,
  sampleLimit,
}: {
  stats: JaPitchAccentImportStats;
  row: {
    surfaceForm: string;
    reading: string;
    lemma: string | null;
    rawAccentType: string;
    sourceLexemeId: string | null;
    sourceLemmaId: string | null;
  };
  reasons: Set<JaPitchAccentRejectionReason>;
  sampleLimit: number;
}) => {
  const sample = {
    surfaceForm: row.surfaceForm,
    reading: row.reading,
    lemma: row.lemma,
    rawAccentType: row.rawAccentType,
    sourceLexemeId: row.sourceLexemeId,
    sourceLemmaId: row.sourceLemmaId,
  };

  if (reasons.has("lemma-mismatch")) {
    addSample(stats.samples.rejectedLemmaMismatch, sample, sampleLimit);
  }
  if (reasons.has("script-mismatch")) {
    addSample(stats.samples.rejectedScriptMismatch, sample, sampleLimit);
  }
  if (reasons.has("pos-mismatch")) {
    addSample(stats.samples.rejectedPosMismatch, sample, sampleLimit);
  }
};

const resolveDeterministicMatch = (
  row: {
    surfaceForm: string;
    reading: string;
    lemma: string | null;
    rawAccentType: string;
    pos1: string;
    pos2: string;
    sourceLexemeId: string | null;
    sourceLemmaId: string | null;
  },
  index: JaEntryPitchAccentIndex,
  stats: JaPitchAccentImportStats,
  sampleLimit: number,
  options?: {
    validateCandidates?: boolean;
  },
): { entryId: string; matchType: JaPitchAccentMatchType } | null => {
  const validateCandidates = options?.validateCandidates ?? true;
  const matchingStrategies: {
    matchType: JaPitchAccentMatchType;
    statsBucket: "form-reading" | "reading-reading" | "canonical-form-reading";
    candidates: Set<string> | undefined;
  }[] = [
    {
      matchType: "form-reading",
      statsBucket: "form-reading",
      candidates: index.byFormReading.get(buildMatchKey(row.surfaceForm, row.reading)),
    },
    ...(row.lemma && row.lemma !== row.surfaceForm
      ? [
          {
            matchType: "lemma-form-reading" as const,
            statsBucket: "form-reading" as const,
            candidates: index.byFormReading.get(buildMatchKey(row.lemma, row.reading)),
          },
        ]
      : []),
    {
      matchType: "canonical-form-reading",
      statsBucket: "canonical-form-reading",
      candidates: index.byCanonicalFormReading.get(buildMatchKey(row.surfaceForm, row.reading)),
    },
    ...(row.lemma && row.lemma !== row.surfaceForm
      ? [
          {
            matchType: "lemma-canonical-form-reading" as const,
            statsBucket: "canonical-form-reading" as const,
            candidates: index.byCanonicalFormReading.get(buildMatchKey(row.lemma, row.reading)),
          },
        ]
      : []),
    ...((!row.lemma || row.lemma === row.reading || row.lemma === row.surfaceForm)
      ? [
          {
            matchType: "reading-reading" as const,
            statsBucket: "reading-reading" as const,
            candidates: index.byReadingReading.get(buildMatchKey(row.surfaceForm, row.reading)),
          },
        ]
      : []),
  ];

  let foundAnyCandidate = false;
  const rejectionReasons = new Set<JaPitchAccentRejectionReason>();

  for (const strategy of matchingStrategies) {
    const candidateCount = strategy.candidates?.size ?? 0;
    if (candidateCount === 0) continue;
    foundAnyCandidate = true;

    if (candidateCount > 1) {
      if (strategy.statsBucket === "form-reading") stats.ambiguousFormReadingRows += 1;
      if (strategy.statsBucket === "reading-reading") stats.ambiguousReadingRows += 1;
      if (strategy.statsBucket === "canonical-form-reading") stats.ambiguousCanonicalRows += 1;
      addSample(
        stats.samples.ambiguous,
        {
          matchType: strategy.matchType,
          surfaceForm: row.surfaceForm,
          reading: row.reading,
          rawAccentType: row.rawAccentType,
          candidateEntryIds: [...strategy.candidates!].sort(),
        },
        sampleLimit,
      );
    }

    if (!validateCandidates) {
      if (candidateCount === 1) {
        return {
          entryId: [...(strategy.candidates ?? [])][0]!,
          matchType: strategy.matchType,
        };
      }
      return null;
    }

    const compatibleEntryIds: string[] = [];
    for (const entryId of strategy.candidates ?? []) {
      const entry = index.byEntryId.get(entryId);
      if (!entry) continue;
      const candidateReasons = getUnidicRowRejectionReasons({
        row,
        entry,
      });
      if (candidateReasons.size === 0) {
        compatibleEntryIds.push(entryId);
        continue;
      }
      candidateReasons.forEach((reason) => rejectionReasons.add(reason));
    }

    if (compatibleEntryIds.length === 1) {
      return {
        entryId: compatibleEntryIds[0]!,
        matchType: strategy.matchType,
      };
    }

    if (compatibleEntryIds.length > 1) {
      stats.rejectedAmbiguousCompatibleRows += 1;
      addSample(
        stats.samples.ambiguousCompatible,
        {
          matchType: strategy.matchType,
          surfaceForm: row.surfaceForm,
          reading: row.reading,
          lemma: row.lemma,
          rawAccentType: row.rawAccentType,
          candidateEntryIds: compatibleEntryIds.sort(),
        },
        sampleLimit,
      );
      return null;
    }
  }

  if (foundAnyCandidate && rejectionReasons.size > 0) {
    if (rejectionReasons.has("lemma-mismatch")) stats.rejectedLemmaMismatchRows += 1;
    if (rejectionReasons.has("script-mismatch")) stats.rejectedScriptMismatchRows += 1;
    if (rejectionReasons.has("pos-mismatch")) stats.rejectedPosMismatchRows += 1;
    addRejectionSamples({
      stats,
      row,
      reasons: rejectionReasons,
      sampleLimit,
    });
    return null;
  }

  stats.noCandidateRows += 1;
  addSample(
    stats.samples.noCandidate,
    {
      surfaceForm: row.surfaceForm,
      reading: row.reading,
      rawAccentType: row.rawAccentType,
    },
    sampleLimit,
  );
  return null;
};

export const buildJaPitchAccentImport = async ({
  lexPath,
  words,
  dictionaryId,
  sampleLimit = 10,
  collectRows = true,
  coveredEntryIds,
}: {
  lexPath: string;
  words: JaJmdictWord[];
  dictionaryId: string;
  sampleLimit?: number;
  collectRows?: boolean;
  coveredEntryIds?: Set<string>;
}) => {
  const index = createJaEntryPitchAccentIndex(words);
  const rows: JaPitchAccentInsert[] = [];
  const seenVariantKeys = new Set<string>();
  const stats: JaPitchAccentImportStats = {
    totalSourceRows: 0,
    rowsWithoutAccent: 0,
    rowsWithoutHeadword: 0,
    rowsWithAccent: 0,
    matchedRows: 0,
    matchedVariants: 0,
    duplicateVariantsSkipped: 0,
    invalidAccentRows: 0,
    noCandidateRows: 0,
    skippedCoveredEntryRows: 0,
    ambiguousFormReadingRows: 0,
    ambiguousReadingRows: 0,
    ambiguousCanonicalRows: 0,
    rejectedLemmaMismatchRows: 0,
    rejectedScriptMismatchRows: 0,
    rejectedPosMismatchRows: 0,
    rejectedAmbiguousCompatibleRows: 0,
    samples: {
      noCandidate: [],
      ambiguous: [],
      rejectedLemmaMismatch: [],
      rejectedScriptMismatch: [],
      rejectedPosMismatch: [],
      ambiguousCompatible: [],
    },
  };

  const stream = fs.createReadStream(lexPath, { encoding: "utf8" });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  for await (const line of lineReader) {
    lineNumber += 1;
    stats.totalSourceRows += 1;
    const parsedRow = parseUnidicLexRow(line);
    if (!parsedRow) continue;

    if (!parsedRow.rawAccentType || parsedRow.rawAccentType === "*") {
      stats.rowsWithoutAccent += 1;
      continue;
    }

    const surfaceForm =
      normalizeOrthographicForm(
        parsedRow.orthBase && parsedRow.orthBase !== "*" ? parsedRow.orthBase : parsedRow.surface,
      ) ?? "";
    const lemma = normalizeOrthographicForm(parsedRow.lemma);
    const reading = normalizeKana(parsedRow.kanaBase) ?? normalizeKana(parsedRow.lForm);
    if (!surfaceForm || surfaceForm === "*" || !reading) {
      stats.rowsWithoutHeadword += 1;
      continue;
    }

    stats.rowsWithAccent += 1;
    const accentNumbers = parseAccentNumbers(parsedRow.rawAccentType);
    if (accentNumbers.length === 0) {
      stats.invalidAccentRows += 1;
      continue;
    }

    const match = resolveDeterministicMatch(
      {
        surfaceForm,
        reading,
        lemma,
        rawAccentType: parsedRow.rawAccentType,
        pos1: parsedRow.pos1,
        pos2: parsedRow.pos2,
        sourceLexemeId: parsedRow.sourceLexemeId || null,
        sourceLemmaId: parsedRow.sourceLemmaId || null,
      },
      index,
      stats,
      sampleLimit,
      {
        validateCandidates: true,
      },
    );

    if (!match) continue;

    if (coveredEntryIds?.has(match.entryId)) {
      stats.skippedCoveredEntryRows += 1;
      continue;
    }

    stats.matchedRows += 1;

    const pronunciation = normalizeKana(parsedRow.pronBase) ?? reading;
    const moraCount = pronunciation ? countJapaneseMora(pronunciation) : null;
    const sourcePosClass = mapUnidicPosToClass(parsedRow);

    accentNumbers.forEach((accentNumber, accentIndex) => {
      const variantKey = [
        match.entryId,
        surfaceForm,
        reading,
        pronunciation ?? "",
        accentNumber,
        accentIndex + 1,
      ].join("\u241f");

      if (seenVariantKeys.has(variantKey)) {
        stats.duplicateVariantsSkipped += 1;
        return;
      }

      seenVariantKeys.add(variantKey);
      stats.matchedVariants += 1;

      if (!collectRows) return;

      rows.push({
        id: `ja:pitch:${match.entryId}:${parsedRow.sourceLexemeId}:${accentIndex}`,
        entryId: match.entryId,
        dictionaryId,
        surfaceForm,
        reading,
        pronunciation,
        accentNumber,
        accentOrder: accentIndex + 1,
        accentPattern: classifyAccentPattern(accentNumber, moraCount),
        rawAccentType: parsedRow.rawAccentType,
        rawAccentConType:
          parsedRow.rawAccentConType && parsedRow.rawAccentConType !== "*"
            ? parsedRow.rawAccentConType
            : null,
        rawAccentModType:
          parsedRow.rawAccentModType && parsedRow.rawAccentModType !== "*"
            ? parsedRow.rawAccentModType
            : null,
        moraCount,
        sourcePosClass,
        sourceLexemeId: parsedRow.sourceLexemeId || null,
        sourceLemmaId: parsedRow.sourceLemmaId || null,
        sourceLine: lineNumber,
        matchType: match.matchType,
      });
    });
  }

  return { rows, stats };
};

export const buildJaPitchAccentImportFromKanjium = async ({
  accentsPath,
  words,
  dictionaryId,
  sampleLimit = 10,
  collectRows = true,
  coveredEntryIds,
}: {
  accentsPath: string;
  words: JaJmdictWord[];
  dictionaryId: string;
  sampleLimit?: number;
  collectRows?: boolean;
  coveredEntryIds?: Set<string>;
}) => {
  const index = createJaEntryPitchAccentIndex(words);
  const rows: JaPitchAccentInsert[] = [];
  const seenVariantKeys = new Set<string>();
  const stats: JaPitchAccentImportStats = {
    totalSourceRows: 0,
    rowsWithoutAccent: 0,
    rowsWithoutHeadword: 0,
    rowsWithAccent: 0,
    matchedRows: 0,
    matchedVariants: 0,
    duplicateVariantsSkipped: 0,
    invalidAccentRows: 0,
    noCandidateRows: 0,
    skippedCoveredEntryRows: 0,
    ambiguousFormReadingRows: 0,
    ambiguousReadingRows: 0,
    ambiguousCanonicalRows: 0,
    rejectedLemmaMismatchRows: 0,
    rejectedScriptMismatchRows: 0,
    rejectedPosMismatchRows: 0,
    rejectedAmbiguousCompatibleRows: 0,
    samples: {
      noCandidate: [],
      ambiguous: [],
      rejectedLemmaMismatch: [],
      rejectedScriptMismatch: [],
      rejectedPosMismatch: [],
      ambiguousCompatible: [],
    },
  };

  const stream = fs.createReadStream(accentsPath, { encoding: "utf8" });
  const lineReader = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  let lineNumber = 0;
  for await (const line of lineReader) {
    lineNumber += 1;
    stats.totalSourceRows += 1;
    if (!line.trim()) continue;

    const [rawSurfaceForm, rawReading, rawAccentType] = line.split("\t");
    const surfaceForm = rawSurfaceForm?.trim() ?? "";
    const reading = normalizeKana(rawReading?.trim() ?? "");
    const normalizedAccentType = rawAccentType?.trim() ?? "";

    if (!normalizedAccentType) {
      stats.rowsWithoutAccent += 1;
      continue;
    }

    if (!surfaceForm || !reading) {
      stats.rowsWithoutHeadword += 1;
      continue;
    }

    stats.rowsWithAccent += 1;
    const accentNumbers = parseAccentNumbers(normalizedAccentType);
    if (accentNumbers.length === 0) {
      stats.invalidAccentRows += 1;
      continue;
    }

    const match = resolveDeterministicMatch(
      {
        surfaceForm,
        reading,
        lemma: null,
        rawAccentType: normalizedAccentType,
        pos1: "名詞",
        pos2: "一般",
        sourceLexemeId: null,
        sourceLemmaId: null,
      },
      index,
      stats,
      sampleLimit,
      {
        validateCandidates: false,
      },
    );

    if (!match) continue;

    if (coveredEntryIds?.has(match.entryId)) {
      stats.skippedCoveredEntryRows += 1;
      continue;
    }

    stats.matchedRows += 1;

    const pronunciation = reading;
    const moraCount = countJapaneseMora(pronunciation);

    accentNumbers.forEach((accentNumber, accentIndex) => {
      const variantKey = [
        match.entryId,
        surfaceForm,
        reading,
        pronunciation,
        accentNumber,
        accentIndex + 1,
      ].join("\u241f");

      if (seenVariantKeys.has(variantKey)) {
        stats.duplicateVariantsSkipped += 1;
        return;
      }

      seenVariantKeys.add(variantKey);
      stats.matchedVariants += 1;

      if (!collectRows) return;

      rows.push({
        id: `ja:pitch:${match.entryId}:kanjium:${lineNumber}:${accentIndex}`,
        entryId: match.entryId,
        dictionaryId,
        surfaceForm,
        reading,
        pronunciation,
        accentNumber,
        accentOrder: accentIndex + 1,
        accentPattern: classifyAccentPattern(accentNumber, moraCount),
        rawAccentType: normalizedAccentType,
        rawAccentConType: null,
        rawAccentModType: null,
        moraCount,
        sourcePosClass: null,
        sourceLexemeId: null,
        sourceLemmaId: null,
        sourceLine: lineNumber,
        matchType: match.matchType,
      });
    });
  }

  return { rows, stats };
};
