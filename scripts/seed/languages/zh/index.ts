import fs from "fs";
import path from "path";
import { convert } from "pinyin-pro";
import * as OpenCC from "opencc-js";
import * as nodejieba from "nodejieba";
import { loadNormalizedData } from "@/scripts/seed/core/load";
import type {
  LanguageSeeder,
  LoadReport,
  NormalizedSeedData,
  SeedContext,
  SeedDictionary,
  ValidationReport,
} from "@/scripts/seed/core/types";

const ZH_LANGUAGE_ID = "lang_zh";
const CEDICT_FILE = "cedict_ts.u8";
const RANK_FREQ_FILE = "rank_freq.json";
const DECOMPOSITION_FILE = "wikimedia-decomposition.tsv";
const VARIANTS_FILE = "CEDICT_variants_list_with_ratings.json";
const EXAMPLES_FILE = "example-chm-en.tsv";
const HSK_DIR = "hsk";
const HSK_HANZI_FILE = "hanzi.csv";
const SVGS_HANS_DIR = "assets/svgsZhHans";
const SVGS_HANT_DIR = "assets/svgsZhHant";
const SVGS_SPECIAL_DIR = "assets/svgsZhHansSpecial";
const HSK_SENTENCE_TOLERANCE = 1;

type FrequencyRow = {
  key: string;
  rank: number;
};

type RatedVariant = {
  simplified: string;
  traditional: string;
  definitions: string;
  pronunciation: string;
  variantRating: number;
};

type VariantRatingsFile = {
  variants: RatedVariant[];
}[];

type ParsedZhEntry = {
  id: string;
  simplified: string;
  traditional: string;
  pronunciation: string;
  definitions: string[];
  frequencyRank: number | null;
  hsk: string | null;
  decompositionData: string | null;
  svgSimplified: string | null;
  svgTraditional: string | null;
  svgSpecial: string | null;
  variantRating: number | null;
  matchedCharacterHsk: string | null;
};

type ExampleVariant = {
  id: string;
  tsvId: number;
  english: string;
  simplified: string;
  traditional: string;
  hsk: string | null;
};

type ZhExtracted = {
  cedictLines: string[];
  frequencyRankByWord: Record<string, number>;
  hskByWord: Record<string, string>;
  hskByCharacterPronunciation: Record<string, Record<string, string>>;
  decompositionByCharacter: Record<string, string>;
  variantRatings: VariantRatingsFile;
  exampleRows: string[][];
  svgPaths: {
    simplified: string;
    traditional: string;
    special: string;
  };
};

const cleanKey = (value: string) => value.replace(/^\uFEFF/, "").trim();

const readText = (filePath: string) => fs.readFileSync(filePath, "utf8");

const readLines = (filePath: string) =>
  readText(filePath)
    .split("\n")
    .map((line) => cleanKey(line))
    .filter(Boolean);

const extractCharacters = (value: string) => Array.from(value);

const buildCedictEntryId = (lineIndex: number) => `zh:cedict:${lineIndex}`;

const buildSenseId = (entryId: string, senseIndex: number) =>
  `${entryId}:sense:${senseIndex}`;

const buildGlossId = (entryId: string, senseIndex: number, glossIndex: number) =>
  `${entryId}:gloss:${senseIndex}:${glossIndex}`;

const buildEntryLookupKey = (
  simplified: string,
  pronunciation: string,
  definitions: string[],
) => `${simplified}\u241f${pronunciation}\u241f${definitions.join("\n")}`;

const buildRatedVariantLookupKey = (variant: RatedVariant) =>
  buildEntryLookupKey(
    cleanKey(variant.simplified),
    cleanKey(variant.pronunciation).toLowerCase(),
    cleanKey(variant.definitions)
      .split("\n")
      .map((definition) => definition.trim())
      .filter(Boolean),
  );

const parseCedictLine = (line: string): Omit<
  ParsedZhEntry,
  | "id"
  | "frequencyRank"
  | "hsk"
  | "decompositionData"
  | "svgSimplified"
  | "svgTraditional"
  | "svgSpecial"
  | "variantRating"
  | "matchedCharacterHsk"
> | null => {
  const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/);
  if (!match) return null;

  const [, traditional, simplified, pronunciation, rawDefinitions] = match;
  const definitions = rawDefinitions
    .split("/")
    .map((definition) => definition.trim())
    .filter(Boolean);

  if (definitions.length === 0) return null;

  return {
    simplified,
    traditional,
    pronunciation: pronunciation.replaceAll("u:", "v").trim().toLowerCase(),
    definitions,
  };
};

const buildHskWordLookup = (resourcesDir: string) => {
  const hskByWord: Record<string, string> = {};

  for (let level = 1; level <= 6; level += 1) {
    const filePath = path.join(resourcesDir, HSK_DIR, `hsk-${level}.txt`);
    for (const word of readLines(filePath)) {
      hskByWord[word] = `${level}`;
    }
  }

  for (const word of readLines(path.join(resourcesDir, HSK_DIR, "hsk-7-9.txt"))) {
    hskByWord[word] = "7-9";
  }

  return hskByWord;
};

const buildFrequencyLookup = (resourcesDir: string) => {
  const rows = JSON.parse(
    readText(path.join(resourcesDir, RANK_FREQ_FILE)),
  ) as FrequencyRow[];

  return rows.reduce<Record<string, number>>((acc, row) => {
    acc[cleanKey(row.key)] = row.rank + 1;
    return acc;
  }, {});
};

const buildDecompositionLookup = (resourcesDir: string) => {
  const lines = readLines(path.join(resourcesDir, DECOMPOSITION_FILE));
  const result: Record<string, string> = {};

  for (const line of lines.slice(1)) {
    const [
      component,
      strokes,
      compositionType,
      leftComponent,
      leftStrokes,
      rightComponent,
      rightStrokes,
      signature,
      notes,
      section,
    ] = line.split("\t");

    if (!component) continue;

    result[component] = JSON.stringify({
      strokes: Number(strokes),
      compositionType,
      leftComponent,
      leftStrokes: Number(leftStrokes),
      rightComponent,
      rightStrokes: Number(rightStrokes),
      signature,
      notes,
      section,
    });
  }

  return result;
};

const buildHskCharacterLookup = (resourcesDir: string) => {
  const rows = readLines(path.join(resourcesDir, HSK_DIR, HSK_HANZI_FILE))
    .slice(1)
    .map((line) => line.split(","));

  const levelMap: Record<string, string> = {
    一级: "1",
    二级: "2",
    三级: "3",
    四级: "4",
    五级: "5",
    六级: "6",
    高等: "7-9",
  };

  const lookup: Record<string, Record<string, string>> = {};

  for (const row of rows) {
    if (row.length < 4) continue;
    const level = levelMap[row[1] ?? ""];
    const character = row[2];
    const pinyinMarked = row[3];
    if (!level || !character || !pinyinMarked) continue;

    const normalizedPronunciation = convert(pinyinMarked, {
      format: "symbolToNum",
    })
      .replace("0", "5")
      .replace("ü", "v")
      .toLowerCase();

    if (!lookup[character]) {
      lookup[character] = {};
    }

    lookup[character][normalizedPronunciation] = level;
  }

  return lookup;
};

const maybeReadSvg = (dirPath: string, character: string) => {
  const codePoint = character.codePointAt(0);
  if (!codePoint) return null;
  const filePath = path.join(dirPath, `${codePoint}.svg`);
  if (!fs.existsSync(filePath)) return null;
  return readText(filePath);
};

const getExamplesMap = (
  exampleRows: string[][],
  hskByWord: Record<string, string>,
): {
  wordToExampleIds: Record<string, number[]>;
  examplesByTsvId: Record<string, ExampleVariant[]>;
} => {
  const toSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
  const toTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

  const examplesByTsvId: Record<string, ExampleVariant[]> = {};
  const wordToExampleIds: Record<string, number[]> = {};

  for (const row of exampleRows) {
    if (row.length < 4) continue;

    const tsvId = parseInt(cleanKey(row[0] ?? ""), 10);
    const chineseRaw = cleanKey(row[1] ?? "");
    const english = cleanKey(row[3] ?? "");

    if (Number.isNaN(tsvId) || !chineseRaw || !english) continue;

    const tsvKey = `${tsvId}`;
    const simplified = toSimplified(chineseRaw);
    const traditional = toTraditional(simplified);

    const currentVariant: ExampleVariant = {
      id: `zh:example:${tsvId}:${examplesByTsvId[tsvKey]?.length ?? 0}`,
      tsvId,
      english,
      simplified,
      traditional,
      hsk: null,
    };

    if (!examplesByTsvId[tsvKey]) {
      examplesByTsvId[tsvKey] = [currentVariant];

      const taggedWords = nodejieba
        .tag(simplified)
        .filter((segment) => segment.tag !== "x" && /^[\u4e00-\u9fff]+$/.test(segment.word))
        .map((segment) => segment.word);

      const uniqueWords = new Set(taggedWords);
      let sentenceHsk: string | null = null;
      let maxLevelValue = 0;
      let nonHskCount = 0;

      for (const word of uniqueWords) {
        if (!wordToExampleIds[word]) {
          wordToExampleIds[word] = [];
        }
        wordToExampleIds[word].push(tsvId);

        const level = hskByWord[word] ?? null;
        if (!level) {
          nonHskCount += 1;
          continue;
        }

        const levelValue = parseInt(level.split("-")[0] ?? level, 10);
        if (levelValue > maxLevelValue) {
          maxLevelValue = levelValue;
          sentenceHsk = level;
        }
      }

      if (sentenceHsk !== null && nonHskCount <= HSK_SENTENCE_TOLERANCE) {
        currentVariant.hsk = sentenceHsk;
      }
    } else {
      currentVariant.hsk = examplesByTsvId[tsvKey][0]?.hsk ?? null;
      examplesByTsvId[tsvKey].push(currentVariant);
    }
  }

  return { wordToExampleIds, examplesByTsvId };
};

const sortZhGroup = (entries: ParsedZhEntry[]) => {
  entries.sort((a, b) => {
    if (a.matchedCharacterHsk === null && b.matchedCharacterHsk !== null) return 1;
    if (a.matchedCharacterHsk !== null && b.matchedCharacterHsk === null) return -1;

    if (a.matchedCharacterHsk && b.matchedCharacterHsk) {
      const aLevel = parseInt(a.matchedCharacterHsk.split("-")[0] ?? a.matchedCharacterHsk, 10);
      const bLevel = parseInt(b.matchedCharacterHsk.split("-")[0] ?? b.matchedCharacterHsk, 10);
      if (aLevel !== bLevel) return aLevel - bLevel;
    }

    const aRating = a.variantRating ?? -1;
    const bRating = b.variantRating ?? -1;
    if (aRating !== bRating) return bRating - aRating;

    const definitionDiff = b.definitions.join("\n").length - a.definitions.join("\n").length;
    if (definitionDiff !== 0) return definitionDiff;

    return a.pronunciation.localeCompare(b.pronunciation);
  });
};

export const zhSeeder: LanguageSeeder<ZhExtracted> = {
  languageCode: "zh",

  async dictionaries(): Promise<SeedDictionary[]> {
    return [
      {
        id: "dict_cedict",
        languageId: ZH_LANGUAGE_ID,
        slug: "cedict",
        name: "CC-CEDICT",
        sourceType: "dictionary",
        sourceUrl: "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
        seedModule: "zh",
      },
    ];
  },

  async prepare(ctx) {
    const requiredFiles = [
      path.join(ctx.resourcesDir, CEDICT_FILE),
      path.join(ctx.resourcesDir, RANK_FREQ_FILE),
      path.join(ctx.resourcesDir, DECOMPOSITION_FILE),
      path.join(ctx.resourcesDir, VARIANTS_FILE),
      path.join(ctx.resourcesDir, EXAMPLES_FILE),
      path.join(ctx.resourcesDir, HSK_DIR, "hsk-1.txt"),
      path.join(ctx.resourcesDir, HSK_DIR, "hsk-7-9.txt"),
      path.join(ctx.resourcesDir, HSK_DIR, HSK_HANZI_FILE),
    ];

    for (const filePath of requiredFiles) {
      if (!fs.existsSync(filePath)) {
        throw new Error(`Missing Chinese seed file: ${filePath}`);
      }
    }

    const requiredSvgDirs = [
      path.join(ctx.rootDir, SVGS_HANS_DIR),
      path.join(ctx.rootDir, SVGS_HANT_DIR),
      path.join(ctx.rootDir, SVGS_SPECIAL_DIR),
    ];

    for (const dirPath of requiredSvgDirs) {
      if (!fs.existsSync(dirPath)) {
        throw new Error(`Missing Chinese SVG directory: ${dirPath}`);
      }
    }

    ctx.logger.info("preparing zh seeder");
  },

  async extract(ctx) {
    ctx.logger.info("extracting zh source files");

    return {
      cedictLines: readLines(path.join(ctx.resourcesDir, CEDICT_FILE)),
      frequencyRankByWord: buildFrequencyLookup(ctx.resourcesDir),
      hskByWord: buildHskWordLookup(ctx.resourcesDir),
      hskByCharacterPronunciation: buildHskCharacterLookup(ctx.resourcesDir),
      decompositionByCharacter: buildDecompositionLookup(ctx.resourcesDir),
      variantRatings: JSON.parse(
        readText(path.join(ctx.resourcesDir, VARIANTS_FILE)),
      ) as VariantRatingsFile,
      exampleRows: readText(path.join(ctx.resourcesDir, EXAMPLES_FILE))
        .split("\n")
        .map((line) => line.split("\t")),
      svgPaths: {
        simplified: path.join(ctx.rootDir, SVGS_HANS_DIR),
        traditional: path.join(ctx.rootDir, SVGS_HANT_DIR),
        special: path.join(ctx.rootDir, SVGS_SPECIAL_DIR),
      },
    };
  },

  async validate(payload): Promise<ValidationReport> {
    const warnings: string[] = [];

    if (payload.cedictLines.length === 0) {
      warnings.push("CEDICT source file is empty.");
    }
    if (payload.exampleRows.length === 0) {
      warnings.push("Chinese example source file is empty.");
    }

    return {
      valid: payload.cedictLines.length > 0,
      warnings,
      counts: {
        cedictLines: payload.cedictLines.length,
        rankedWords: Object.keys(payload.frequencyRankByWord).length,
        hskWords: Object.keys(payload.hskByWord).length,
        hskCharacters: Object.keys(payload.hskByCharacterPronunciation).length,
        decompositionCharacters: Object.keys(payload.decompositionByCharacter).length,
        variantGroups: payload.variantRatings.length,
        exampleRows: payload.exampleRows.length,
      },
    };
  },

  async transform(payload, ctx): Promise<NormalizedSeedData> {
    ctx.logger.info("transforming zh source data");

    const parsedEntriesByWord = new Map<string, ParsedZhEntry[]>();
    const parsedEntriesByLookupKey = new Map<string, ParsedZhEntry>();

    payload.cedictLines.forEach((line, lineIndex) => {
      if (line.startsWith("#")) return;

      const parsed = parseCedictLine(line);
      if (!parsed) return;

      const lookupKey = buildEntryLookupKey(
        parsed.simplified,
        parsed.pronunciation,
        parsed.definitions,
      );

      if (parsedEntriesByLookupKey.has(lookupKey)) return;

      const isSingleCharacter = extractCharacters(parsed.simplified).length === 1;
      const entry: ParsedZhEntry = {
        id: buildCedictEntryId(lineIndex),
        simplified: parsed.simplified,
        traditional: parsed.traditional,
        pronunciation: parsed.pronunciation,
        definitions: parsed.definitions,
        frequencyRank: payload.frequencyRankByWord[parsed.simplified] ?? null,
        hsk: payload.hskByWord[parsed.simplified] ?? null,
        decompositionData: isSingleCharacter
          ? payload.decompositionByCharacter[parsed.simplified] ?? null
          : null,
        svgSimplified: isSingleCharacter
          ? maybeReadSvg(payload.svgPaths.simplified, parsed.simplified)
          : null,
        svgTraditional: isSingleCharacter
          ? maybeReadSvg(payload.svgPaths.traditional, parsed.simplified)
          : null,
        svgSpecial: isSingleCharacter
          ? maybeReadSvg(payload.svgPaths.special, parsed.simplified)
          : null,
        variantRating: null,
        matchedCharacterHsk: null,
      };

      parsedEntriesByLookupKey.set(lookupKey, entry);

      if (!parsedEntriesByWord.has(entry.simplified)) {
        parsedEntriesByWord.set(entry.simplified, []);
      }
      parsedEntriesByWord.get(entry.simplified)?.push(entry);
    });

    payload.variantRatings.forEach((group) => {
      group.variants.forEach((variant) => {
        const match = parsedEntriesByLookupKey.get(buildRatedVariantLookupKey(variant));
        if (match) {
          match.variantRating = variant.variantRating;
        }
      });
    });

    const entries: NonNullable<NormalizedSeedData["entries"]> = [];
    const entryForms: NonNullable<NormalizedSeedData["entryForms"]> = [];
    const entryReadings: NonNullable<NormalizedSeedData["entryReadings"]> = [];
    const entrySenses: NonNullable<NormalizedSeedData["entrySenses"]> = [];
    const senseGlosses: NonNullable<NormalizedSeedData["senseGlosses"]> = [];
    const entryRelations: NonNullable<NormalizedSeedData["entryRelations"]> = [];
    const zhEntryData: NonNullable<NormalizedSeedData["zhEntryData"]> = [];
    const zhCharacterDataMap = new Map<
      string,
      NonNullable<NormalizedSeedData["zhCharacterData"]>[number]
    >();
    const canonicalFormByEntryId = new Map<string, string>();
    const wordToEntryIds: Record<string, string[]> = {};

    const groupedEntries = Array.from(parsedEntriesByWord.values());

    for (const group of groupedEntries) {
      if (group.length === 0) continue;

      const simplified = group[0].simplified;
      const isSingleCharacter = extractCharacters(simplified).length === 1;

      if (isSingleCharacter) {
        const pronunciationLookup =
          payload.hskByCharacterPronunciation[simplified] ?? {};
        group.forEach((entry) => {
          entry.matchedCharacterHsk = pronunciationLookup[entry.pronunciation] ?? null;
        });
      }

      sortZhGroup(group);

      const primaryEntry = group[0];
      wordToEntryIds[simplified] = group.map((entry) => entry.id);

      group.forEach((entry, groupIndex) => {
        const isPrimary = groupIndex === 0;
        const frequencyRank = isPrimary ? entry.frequencyRank : null;
        const hsk = isSingleCharacter ? entry.matchedCharacterHsk : entry.hsk;
        const canonicalForm = entry.simplified;

        entries.push({
          id: entry.id,
          languageId: ZH_LANGUAGE_ID,
          dictionaryId: "dict_cedict",
          entryType: isSingleCharacter ? "character" : "word",
          canonicalForm,
          canonicalReading: entry.pronunciation,
          status: "active",
          sourceEntryId: entry.id,
        });
        canonicalFormByEntryId.set(entry.id, canonicalForm);

        entryForms.push({
          id: `${entry.id}:form:hans`,
          entryId: entry.id,
          text: entry.simplified,
          script: "Hans",
          formType: "headword",
          isPrimary: true,
          isCommon: frequencyRank !== null,
          rawRank: frequencyRank,
        });

        if (entry.traditional !== entry.simplified) {
          entryForms.push({
            id: `${entry.id}:form:hant`,
            entryId: entry.id,
            text: entry.traditional,
            script: "Hant",
            formType: "headword",
            isPrimary: false,
            isCommon: frequencyRank !== null,
            rawRank: frequencyRank,
          });
        }

        entryReadings.push({
          id: `${entry.id}:reading:pinyin_numeric`,
          entryId: entry.id,
          text: entry.pronunciation,
          system: "pinyin_numeric",
          script: "Latn",
          isPrimary: true,
          isCommon: frequencyRank !== null,
          rawRank: frequencyRank,
        });

        entry.definitions.forEach((definition, senseIndex) => {
          const senseId = buildSenseId(entry.id, senseIndex);
          entrySenses.push({
            id: senseId,
            entryId: entry.id,
            senseOrder: senseIndex + 1,
          });
          senseGlosses.push({
            id: buildGlossId(entry.id, senseIndex, 0),
            senseId,
            glossLanguage: "eng",
            glossOrder: 1,
            text: definition,
          });
        });

        zhEntryData.push({
          entryId: entry.id,
          hsk,
          frequencyRank,
          variantRank: entry.variantRating,
          decompositionData: entry.decompositionData,
          strokeAssetId:
            isSingleCharacter && entry.simplified.codePointAt(0)
              ? `zh-char:${entry.simplified.codePointAt(0)}`
              : null,
        });

        if (!isPrimary) {
          entryRelations.push({
            id: `${entry.id}:relation:variant_of`,
            entryId: entry.id,
            relatedEntryId: primaryEntry.id,
            relationType: "variant_of",
            relationOrder: entry.variantRating,
          });
        }

        if (isSingleCharacter) {
          const existing = zhCharacterDataMap.get(entry.simplified);
          const nextFrequencyRank = existing?.frequencyRank ?? frequencyRank;
          zhCharacterDataMap.set(entry.simplified, {
            character: entry.simplified,
            decompositionData: existing?.decompositionData ?? entry.decompositionData,
            frequencyRank:
              nextFrequencyRank !== null && frequencyRank !== null
                ? Math.min(nextFrequencyRank, frequencyRank)
                : (nextFrequencyRank ?? frequencyRank),
            hsk: existing?.hsk ?? hsk,
            svgSimplified: existing?.svgSimplified ?? entry.svgSimplified,
            svgTraditional: existing?.svgTraditional ?? entry.svgTraditional,
            svgSpecial: existing?.svgSpecial ?? entry.svgSpecial,
          });
        }
      });
    }

    const primaryEntries = zhEntryData.filter((row) => row.frequencyRank !== null);
    primaryEntries
      .sort(
        (a, b) =>
          (payload.frequencyRankByWord[
            canonicalFormByEntryId.get(a.entryId) ?? ""
          ] ?? Number.MAX_SAFE_INTEGER) -
          (payload.frequencyRankByWord[
            canonicalFormByEntryId.get(b.entryId) ?? ""
          ] ?? Number.MAX_SAFE_INTEGER),
      )
      .forEach((row, index) => {
        row.frequencyRank = index + 1;
      });

    const { wordToExampleIds, examplesByTsvId } = getExamplesMap(
      payload.exampleRows,
      payload.hskByWord,
    );

    const examples: NonNullable<NormalizedSeedData["examples"]> = [];
    const exampleTranslations: NonNullable<NormalizedSeedData["exampleTranslations"]> = [];
    const entryExamples: NonNullable<NormalizedSeedData["entryExamples"]> = [];
    const linkedExamplePairs = new Set<string>();

    Object.entries(examplesByTsvId).forEach(([tsvId, variants]) => {
      variants.forEach((variant, variantIndex) => {
        const exampleId = `zh:example:${tsvId}:${variantIndex}`;
        examples.push({
          id: exampleId,
          languageId: ZH_LANGUAGE_ID,
          text: variant.simplified,
          textNormalized: variant.simplified,
          translationGroupId: `zh:example:${tsvId}`,
          sourceType: "chm_example",
          sourceRef: tsvId,
          difficultyBand: variant.hsk,
        });

        exampleTranslations.push({
          id: `${exampleId}:translation:eng`,
          exampleId,
          languageCode: "eng",
          text: variant.english,
          translationOrder: 1,
        });
      });
    });

    Object.entries(wordToExampleIds).forEach(([word, tsvIds]) => {
      const entryIds = wordToEntryIds[word];
      if (!entryIds?.length) return;

      const uniqueTsvIds = Array.from(new Set(tsvIds));
      uniqueTsvIds.forEach((tsvId) => {
        const variants = examplesByTsvId[`${tsvId}`];
        if (!variants?.length) return;

        entryIds.forEach((entryId) => {
          variants.forEach((_, variantIndex) => {
            const exampleId = `zh:example:${tsvId}:${variantIndex}`;
            const pairKey = `${entryId}\u241f${exampleId}`;
            if (linkedExamplePairs.has(pairKey)) return;
            linkedExamplePairs.add(pairKey);

            entryExamples.push({
              id: `${entryId}:example:${exampleId}`,
              entryId,
              senseId: null,
              exampleId,
              relationType: "example",
            });
          });
        });
      });
    });

    return {
      languages: [
        {
          id: ZH_LANGUAGE_ID,
          code: "zh",
          name: "Chinese",
          defaultGlossLanguage: "eng",
          isEnabled: true,
        },
      ],
      dictionaries: [
        {
          id: "dict_cedict",
          languageId: ZH_LANGUAGE_ID,
          slug: "cedict",
          name: "CC-CEDICT",
          sourceType: "dictionary",
          sourceUrl: "https://www.mdbg.net/chinese/dictionary?page=cc-cedict",
          license: "CC BY-SA 4.0",
          seedModule: "zh",
        },
      ],
      entries,
      entryForms,
      entryReadings,
      entrySenses,
      senseGlosses,
      entryRelations,
      examples,
      exampleTranslations,
      entryExamples,
      zhEntryData,
      zhCharacterData: Array.from(zhCharacterDataMap.values()),
    };
  },

  async load(data, ctx): Promise<LoadReport> {
    const counts = await loadNormalizedData(data, ctx);
    return { counts };
  },

  async postProcess(ctx) {
    ctx.logger.info("post processing zh seed");
  },
};
