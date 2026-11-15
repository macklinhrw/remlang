import fs from "fs";
import path from "path";
import { loadNormalizedData } from "@/scripts/seed/core/load";
import type {
  LanguageSeeder,
  LoadReport,
  NormalizedSeedData,
  SeedContext,
  SeedDictionary,
  ValidationReport,
} from "@/scripts/seed/core/types";
import {
  buildJaPitchAccentImport,
  buildJaPitchAccentImportFromKanjium,
  getKanjiumPaths,
  getUnidicCwjPaths,
  type JaJmdictWord,
  KANJIUM_BASE_URL,
  UNIDIC_CWJ_BASE_URL,
  UNIDIC_CWJ_VERSION,
} from "./pitchAccent";

const JA_LANGUAGE_ID = "lang_ja";
const JM_DICT_FILE = "jmdict-eng-3.6.2.json";
const JM_DICT_EXAMPLES_FILE = "jmdict-examples-eng-3.6.2.json";
const KANJIDIC_FILE = "kanjidic2-en-3.6.2.json";
const KRADFILE_FILE = "kradfile-3.6.2.json";
const RADKFILE_FILE = "radkfile-3.6.2.json";
const TUBELEX_FILE = "tubelex-ja-310.tsv";
const ANIM_CJK_DIR = "animCJK";
const ANIM_CJK_SVGS_JA_DIR = "svgsJa";
const TUBELEX_DIR = "tubelex";
const JM_DICT_ID = "dict_jmdict_eng";
const KANJIDIC_ID = "dict_kanjidic2_en";
const KRADFILE_ID = "dict_kradfile";
const RADKFILE_ID = "dict_radkfile";
const TUBELEX_ID = "dict_tubelex_ja";
const UNIDIC_ID = "dict_unidic_cwj";
const KANJIUM_ID = "dict_kanjium_pitch";

type KanjidicCharacter = {
  literal: string;
  misc?: {
    grade?: number;
    strokeCounts?: number[];
    frequency?: number;
    jlptLevel?: number;
  };
  radicals?: { type: string; value: number }[];
  readingMeaning?: {
    groups?: {
      readings?: { type: string; value: string }[];
      meanings?: { lang: string; value: string }[];
    }[];
  };
};

type JaExtracted = {
  jmdict: { version: string; dictDate: string; words: JaJmdictWord[] };
  jmdictExamples: { version: string; dictDate: string; words: JaJmdictWord[] };
  kanjidic: { version: string; dictDate: string; characters: KanjidicCharacter[] };
  kradfile: { version: string; kanji: Record<string, string[]> };
  radkfile: {
    version: string;
    radicals: Record<string, { strokeCount?: number; code?: string | null; kanji: string[] }>;
  };
  svgByCharacter: Record<string, string>;
  tubelexFrequencyByWord: Record<
    string,
    {
      rank: number;
      count: number;
      videos: number;
      channels: number;
    }
  >;
  unidic: {
    version: string;
    lexCsvPath: string;
  };
  kanjium: {
    accentsPath: string;
  };
};

const readJson = <T>(filePath: string) =>
  JSON.parse(fs.readFileSync(filePath, "utf8")) as T;

const readText = (filePath: string) => fs.readFileSync(filePath, "utf8");

const stringifyOrNull = (value: unknown) =>
  value === undefined || value === null ? null : JSON.stringify(value);

const firstDefined = <T>(...values: (T | undefined | null)[]) =>
  values.find((value) => value !== undefined && value !== null) ?? null;

const buildSvgLookup = (svgDir: string) => {
  const lookup: Record<string, string> = {};
  const files = fs.readdirSync(svgDir).filter((file) => file.endsWith(".svg"));

  for (const fileName of files) {
    const codePoint = Number(path.basename(fileName, ".svg"));
    if (!Number.isFinite(codePoint)) continue;
    lookup[String.fromCodePoint(codePoint)] = fs.readFileSync(
      path.join(svgDir, fileName),
      "utf8",
    );
  }

  return lookup;
};

const buildTubelexLookup = (filePath: string) => {
  const lookup: Record<
    string,
    {
      rank: number;
      count: number;
      videos: number;
      channels: number;
    }
  > = {};
  const rows = readText(filePath).split(/\r?\n/);
  let rank = 0;

  for (const row of rows) {
    if (!row || row.startsWith("word\t")) continue;
    const [word, count, videos, channels] = row.split("\t");
    if (!word || word === "[TOTAL]" || lookup[word]) continue;
    rank += 1;
    lookup[word] = {
      rank,
      count: Number.parseInt(count ?? "0", 10) || 0,
      videos: Number.parseInt(videos ?? "0", 10) || 0,
      channels: Number.parseInt(channels ?? "0", 10) || 0,
    };
  }

  return lookup;
};

const getBestTubelexMatch = (
  word: JaJmdictWord,
  frequencyByWord: JaExtracted["tubelexFrequencyByWord"],
) => {
  const candidates = new Set<string>();
  word.kanji?.forEach((kanji) => {
    if (kanji.text) candidates.add(kanji.text);
  });
  word.kana.forEach((kana) => {
    if (kana.text) candidates.add(kana.text);
  });

  let bestMatch: JaExtracted["tubelexFrequencyByWord"][string] | null = null;
  for (const candidate of candidates) {
    const current = frequencyByWord[candidate];
    if (!current) continue;
    if (!bestMatch || current.rank < bestMatch.rank) {
      bestMatch = current;
    }
  }

  return bestMatch;
};

export const jaSeeder: LanguageSeeder<JaExtracted> = {
  languageCode: "ja",

  async dictionaries(): Promise<SeedDictionary[]> {
    return [
      {
        id: JM_DICT_ID,
        languageId: JA_LANGUAGE_ID,
        slug: "jmdict-eng",
        name: "JMdict English",
        sourceType: "dictionary",
        sourceUrl: "https://github.com/scriptin/jmdict-simplified",
        seedModule: "ja",
      },
      {
        id: KANJIDIC_ID,
        languageId: JA_LANGUAGE_ID,
        slug: "kanjidic2-en",
        name: "Kanjidic2 English",
        sourceType: "kanji_dictionary",
        sourceUrl: "https://github.com/scriptin/jmdict-simplified",
        seedModule: "ja",
      },
      {
        id: KRADFILE_ID,
        languageId: JA_LANGUAGE_ID,
        slug: "kradfile",
        name: "Kradfile",
        sourceType: "character_components",
        sourceUrl: "https://github.com/scriptin/jmdict-simplified",
        seedModule: "ja",
      },
      {
        id: RADKFILE_ID,
        languageId: JA_LANGUAGE_ID,
        slug: "radkfile",
        name: "Radkfile",
        sourceType: "radical_index",
        sourceUrl: "https://github.com/scriptin/jmdict-simplified",
        seedModule: "ja",
      },
      {
        id: TUBELEX_ID,
        languageId: JA_LANGUAGE_ID,
        slug: "tubelex-ja-310",
        name: "TUBELEX Japanese",
        sourceType: "frequency_corpus",
        sourceUrl: "https://github.com/naist-nlp/tubelex",
        seedModule: "ja",
      },
      {
        id: UNIDIC_ID,
        languageId: JA_LANGUAGE_ID,
        slug: "unidic-cwj-3.1.1",
        name: "UniDic Contemporary Written Japanese",
        sourceType: "morphological_dictionary",
        sourceUrl: UNIDIC_CWJ_BASE_URL,
        seedModule: "ja",
      },
      {
        id: KANJIUM_ID,
        languageId: JA_LANGUAGE_ID,
        slug: "kanjium-pitch",
        name: "Kanjium Pitch Accent",
        sourceType: "pitch_accent_dictionary",
        sourceUrl: KANJIUM_BASE_URL,
        seedModule: "ja",
      },
    ];
  },

  async prepare(ctx) {
    const dictionaryDir = path.join(ctx.resourcesDir, "jmdict-simplified");
    const requiredFiles = [
      JM_DICT_FILE,
      JM_DICT_EXAMPLES_FILE,
      KANJIDIC_FILE,
      KRADFILE_FILE,
      RADKFILE_FILE,
    ];
    for (const fileName of requiredFiles) {
      const fullPath = path.join(dictionaryDir, fileName);
      if (!fs.existsSync(fullPath)) {
        throw new Error(`Missing Japanese seed file: ${fullPath}`);
      }
    }
    const svgDir = path.join(ctx.resourcesDir, ANIM_CJK_DIR, ANIM_CJK_SVGS_JA_DIR);
    if (!fs.existsSync(svgDir)) {
      throw new Error(`Missing Japanese SVG directory: ${svgDir}`);
    }
    const tubelexPath = path.join(ctx.resourcesDir, TUBELEX_DIR, TUBELEX_FILE);
    if (!fs.existsSync(tubelexPath)) {
      throw new Error(`Missing Japanese frequency file: ${tubelexPath}`);
    }
    const unidicPaths = getUnidicCwjPaths(ctx.resourcesDir);
    if (!fs.existsSync(unidicPaths.lexCsvPath)) {
      throw new Error(`Missing UniDic pitch accent file: ${unidicPaths.lexCsvPath}`);
    }
    if (!fs.existsSync(unidicPaths.bsdLicensePath)) {
      throw new Error(`Missing UniDic BSD license file: ${unidicPaths.bsdLicensePath}`);
    }
    const kanjiumPaths = getKanjiumPaths(ctx.resourcesDir);
    if (!fs.existsSync(kanjiumPaths.accentsPath)) {
      throw new Error(`Missing Kanjium accents file: ${kanjiumPaths.accentsPath}`);
    }
    if (!fs.existsSync(kanjiumPaths.licensePath)) {
      throw new Error(`Missing Kanjium license file: ${kanjiumPaths.licensePath}`);
    }
    ctx.logger.info("preparing ja seeder");
  },

  async extract(ctx) {
    ctx.logger.info("extracting ja source files");
    const dictionaryDir = path.join(ctx.resourcesDir, "jmdict-simplified");
    const svgDir = path.join(ctx.resourcesDir, ANIM_CJK_DIR, ANIM_CJK_SVGS_JA_DIR);
    const tubelexPath = path.join(ctx.resourcesDir, TUBELEX_DIR, TUBELEX_FILE);
    const unidicPaths = getUnidicCwjPaths(ctx.resourcesDir);
    const kanjiumPaths = getKanjiumPaths(ctx.resourcesDir);
    return {
      jmdict: readJson(path.join(dictionaryDir, JM_DICT_FILE)),
      jmdictExamples: readJson(path.join(dictionaryDir, JM_DICT_EXAMPLES_FILE)),
      kanjidic: readJson(path.join(dictionaryDir, KANJIDIC_FILE)),
      kradfile: readJson(path.join(dictionaryDir, KRADFILE_FILE)),
      radkfile: readJson(path.join(dictionaryDir, RADKFILE_FILE)),
      svgByCharacter: buildSvgLookup(svgDir),
      tubelexFrequencyByWord: buildTubelexLookup(tubelexPath),
      unidic: {
        version: UNIDIC_CWJ_VERSION,
        lexCsvPath: unidicPaths.lexCsvPath,
      },
      kanjium: {
        accentsPath: kanjiumPaths.accentsPath,
      },
    };
  },

  async validate(payload): Promise<ValidationReport> {
    const warnings: string[] = [];
    if (payload.jmdict.words.length === 0) warnings.push("JMdict file has no words.");
    if (payload.jmdictExamples.words.length === 0) {
      warnings.push("JMdict examples file has no words.");
    }
    if (payload.kanjidic.characters.length === 0) {
      warnings.push("Kanjidic file has no characters.");
    }
    if (Object.keys(payload.tubelexFrequencyByWord).length === 0) {
      warnings.push("Tubelex Japanese frequency file has no rows.");
    }
    if (!payload.unidic.lexCsvPath) {
      warnings.push("UniDic pitch accent lex path is missing.");
    }
    if (!payload.kanjium.accentsPath) {
      warnings.push("Kanjium accents path is missing.");
    }
    return {
      valid: payload.jmdict.words.length > 0 && payload.kanjidic.characters.length > 0,
      warnings,
      counts: {
        jmdictWords: payload.jmdict.words.length,
        jmdictExampleWords: payload.jmdictExamples.words.length,
        kanjiCharacters: payload.kanjidic.characters.length,
        kradCharacters: Object.keys(payload.kradfile.kanji).length,
        radicals: Object.keys(payload.radkfile.radicals).length,
        tubelexWords: Object.keys(payload.tubelexFrequencyByWord).length,
        unidicLexFiles: payload.unidic.lexCsvPath ? 1 : 0,
        kanjiumAccentFiles: payload.kanjium.accentsPath ? 1 : 0,
      },
    };
  },

  async transform(payload, ctx): Promise<NormalizedSeedData> {
    const entries: NonNullable<NormalizedSeedData["entries"]> = [];
    const entryForms: NonNullable<NormalizedSeedData["entryForms"]> = [];
    const entryReadings: NonNullable<NormalizedSeedData["entryReadings"]> = [];
    const entrySenses: NonNullable<NormalizedSeedData["entrySenses"]> = [];
    const senseGlosses: NonNullable<NormalizedSeedData["senseGlosses"]> = [];
    const examples: NonNullable<NormalizedSeedData["examples"]> = [];
    const exampleTranslations: NonNullable<NormalizedSeedData["exampleTranslations"]> = [];
    const entryExamples: NonNullable<NormalizedSeedData["entryExamples"]> = [];
    const jaEntryData: NonNullable<NormalizedSeedData["jaEntryData"]> = [];
    const jaPitchAccents: NonNullable<NormalizedSeedData["jaPitchAccents"]> = [];
    const jaCharacterData: NonNullable<NormalizedSeedData["jaCharacterData"]> = [];
    const jaCharacterComponents: NonNullable<NormalizedSeedData["jaCharacterComponents"]> = [];
    const jaRadicals: NonNullable<NormalizedSeedData["jaRadicals"]> = [];
    const jaRadicalCharacters: NonNullable<NormalizedSeedData["jaRadicalCharacters"]> = [];
    const exampleIdByKey = new Map<string, string>();
    const translationIdByKey = new Set<string>();
    const entryExampleIdByKey = new Set<string>();

    for (const word of payload.jmdict.words) {
      const entryId = `ja:jmdict:${word.id}`;
      const firstKanji = word.kanji?.[0]?.text ?? null;
      const firstKana = word.kana[0]?.text ?? null;
      const isCommon =
        !!word.kanji?.some((kanji) => kanji.common) ||
        !!word.kana.some((kana) => kana.common);
      const frequency = getBestTubelexMatch(word, payload.tubelexFrequencyByWord);

      entries.push({
        id: entryId,
        languageId: JA_LANGUAGE_ID,
        dictionaryId: JM_DICT_ID,
        entryType: "word",
        canonicalForm: firstDefined(firstKanji, firstKana) ?? undefined,
        canonicalReading: firstKana ?? undefined,
        status: "active",
        sourceEntryId: word.id,
      });

      if (word.kanji && word.kanji.length > 0) {
        word.kanji.forEach((kanji, index) => {
          entryForms.push({
            id: `${entryId}:form:kanji:${index}`,
            entryId,
            text: kanji.text,
            script: "Jpan",
            formType: "headword",
            isPrimary: index === 0,
            isCommon: !!kanji.common,
            rawRank: index + 1,
          });
        });
      } else if (firstKana) {
        entryForms.push({
          id: `${entryId}:form:kana`,
          entryId,
          text: firstKana,
          script: "Kana",
          formType: "headword",
          isPrimary: true,
          isCommon,
          rawRank: 1,
        });
      }

      word.kana.forEach((kana, index) => {
        entryReadings.push({
          id: `${entryId}:reading:${index}`,
          entryId,
          text: kana.text,
          system: "kana",
          script: "Kana",
          isPrimary: index === 0,
          isCommon: !!kana.common,
          rawRank: index + 1,
        });
      });

      word.sense.forEach((sense, senseIndex) => {
        const senseId = `${entryId}:sense:${senseIndex}`;
        entrySenses.push({
          id: senseId,
          entryId,
          senseOrder: senseIndex + 1,
          partOfSpeech: stringifyOrNull(sense.partOfSpeech),
          domain: stringifyOrNull(sense.field),
          dialect: stringifyOrNull(sense.dialect),
          info: stringifyOrNull({
            misc: sense.misc ?? [],
            info: sense.info ?? [],
          }),
        });

        (sense.gloss ?? []).forEach((gloss, glossIndex) => {
          senseGlosses.push({
            id: `${senseId}:gloss:${glossIndex}`,
            senseId,
            glossLanguage: gloss.lang ?? "eng",
            glossOrder: glossIndex + 1,
            text: gloss.text,
            gender: gloss.gender ?? null,
            glossType: gloss.type ?? null,
          });
        });
      });

      jaEntryData.push({
        entryId,
        isCommon,
        frequencyRank: frequency?.rank ?? null,
        priorityTags: stringifyOrNull({
          kanji: word.kanji?.flatMap((kanji) => kanji.tags ?? []) ?? [],
          kana: word.kana.flatMap((kana) => kana.tags ?? []),
        }),
      });
    }

    for (const word of payload.jmdictExamples.words) {
      const entryId = `ja:jmdict:${word.id}`;

      word.sense.forEach((sense, senseIndex) => {
        const senseId = `${entryId}:sense:${senseIndex}`;

        (sense.examples ?? []).forEach((example, exampleIndex) => {
          const japaneseSentence =
            example.sentences?.find((sentence) => sentence.lang === "jpn")?.text ?? null;

          if (!japaneseSentence) return;

          const sourceType = example.source?.type ?? "jmdict";
          const sourceValue = example.source?.value ?? `${word.id}:${senseIndex}:${exampleIndex}`;
          const exampleKey = `${sourceType}\u241f${sourceValue}\u241f${japaneseSentence}`;
          let exampleId = exampleIdByKey.get(exampleKey);

          if (!exampleId) {
            exampleId = `ja:example:${sourceType}:${sourceValue}`;
            exampleIdByKey.set(exampleKey, exampleId);
            examples.push({
              id: exampleId,
              languageId: JA_LANGUAGE_ID,
              text: japaneseSentence,
              textNormalized: japaneseSentence,
              translationGroupId: exampleId,
              sourceType: `jmdict_example_${sourceType}`,
              sourceRef: sourceValue,
            });
          }

          (example.sentences ?? [])
            .filter((sentence) => sentence.lang !== "jpn" && sentence.text)
            .forEach((sentence, sentenceIndex) => {
              const translationKey = `${exampleId}\u241f${sentence.lang}\u241f${sentence.text}`;
              if (translationIdByKey.has(translationKey)) return;
              translationIdByKey.add(translationKey);
              exampleTranslations.push({
                id: `${exampleId}:translation:${sentence.lang}:${sentenceIndex}`,
                exampleId,
                languageCode: sentence.lang,
                text: sentence.text,
                translationOrder: sentenceIndex + 1,
              });
            });

          const entryExampleKey = `${entryId}\u241f${senseId}\u241f${exampleId}`;
          if (!entryExampleIdByKey.has(entryExampleKey)) {
            entryExampleIdByKey.add(entryExampleKey);
            entryExamples.push({
              id: `${senseId}:example:${exampleId}`,
              entryId,
              senseId,
              exampleId,
              relationType: "example",
            });
          }
        });
      });
    }

    const pitchAccentImport = await buildJaPitchAccentImport({
      lexPath: payload.unidic.lexCsvPath,
      words: payload.jmdict.words,
      dictionaryId: UNIDIC_ID,
    });
    jaPitchAccents.push(...pitchAccentImport.rows);
    ctx.logger.info("built ja pitch accents", { ...pitchAccentImport.stats });

    const coveredByUnidic = new Set(pitchAccentImport.rows.map((row) => row.entryId));
    const kanjiumPitchImport = await buildJaPitchAccentImportFromKanjium({
      accentsPath: payload.kanjium.accentsPath,
      words: payload.jmdict.words,
      dictionaryId: KANJIUM_ID,
      coveredEntryIds: coveredByUnidic,
    });
    jaPitchAccents.push(...kanjiumPitchImport.rows);
    ctx.logger.info("built ja pitch accents from kanjium", { ...kanjiumPitchImport.stats });

    for (const character of payload.kanjidic.characters) {
      const classical = character.radicals?.find((radical) => radical.type === "classical");
      const nelson = character.radicals?.find((radical) => radical.type === "nelson_c");
      jaCharacterData.push({
        character: character.literal,
        grade: character.misc?.grade ?? null,
        strokeCounts: stringifyOrNull(character.misc?.strokeCounts ?? []),
        frequency: character.misc?.frequency ?? null,
        jlpt: character.misc?.jlptLevel?.toString() ?? null,
        radicalClassical: classical?.value ?? null,
        radicalNelson: nelson?.value ?? null,
        readingsJson: stringifyOrNull(
          character.readingMeaning?.groups?.flatMap((group) => group.readings ?? []) ?? [],
        ),
        meaningsJson: stringifyOrNull(
          character.readingMeaning?.groups?.flatMap((group) => group.meanings ?? []) ?? [],
        ),
        svg: payload.svgByCharacter[character.literal] ?? null,
      });
    }

    Object.entries(payload.kradfile.kanji).forEach(([character, components]) => {
      components.forEach((component, componentIndex) => {
        jaCharacterComponents.push({
          id: `ja:component:${character}:${componentIndex}`,
          character,
          component,
          componentOrder: componentIndex + 1,
        });
      });
    });

    Object.entries(payload.radkfile.radicals).forEach(([radical, radicalData]) => {
      jaRadicals.push({
        radical,
        strokeCount: radicalData.strokeCount ?? null,
        code: radicalData.code ?? null,
      });
      radicalData.kanji.forEach((character, characterIndex) => {
        jaRadicalCharacters.push({
          id: `ja:radical:${radical}:${characterIndex}`,
          radical,
          character,
        });
      });
    });

    return {
      languages: [
        {
          id: JA_LANGUAGE_ID,
          code: "ja",
          name: "Japanese",
          defaultGlossLanguage: "eng",
          isEnabled: true,
        },
      ],
      dictionaries: [
        {
          id: JM_DICT_ID,
          languageId: JA_LANGUAGE_ID,
          slug: "jmdict-eng",
          name: "JMdict English",
          sourceType: "dictionary",
          sourceUrl: "https://github.com/scriptin/jmdict-simplified",
          versionTag: payload.jmdict.version,
          dictDate: payload.jmdict.dictDate,
          license: "EDRDG",
          seedModule: "ja",
        },
        {
          id: KANJIDIC_ID,
          languageId: JA_LANGUAGE_ID,
          slug: "kanjidic2-en",
          name: "Kanjidic2 English",
          sourceType: "kanji_dictionary",
          sourceUrl: "https://github.com/scriptin/jmdict-simplified",
          versionTag: payload.kanjidic.version,
          dictDate: payload.kanjidic.dictDate,
          license: "EDRDG",
          seedModule: "ja",
        },
        {
          id: KRADFILE_ID,
          languageId: JA_LANGUAGE_ID,
          slug: "kradfile",
          name: "Kradfile",
          sourceType: "character_components",
          sourceUrl: "https://github.com/scriptin/jmdict-simplified",
          versionTag: payload.kradfile.version,
          license: "EDRDG",
          seedModule: "ja",
        },
        {
          id: RADKFILE_ID,
          languageId: JA_LANGUAGE_ID,
          slug: "radkfile",
          name: "Radkfile",
          sourceType: "radical_index",
          sourceUrl: "https://github.com/scriptin/jmdict-simplified",
          versionTag: payload.radkfile.version,
          license: "EDRDG",
          seedModule: "ja",
        },
        {
          id: TUBELEX_ID,
          languageId: JA_LANGUAGE_ID,
          slug: "tubelex-ja-310",
          name: "TUBELEX Japanese",
          sourceType: "frequency_corpus",
          sourceUrl: "https://github.com/naist-nlp/tubelex",
          versionTag: "tubelex-ja-310",
          license: "BSD-3-Clause",
          seedModule: "ja",
        },
        {
          id: UNIDIC_ID,
          languageId: JA_LANGUAGE_ID,
          slug: "unidic-cwj-3.1.1",
          name: "UniDic Contemporary Written Japanese",
          sourceType: "morphological_dictionary",
          sourceUrl: UNIDIC_CWJ_BASE_URL,
          versionTag: payload.unidic.version,
          license: "BSD-3-Clause",
          seedModule: "ja",
        },
        {
          id: KANJIUM_ID,
          languageId: JA_LANGUAGE_ID,
          slug: "kanjium-pitch",
          name: "Kanjium Pitch Accent",
          sourceType: "pitch_accent_dictionary",
          sourceUrl: KANJIUM_BASE_URL,
          versionTag: "master",
          license: "CC-BY-SA-4.0",
          seedModule: "ja",
        },
      ],
      entries,
      entryForms,
      entryReadings,
      entrySenses,
      senseGlosses,
      examples,
      exampleTranslations,
      entryExamples,
      jaEntryData,
      jaPitchAccents,
      jaCharacterData,
      jaCharacterComponents,
      jaRadicals,
      jaRadicalCharacters,
    };
  },

  async load(data, ctx): Promise<LoadReport> {
    const counts = await loadNormalizedData(data, ctx);
    return { counts };
  },

  async postProcess(ctx) {
    ctx.logger.info("post processing ja seed");
  },
};
