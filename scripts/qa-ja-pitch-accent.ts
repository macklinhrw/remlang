import fs from "fs";
import path from "path";
import { openSeedDatabase, RESOURCES_PATH } from "@/scripts/seed/core/db";
import {
  buildJaPitchAccentImport,
  buildJaPitchAccentImportFromKanjium,
  getKanjiumPaths,
  getUnidicCwjPaths,
  type JaJmdictWord,
} from "@/scripts/seed/languages/ja/pitchAccent";

const JM_DICT_FILE = "jmdict-eng-3.6.2.json";
const JM_DICT_ID = "dict_jmdict_eng";
const JA_LANGUAGE_ID = "lang_ja";
const JA_PITCH_DICT_ID = "dict_unidic_cwj";
const KANJIUM_PITCH_DICT_ID = "dict_kanjium_pitch";

const parseSampleLimit = () => {
  const flag = process.argv.find((arg) => arg.startsWith("--samples="));
  if (!flag) return 10;
  const value = Number.parseInt(flag.split("=")[1] ?? "10", 10);
  return Number.isFinite(value) && value > 0 ? value : 10;
};

const loadJmdictWords = () => {
  const filePath = path.join(
    process.cwd(),
    RESOURCES_PATH,
    "jmdict-simplified",
    JM_DICT_FILE,
  );
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as {
    words: JaJmdictWord[];
  };
  return parsed.words;
};

const printRows = (label: string, rows: Record<string, unknown>[]) => {
  console.log(`\n${label}`);
  if (rows.length === 0) {
    console.log("  none");
    return;
  }

  for (const row of rows) {
    console.log(`  ${JSON.stringify(row)}`);
  }
};

const main = async () => {
  const sampleLimit = parseSampleLimit();
  const words = loadJmdictWords();
  const unidicPaths = getUnidicCwjPaths(path.join(process.cwd(), RESOURCES_PATH));
  const kanjiumPaths = getKanjiumPaths(path.join(process.cwd(), RESOURCES_PATH));

  if (!fs.existsSync(unidicPaths.lexCsvPath)) {
    throw new Error(`Missing UniDic lex file: ${unidicPaths.lexCsvPath}`);
  }
  if (!fs.existsSync(kanjiumPaths.accentsPath)) {
    throw new Error(`Missing Kanjium accents file: ${kanjiumPaths.accentsPath}`);
  }

  const unidicAnalysis = await buildJaPitchAccentImport({
    lexPath: unidicPaths.lexCsvPath,
    words,
    dictionaryId: JA_PITCH_DICT_ID,
    sampleLimit,
    collectRows: true,
  });
  const coveredByUnidic = new Set(unidicAnalysis.rows.map((row) => row.entryId));
  const kanjiumAnalysis = await buildJaPitchAccentImportFromKanjium({
    accentsPath: kanjiumPaths.accentsPath,
    words,
    dictionaryId: KANJIUM_PITCH_DICT_ID,
    sampleLimit,
    collectRows: false,
    coveredEntryIds: coveredByUnidic,
  });

  const { sqlite } = openSeedDatabase();
  try {
    const totalJaEntries = sqlite
      .prepare("select count(*) as count from entries where language_id = ? and dictionary_id = ?")
      .get(JA_LANGUAGE_ID, JM_DICT_ID) as { count: number };
    const entriesWithPitch = sqlite
      .prepare(
        "select count(distinct entry_id) as count from ja_pitch_accents where dictionary_id = ?",
      )
      .get(JA_PITCH_DICT_ID) as { count: number };
    const entriesWithKanjium = sqlite
      .prepare(
        "select count(distinct entry_id) as count from ja_pitch_accents where dictionary_id = ?",
      )
      .get(KANJIUM_PITCH_DICT_ID) as { count: number };
    const pitchRows = sqlite
      .prepare("select count(*) as count from ja_pitch_accents where dictionary_id = ?")
      .get(JA_PITCH_DICT_ID) as { count: number };
    const kanjiumRows = sqlite
      .prepare("select count(*) as count from ja_pitch_accents where dictionary_id = ?")
      .get(KANJIUM_PITCH_DICT_ID) as { count: number };
    const totalPitchRows = sqlite
      .prepare("select count(*) as count from ja_pitch_accents")
      .get() as { count: number };
    const entriesWithAnyPitch = sqlite
      .prepare("select count(distinct entry_id) as count from ja_pitch_accents")
      .get() as { count: number };
    const byMatchType = sqlite
      .prepare(
        "select dictionary_id as dictionaryId, match_type as matchType, count(*) as count from ja_pitch_accents group by dictionary_id, match_type order by dictionary_id asc, count desc",
      )
      .all() as { dictionaryId: string; matchType: string; count: number }[];
    const bySource = sqlite
      .prepare(
        "select dictionary_id as key, count(*) as count from ja_pitch_accents group by dictionary_id order by count desc",
      )
      .all() as { key: string; count: number }[];
    const byPattern = sqlite
      .prepare(
        "select coalesce(accent_pattern, 'unknown') as key, count(*) as count from ja_pitch_accents group by accent_pattern order by count desc",
      )
      .all() as { key: string; count: number }[];
    const multiAccentEntries = sqlite
      .prepare(
        `
          select entry_id as entryId, count(*) as accentCount
          from ja_pitch_accents
          where dictionary_id = ?
          group by entry_id
          having count(*) > 1
          order by accentCount desc, entryId asc
          limit 10
        `,
      )
      .all(JA_PITCH_DICT_ID) as { entryId: string; accentCount: number }[];
    const sampleKanjiumEntries = sqlite
      .prepare(
        `
          select distinct e.id as entryId, e.canonical_form as canonicalForm, e.canonical_reading as canonicalReading
          from ja_pitch_accents jpa
          join entries e on e.id = jpa.entry_id
          where jpa.dictionary_id = ?
          order by e.canonical_form asc, e.canonical_reading asc
          limit 10
        `,
      )
      .all(KANJIUM_PITCH_DICT_ID) as {
      entryId: string;
      canonicalForm: string | null;
      canonicalReading: string | null;
    }[];

    console.log("JA pitch accent QA");
    console.log(`  total JA JMdict entries: ${totalJaEntries.count}`);
    console.log(`  DB entries with UniDic rows: ${entriesWithPitch.count}`);
    console.log(`  DB entries with Kanjium rows: ${entriesWithKanjium.count}`);
    console.log(`  DB entries with any pitch rows: ${entriesWithAnyPitch.count}`);
    console.log(`  DB UniDic rows: ${pitchRows.count}`);
    console.log(`  DB Kanjium rows: ${kanjiumRows.count}`);
    console.log(`  DB total pitch rows: ${totalPitchRows.count}`);
    console.log(`  DB total coverage: ${totalJaEntries.count === 0 ? "0.00" : ((entriesWithAnyPitch.count / totalJaEntries.count) * 100).toFixed(2)}%`);

    console.log("\nUniDic import analysis");
    for (const [key, value] of Object.entries(unidicAnalysis.stats)) {
      if (key === "samples") continue;
      console.log(`  ${key}: ${value}`);
    }

    console.log("\nKanjium import analysis");
    for (const [key, value] of Object.entries(kanjiumAnalysis.stats)) {
      if (key === "samples") continue;
      console.log(`  ${key}: ${value}`);
    }

    printRows("DB rows by source", bySource);
    printRows("DB rows by match type", byMatchType);
    printRows("DB rows by accent pattern", byPattern);
    printRows("Entries with multiple accent variants", multiAccentEntries);
    printRows("Sample Kanjium-filled entries", sampleKanjiumEntries);
    printRows("Sample unmatched UniDic rows", unidicAnalysis.stats.samples.noCandidate);
    printRows("Sample ambiguous UniDic rows", unidicAnalysis.stats.samples.ambiguous);
    printRows(
      "Sample UniDic lemma-mismatch rejections",
      unidicAnalysis.stats.samples.rejectedLemmaMismatch,
    );
    printRows(
      "Sample UniDic script-mismatch rejections",
      unidicAnalysis.stats.samples.rejectedScriptMismatch,
    );
    printRows(
      "Sample UniDic POS-mismatch rejections",
      unidicAnalysis.stats.samples.rejectedPosMismatch,
    );
    printRows(
      "Sample UniDic ambiguous-compatible rejections",
      unidicAnalysis.stats.samples.ambiguousCompatible,
    );
    printRows("Sample unmatched Kanjium rows", kanjiumAnalysis.stats.samples.noCandidate);
    printRows("Sample ambiguous Kanjium rows", kanjiumAnalysis.stats.samples.ambiguous);
  } finally {
    sqlite.close();
  }
};

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
