import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildJaPitchAccentImport,
  buildJaPitchAccentImportFromKanjium,
  type JaJmdictWord,
} from "./pitchAccent";

const createLexRow = ({
  surface,
  lForm,
  lemma,
  orthBase,
  pronBase,
  kanaBase,
  rawAccentType,
  sourceLexemeId,
  sourceLemmaId,
  pos1 = "名詞",
  pos2 = "一般",
  pos3 = "*",
  pos4 = "*",
}: {
  surface: string;
  lForm: string;
  lemma: string;
  orthBase: string;
  pronBase: string;
  kanaBase: string;
  rawAccentType: string;
  sourceLexemeId: string;
  sourceLemmaId: string;
  pos1?: string;
  pos2?: string;
  pos3?: string;
  pos4?: string;
}) => {
  const row = Array.from({ length: 33 }, () => "*");
  row[0] = surface;
  row[4] = pos1;
  row[5] = pos2;
  row[6] = pos3;
  row[7] = pos4;
  row[10] = lForm;
  row[11] = lemma;
  row[14] = orthBase;
  row[15] = pronBase;
  row[25] = kanaBase;
  row[28] = rawAccentType;
  row[31] = sourceLexemeId;
  row[32] = sourceLemmaId;
  return row.join(",");
};

const withTempLexFile = async (lines: string[], fn: (lexPath: string) => Promise<void>) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pitch-accent-"));
  const lexPath = path.join(tempDir, "lex.csv");
  fs.writeFileSync(lexPath, `${lines.join("\n")}\n`, "utf8");

  try {
    await fn(lexPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

const withTempAccentFile = async (
  lines: string[],
  fn: (accentsPath: string) => Promise<void>,
) => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "pitch-accent-kanjium-"));
  const accentsPath = path.join(tempDir, "accents.txt");
  fs.writeFileSync(accentsPath, `${lines.join("\n")}\n`, "utf8");

  try {
    await fn(accentsPath);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
};

test("UniDic lemma matching prevents cross-lemma reading-only collisions", async () => {
  const words: JaJmdictWord[] = [
    {
      id: "1577140",
      kanji: [{ text: "何処" }],
      kana: [{ text: "どこ", appliesToKanji: ["*"] }],
      sense: [],
    },
  ];

  await withTempLexFile(
    [
      createLexRow({
        surface: "どこ",
        lForm: "ドコ",
        lemma: "床",
        orthBase: "どこ",
        pronBase: "ドコ",
        kanaBase: "ドコ",
        rawAccentType: "0",
        sourceLexemeId: "7246889795863040",
        sourceLemmaId: "26364",
      }),
      createLexRow({
        surface: "どこ",
        lForm: "ドコ",
        lemma: "何処",
        orthBase: "どこ",
        pronBase: "ドコ",
        kanaBase: "ドコ",
        rawAccentType: "1",
        sourceLexemeId: "7490706465759744",
        sourceLemmaId: "27251",
      }),
    ],
    async (lexPath) => {
      const result = await buildJaPitchAccentImport({
        lexPath,
        words,
        dictionaryId: "dict_unidic_cwj",
      });

      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0]?.entryId, "ja:jmdict:1577140");
      assert.equal(result.rows[0]?.accentNumber, 1);
      assert.equal(result.rows[0]?.matchType, "lemma-form-reading");
      assert.equal(result.stats.noCandidateRows, 1);
    },
  );
});

test("kana-only entries still import successfully after lemma-aware matching", async () => {
  const words: JaJmdictWord[] = [
    {
      id: "1000520",
      kana: [{ text: "あら", appliesToKanji: ["*"] }],
      sense: [],
    },
  ];

  await withTempLexFile(
    [
      createLexRow({
        surface: "あら",
        lForm: "アラ",
        lemma: "あら",
        orthBase: "あら",
        pronBase: "アラ",
        kanaBase: "アラ",
        rawAccentType: "1",
        sourceLexemeId: "1100",
        sourceLemmaId: "1100",
      }),
    ],
    async (lexPath) => {
      const result = await buildJaPitchAccentImport({
        lexPath,
        words,
        dictionaryId: "dict_unidic_cwj",
      });

      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0]?.entryId, "ja:jmdict:1000520");
      assert.equal(result.rows[0]?.accentNumber, 1);
      assert.equal(result.rows[0]?.matchType, "canonical-form-reading");
    },
  );
});

test("UniDic proper-name rows do not override ordinary numeral entries", async () => {
  const words: JaJmdictWord[] = [
    {
      id: "1585310",
      kanji: [{ text: "六" }, { text: "６" }, { text: "陸" }],
      kana: [{ text: "ろく", appliesToKanji: ["*"] }],
      sense: [{ partOfSpeech: ["num"], misc: [], gloss: [{ text: "six" }] }],
    },
  ];

  await withTempLexFile(
    [
      createLexRow({
        surface: "六",
        lForm: "ロク",
        lemma: "六",
        orthBase: "六",
        pronBase: "ロク",
        kanaBase: "ロク",
        rawAccentType: "2",
        sourceLexemeId: "11251311144215040",
        sourceLemmaId: "40932",
        pos1: "名詞",
        pos2: "数詞",
      }),
      createLexRow({
        surface: "六",
        lForm: "ロク",
        lemma: "ロク",
        orthBase: "六",
        pronBase: "ロク",
        kanaBase: "ロク",
        rawAccentType: "1",
        sourceLexemeId: "56563009958584832",
        sourceLemmaId: "205775",
        pos1: "名詞",
        pos2: "固有名詞",
        pos3: "人名",
        pos4: "一般",
      }),
    ],
    async (lexPath) => {
      const result = await buildJaPitchAccentImport({
        lexPath,
        words,
        dictionaryId: "dict_unidic_cwj",
      });

      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0]?.accentNumber, 2);
      assert.equal(result.stats.rejectedPosMismatchRows, 1);
    },
  );
});

test("UniDic rows with unrelated lemmas do not attach through shared rewritten surface forms", async () => {
  const words: JaJmdictWord[] = [
    {
      id: "2761830",
      kanji: [{ text: "〆る" }],
      kana: [{ text: "しめる", appliesToKanji: ["*"] }],
      sense: [{ partOfSpeech: ["v1", "vt"], misc: [], gloss: [{ text: "to total" }] }],
    },
  ];

  await withTempLexFile(
    [
      createLexRow({
        surface: "〆れ",
        lForm: "シメル",
        lemma: "締める",
        orthBase: "〆る",
        pronBase: "シメル",
        kanaBase: "シメル",
        rawAccentType: "2",
        sourceLexemeId: "1001",
        sourceLemmaId: "1001",
        pos1: "動詞",
      }),
    ],
    async (lexPath) => {
      const result = await buildJaPitchAccentImport({
        lexPath,
        words,
        dictionaryId: "dict_unidic_cwj",
      });

      assert.equal(result.rows.length, 0);
      assert.equal(result.stats.rejectedLemmaMismatchRows, 1);
    },
  );
});

test("script-preserving matching avoids katakana loanword collisions with hiragana verbs", async () => {
  const words: JaJmdictWord[] = [
    {
      id: "1003910",
      kana: [{ text: "くねる", appliesToKanji: ["*"] }],
      sense: [{ partOfSpeech: ["v1"], misc: [], gloss: [{ text: "to bend" }] }],
    },
  ];

  await withTempLexFile(
    [
      createLexRow({
        surface: "クネル",
        lForm: "クネル",
        lemma: "クネル-quenelle",
        orthBase: "クネル",
        pronBase: "クネル",
        kanaBase: "クネル",
        rawAccentType: "1",
        sourceLexemeId: "2001",
        sourceLemmaId: "2001",
      }),
    ],
    async (lexPath) => {
      const result = await buildJaPitchAccentImport({
        lexPath,
        words,
        dictionaryId: "dict_unidic_cwj",
      });

      assert.equal(result.rows.length, 0);
      assert.equal(result.stats.noCandidateRows, 1);
    },
  );
});

test("POS compatibility blocks noun rows from attaching to interjection entries", async () => {
  const words: JaJmdictWord[] = [
    {
      id: "2122310",
      kana: [{ text: "え", appliesToKanji: ["*"] }],
      sense: [{ partOfSpeech: ["int"], misc: [], gloss: [{ text: "eh?" }] }],
    },
  ];

  await withTempLexFile(
    [
      createLexRow({
        surface: "え",
        lForm: "エ",
        lemma: "え",
        orthBase: "え",
        pronBase: "エ",
        kanaBase: "エ",
        rawAccentType: "0",
        sourceLexemeId: "3001",
        sourceLemmaId: "3001",
        pos1: "感動詞",
      }),
      createLexRow({
        surface: "え",
        lForm: "エ",
        lemma: "衣",
        orthBase: "え",
        pronBase: "エ",
        kanaBase: "エ",
        rawAccentType: "1",
        sourceLexemeId: "3002",
        sourceLemmaId: "3002",
        pos1: "名詞",
        pos2: "一般",
      }),
    ],
    async (lexPath) => {
      const result = await buildJaPitchAccentImport({
        lexPath,
        words,
        dictionaryId: "dict_unidic_cwj",
      });

      assert.equal(result.rows.length, 1);
      assert.equal(result.rows[0]?.accentNumber, 0);
      assert.equal(result.stats.rejectedLemmaMismatchRows, 1);
      assert.equal(result.stats.rejectedPosMismatchRows, 1);
    },
  );
});

test("Kanjium import keeps matching behavior unchanged for non-noun entries", async () => {
  const words: JaJmdictWord[] = [
    {
      id: "2122310",
      kana: [{ text: "え", appliesToKanji: ["*"] }],
      sense: [{ partOfSpeech: ["int"], misc: [], gloss: [{ text: "eh?" }] }],
    },
  ];

  await withTempAccentFile(["え\tえ\t0"], async (accentsPath) => {
    const result = await buildJaPitchAccentImportFromKanjium({
      accentsPath,
      words,
      dictionaryId: "dict_kanjium_pitch",
    });

    assert.equal(result.rows.length, 1);
    assert.equal(result.rows[0]?.entryId, "ja:jmdict:2122310");
    assert.equal(result.rows[0]?.accentNumber, 0);
    assert.equal(result.stats.rejectedPosMismatchRows, 0);
  });
});
