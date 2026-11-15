/* eslint-disable @typescript-eslint/no-non-null-assertion */
import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { pinyin, convert } from "pinyin-pro";
import { batchSettlePromises } from "@/lib/batcher"; // Assuming this path is correct relative to scripts/
import {
  dictionaries,
  exampleSentences,
  examplesToWords,
  words,
  fsrsParams,
} from "@/lib/database/schema"; // Assuming this path is correct relative to scripts/
import { generateId } from "@/lib/id"; // Assuming this path is correct relative to scripts/
import * as OpenCC from "opencc-js";
import * as nodejieba from "nodejieba";
import { count, eq, isNotNull, isNull } from "drizzle-orm";
import {
  default_w,
  default_enable_fuzz,
  default_maximum_interval,
  default_request_retention,
} from "ts-fsrs"; // Import FSRS defaults

// --- Configuration ---
const DB_OUTPUT_PATH = "assets/database.db"; // Output path for the SQLite file
const RESOURCES_PATH = "assets/resources"; // Path to your resource files
const SVGS_HANS_PATH = "assets/svgsZhHans";
const SVGS_HANT_PATH = "assets/svgsZhHant";
const SVGS_SPECIAL_PATH = "assets/svgsZhHansSpecial";
const SKIP_COMMENT_LINES = 30;
const HSK_SENTENCE_TOLERANCE = 1; // number words tolerance
// --- End Configuration ---

// --- Default Values --- (Moved from schema, or redefined here)
const default_enable_short_term = true; // Use boolean for code logic
const jsonDefaultWeights = JSON.stringify(default_w); // Keep as string for text column

// --- Database Setup ---
// Ensure the assets directory exists
if (!fs.existsSync("assets")) {
  fs.mkdirSync("assets");
}
// Delete existing DB file if it exists, to ensure a clean seed
if (fs.existsSync(DB_OUTPUT_PATH)) {
  fs.unlinkSync(DB_OUTPUT_PATH);
  console.log(`Deleted existing database at ${DB_OUTPUT_PATH}`);
}
const sqlite = new Database(DB_OUTPUT_PATH);
const db = drizzle(sqlite);
console.log(`Initialized new SQLite database at ${DB_OUTPUT_PATH}`);

// --- Apply Drizzle Migrations ---
try {
  const migrationFolder = path.join(process.cwd(), "drizzle");
  const migrationFiles = fs
    .readdirSync(migrationFolder)
    .filter((file) => file.endsWith(".sql"))
    .sort(); // Sort alphabetically/chronologically

  if (migrationFiles.length === 0) {
    console.log("No migration files found in drizzle folder.");
  } else {
    // Apply all migrations in order
    console.log(`Found ${migrationFiles.length} migration files. Applying...`);
    for (const file of migrationFiles) {
      const migrationPath = path.join(migrationFolder, file);
      const sql = fs.readFileSync(migrationPath, "utf-8");
      console.log(`Applying migration: ${file}`);
      sqlite.exec(sql); // Use the raw sqlite connection to execute migration SQL
    }
    console.log("Migrations applied successfully.");
  }
} catch (error) {
  console.error("Error applying migrations:", error);
  process.exit(1); // Exit if migrations fail
}
// --- End Apply Drizzle Migrations ---

// --- End Database Setup ---

// Note: make sure to consider words that may have multiple entries in the dictionary for whatever reason

// --- Typesense Schema (Remove or keep based on need) ---
// const schema: CollectionCreateSchema = { ... };

type WordType = {
  id: string;
  dictionaryId: string;
  simplified: string;
  traditional: string;
  definitions: string;
  frequencyRank?: number;
  hsk?: string;
  pronunciation: string;
  // decomposition data, can be null if not found in decomposition list
  decompositionStrokes?: number;
  decompositionCompositionType?: string;
  decompositionLeftComponent?: string;
  decompositionLeftStrokes?: number;
  decompositionRightComponent?: string;
  decompositionRightStrokes?: number;
  decompositionSection?: string;
  // SVG data, null if not applicable or not found
  svgSimplified?: string;
  svgTraditional?: string;
  svgSpecial?: string;
};

const getHSKLists = () => {
  // initially parse the hsk word lists
  const hskDict: Record<string, string[]> = {};
  for (let i = 0; i < 6; i++) {
    const fileName = `${RESOURCES_PATH}/hsk/hsk-${i + 1}.txt`;
    hskDict[i] = fs.readFileSync(fileName).toString().split("\n");
  }
  const hskSevenToNineFile = `${RESOURCES_PATH}/hsk/hsk-7-9.txt`;
  const hskSevenToNine = fs
    .readFileSync(hskSevenToNineFile)
    .toString()
    .split("\n");

  return { hskDict, hskSevenToNine };
};

// Helper function to read SVG filenames (unicode codes)
const readSvgUnicodeMap = (dirPath: string): Set<string> => {
  const unicodeSet = new Set<string>();
  if (fs.existsSync(dirPath)) {
    const files = fs
      .readdirSync(dirPath)
      .filter((file) => file.endsWith(".svg"));
    for (const file of files) {
      const unicodeDecimal = path.basename(file, ".svg"); // e.g., "11904"
      unicodeSet.add(unicodeDecimal);
      // --- DEBUG LOG ---
      // if (unicodeDecimal === "22909") {
      //   console.log(
      //     `[DEBUG] Added SVG code ${unicodeDecimal} to set for path ${dirPath}`
      //   );
      // }
      // --- END DEBUG LOG ---
    }
    console.log(`Read ${unicodeSet.size} SVG files from ${dirPath}`);
  } else {
    console.warn(`SVG directory not found, skipping: ${dirPath}`);
  }
  return unicodeSet;
};

const populateDb = async () => {
  console.log("Starting database population...");
  // read the cedict dictionary file
  const dictRaw = fs.readFileSync(`${RESOURCES_PATH}/cedict_ts.u8`, "utf8");
  const dict = dictRaw.split("\n");
  console.log(`Read ${dict.length} lines from CEDICT.`);

  const wordDecompositionTSV = fs
    .readFileSync(`${RESOURCES_PATH}/wikimedia-decomposition.tsv`, "utf8")
    .toString();
  console.log(`Read decomposition data.`);

  const { examplesDbDict, wordsToExamplesMapDict } = await getExamplesMap();
  console.log(`Processed example sentences.`);

  // create dictionary so we can insert into it later
  console.log("Creating dictionary entry...");
  const dictionaryId = generateId();
  await db.insert(dictionaries).values({
    id: dictionaryId,
    name: "cedict",
  });

  // Load SVG filenames
  console.log("Loading SVG filenames...");
  const svgSimplifiedUnicodes = readSvgUnicodeMap(SVGS_HANS_PATH);
  const svgTraditionalUnicodes = readSvgUnicodeMap(SVGS_HANT_PATH);
  const svgSpecialUnicodes = readSvgUnicodeMap(SVGS_SPECIAL_PATH);

  // initially parse the hsk word lists
  console.log("Parsing HSK lists...");
  const hskData = getHSKLists();
  const hskDict = hskData.hskDict;
  const hskSevenToNine = hskData.hskSevenToNine;

  const minRank = 2147483647; // int32 max value

  const freqDict: Record<string, number> = {};

  // parse the overall word rank frequency list
  console.log("Parsing frequency rank list...");
  const parsedDict = JSON.parse(
    fs.readFileSync(`${RESOURCES_PATH}/rank_freq.json`).toString()
  ) as { key: string; freq: number; rank: number }[];

  for (const entry of parsedDict) {
    freqDict[entry.key] = entry.rank + 1;
  }
  console.log(`Parsed ${Object.keys(freqDict).length} frequency ranks.`);

  // parse the word decomposition into a dictionary type
  console.log("Parsing decomposition data...");
  const decompositionLines = wordDecompositionTSV.split("\n");
  const decompositionDict: Record<
    string,
    {
      // decomposition data
      decompositionStrokes: number;
      decompositionCompositionType: string;
      decompositionLeftComponent: string;
      decompositionLeftStrokes: number;
      decompositionRightComponent: string;
      decompositionRightStrokes: number;
      decompositionSection: string;
    }
  > = {};
  // Order: Component	Strokes	CompositionType	LeftComponent	LeftStrokes	RightComponent	RightStrokes	Signature	Notes	Section
  for (const line of decompositionLines) {
    if (!line.trim()) continue; // Skip empty lines
    const entries = line.split("\t");
    if (entries.length < 10) continue; // Ensure line has enough columns
    const decompositionComponent = entries[0]!;
    const decompositionStrokes = Number(entries[1]);
    const decompositionCompositionType = entries[2]!;
    const decompositionLeftComponent = entries[3]!;
    const decompositionLeftStrokes = Number(entries[4]);
    const decompositionRightComponent = entries[5]!;
    const decompositionRightStrokes = Number(entries[6]);
    const decompositionSection = entries[9]!;
    if (!decompositionComponent || isNaN(decompositionStrokes)) continue; // Basic validation
    decompositionDict[decompositionComponent] = {
      decompositionStrokes,
      decompositionCompositionType,
      decompositionLeftComponent,
      decompositionLeftStrokes,
      decompositionRightComponent,
      decompositionRightStrokes,
      decompositionSection,
    };
  }
  console.log(
    `Parsed ${Object.keys(decompositionDict).length} decomposition entries.`
  );

  // then we start processing the dictionary file
  console.log("Processing CEDICT entries...");
  // const docs = []; // Typesense related, remove if not needed
  const dbDocs: Promise<any>[] = [];

  // save the pronunciation, handle duplicate entries
  const seenDict: Record<string, number> = {};
  const wordsDict: Record<string, WordType[]> = {};

  let processedCount = 0;
  for (let i = 0; i < dict.length; i++) {
    if (i <= SKIP_COMMENT_LINES) continue;

    const currentLine = dict[i];
    if (!currentLine || currentLine.startsWith("#")) continue; // Skip empty or comment lines

    let wordSimplified = "";
    let wordTraditional = "";
    let wordPronunciation = "";
    const definitions: string[] = [];

    // Safely split the line
    const firstSpaceIndex = currentLine.indexOf(" ");
    if (firstSpaceIndex === -1) continue; // Malformed line

    const traditionalPart = currentLine.substring(0, firstSpaceIndex);
    const rest = currentLine.substring(firstSpaceIndex + 1);

    const secondSpaceIndex = rest.indexOf(" ");
    if (secondSpaceIndex === -1) continue; // Malformed line

    wordTraditional = traditionalPart; // Traditional comes first in cedict_ts.u8
    wordSimplified = rest.substring(0, secondSpaceIndex); // Simplified comes second

    const pronunciationAndDefs = rest.substring(secondSpaceIndex + 1);
    const match = pronunciationAndDefs.match(/\[(.*?)\]\s*\/(.*)\//);

    if (!match) continue; // Malformed line if no pronunciation/definitions found

    wordPronunciation = match[1]!.replaceAll("u:", "v").trim(); // Extract pronunciation
    const defsPart = match[2]!; // Extract definitions part
    definitions.push(
      ...defsPart.split("/").filter((def) => def.trim().length > 0)
    ); // Split and filter definitions

    if (
      !wordSimplified ||
      !wordTraditional ||
      !wordPronunciation ||
      definitions.length === 0
    ) {
      // console.warn(`Skipping malformed line ${i + 1}: ${currentLine}`);
      continue; // Skip if essential parts are missing
    }

    if (wordSimplified in seenDict) {
      seenDict[wordSimplified]!++;
    } else {
      seenDict[wordSimplified] = 1;
    }

    // --- Frequency Calculation (simplified) ---
    // Keeping your logic, but consider potential issues if pinyin library fails
    let freqRankValue: number | undefined = freqDict[wordSimplified];
    // freqRankValue = freqRankValue ?? minRank; // Use minRank if not found - adjust as needed
    // Your original complex logic for frequency based on pinyin matching is kept below
    // const chineseReg = /[\u4e00-\u9fa5]/g; // This check might not be needed if pinyin lib handles it
    // let newFreq = 0;
    // if (freq) {
    //   const pin = pinyin(wordSimplified, { toneType: "num" });
    //   if (!chineseReg.test(pin)) { // Consider removing this check
    //     newFreq = pin === wordPronunciation.toLowerCase() ? freq : minRank;
    //   } else if (seenDict[wordSimplified] === 1) {
    //     newFreq = freq;
    //   } else {
    //     newFreq = minRank;
    //   }
    // } else {
    //   newFreq = minRank;
    // }

    // --- HSK Calculation ---
    let hsk: string | null = null;
    for (let level = 1; level <= 7; level++) {
      if (level === 7) {
        if (hskSevenToNine.includes(wordSimplified)) {
          hsk = "7-9";
          break;
        }
      } else {
        const curHsk = hskDict[level - 1];
        if (curHsk && curHsk.includes(wordSimplified)) {
          hsk = `${level}`;
          break;
        }
      }
    }

    // --- SVG Handling ---
    let svgSimplifiedContent: string | undefined = undefined;
    let svgTraditionalContent: string | undefined = undefined;
    let svgSpecialContent: string | undefined = undefined;

    if (wordSimplified.length === 1) {
      // Only process single characters
      const charCode = wordSimplified.charCodeAt(0);
      const unicodeDecimalString = String(charCode);

      // --- Enhanced Logging for 好 ---
      if (wordSimplified === "好") {
        console.log(
          `[DEBUG 好 populateDb] Processing character: ${wordSimplified}, Unicode: ${unicodeDecimalString}`
        );
        console.log(
          `[DEBUG 好 populateDb] Checking simplified SVG: ${svgSimplifiedUnicodes.has(
            unicodeDecimalString
          )}`
        );
        console.log(
          `[DEBUG 好 populateDb] Checking traditional SVG: ${svgTraditionalUnicodes.has(
            unicodeDecimalString
          )}`
        );
        console.log(
          `[DEBUG 好 populateDb] Checking special SVG: ${svgSpecialUnicodes.has(
            unicodeDecimalString
          )}`
        );
      }
      // --- End Enhanced Logging ---

      if (svgSimplifiedUnicodes.has(unicodeDecimalString)) {
        const filePath = path.join(
          SVGS_HANS_PATH,
          `${unicodeDecimalString}.svg`
        );
        try {
          svgSimplifiedContent = fs.readFileSync(filePath, "utf8");
          // --- Enhanced Logging for 好 ---
          if (wordSimplified === "好") {
            console.log(
              `[DEBUG 好 populateDb] Read simplified SVG. Length: ${svgSimplifiedContent?.length}`
            );
          }
          // --- End Enhanced Logging ---
        } catch (err) {
          console.warn(`Error reading SVG ${filePath}: ${err}`);
          // --- Enhanced Logging for 好 ---
          if (wordSimplified === "好") {
            console.error(
              `[DEBUG 好 populateDb] Error reading simplified SVG:`,
              err
            );
          }
          // --- End Enhanced Logging ---
        }
      }
      if (svgTraditionalUnicodes.has(unicodeDecimalString)) {
        const filePath = path.join(
          SVGS_HANT_PATH,
          `${unicodeDecimalString}.svg`
        );
        try {
          svgTraditionalContent = fs.readFileSync(filePath, "utf8");
          if (wordSimplified === "好") {
            console.log(
              `[DEBUG 好 populateDb] Read traditional SVG. Length: ${svgTraditionalContent?.length}`
            );
          }
        } catch (err) {
          console.warn(`Error reading SVG ${filePath}: ${err}`);
          if (wordSimplified === "好") {
            console.error(
              `[DEBUG 好 populateDb] Error reading traditional SVG:`,
              err
            );
          }
        }
      }
      if (svgSpecialUnicodes.has(unicodeDecimalString)) {
        const filePath = path.join(
          SVGS_SPECIAL_PATH,
          `${unicodeDecimalString}.svg`
        );
        try {
          svgSpecialContent = fs.readFileSync(filePath, "utf8");
          if (wordSimplified === "好") {
            console.log(
              `[DEBUG 好 populateDb] Read special SVG. Length: ${svgSpecialContent?.length}`
            );
          }
        } catch (err) {
          console.warn(`Error reading SVG ${filePath}: ${err}`);
          if (wordSimplified === "好") {
            console.error(
              `[DEBUG 好 populateDb] Error reading special SVG:`,
              err
            );
          }
        }
      }
    }

    // --- Word Document Preparation ---
    const foundWords = wordsDict[wordSimplified];

    // get decomposition data next
    const decompositionData = decompositionDict[wordSimplified];
    const currentWord: WordType = {
      id: generateId(), // ID generated here, used if it's the primary entry
      dictionaryId: dictionaryId,
      simplified: wordSimplified,
      traditional: wordTraditional,
      // definitions: definitions.join("\n").replaceAll("u:", "v"), // Keep u: for display? Join later maybe.
      definitions: definitions.join("\n"),
      frequencyRank: freqRankValue, // Use the calculated frequency rank
      hsk: hsk ?? undefined,
      pronunciation: wordPronunciation.toLowerCase(), // Ensure consistent casing
      ...(decompositionData || {}), // Spread decomposition data safely
      svgSimplified: svgSimplifiedContent,
      svgTraditional: svgTraditionalContent,
      svgSpecial: svgSpecialContent,
    };

    // --- Enhanced Logging for 好 ---
    if (wordSimplified === "好") {
      const svgLengths = `S:${currentWord.svgSimplified?.length ?? null}, T:${
        currentWord.svgTraditional?.length ?? null
      }, Sp:${currentWord.svgSpecial?.length ?? null}`;
      console.log(
        `[DEBUG 好 populateDb] Prepared currentWord object. SVG Lengths: ${svgLengths}`
      );
      // console.log(`[DEBUG 好 populateDb] CurrentWord object details:`, { ...currentWord, definitions: '...', svgSimplified: '...', svgTraditional: '...', svgSpecial: '...' }); // Avoid logging full SVG
    }
    // --- End Enhanced Logging ---

    if (foundWords) {
      // next, check for duplicate values (based on definitions)
      let duplicate = false;
      for (const word of foundWords) {
        if (word.definitions == currentWord.definitions) {
          duplicate = true;
          break;
        }
      }
      if (!duplicate) {
        wordsDict[wordSimplified] = [...foundWords, currentWord];
      }
    } else {
      wordsDict[wordSimplified] = [currentWord];
    }
    processedCount++;
  }
  console.log(
    `Processed ${processedCount} valid CEDICT entries into ${
      Object.keys(wordsDict).length
    } unique words.`
  );

  // --- Variant Handling ---
  console.log("Processing word variants...");
  const nonVariantsList: WordType[][] = [];
  let nonVariantCount = 0;
  for (const key in wordsDict) {
    const curWords = wordsDict[key]!;
    if (curWords.length == 1) {
      nonVariantCount++;
      nonVariantsList.push(curWords);
    }
  }

  const variantsList = getVariantsList(); // Assumes this function reads the rated variants list
  console.log(`Found ${variantsList.length} words with pre-rated variants.`);
  console.log(`Found ${nonVariantCount} words without variants.`);

  // append together for a complete list
  const completeList: (WordType & { variantRating?: number })[][] = [
    ...variantsList,
    ...nonVariantsList,
  ];

  // --- Merge SVG data from wordsDict into completeList ---
  console.log("Merging SVG data into final word list...");
  for (const curWords of completeList) {
    if (!curWords) continue;
    for (const word of curWords) {
      const originalWordData = wordsDict[word.simplified]?.find(
        (w) =>
          w.definitions === word.definitions &&
          w.pronunciation === word.pronunciation
      );
      if (originalWordData) {
        word.svgSimplified =
          originalWordData.svgSimplified ?? word.svgSimplified;
        word.svgTraditional =
          originalWordData.svgTraditional ?? word.svgTraditional;
        word.svgSpecial = originalWordData.svgSpecial ?? word.svgSpecial;
      }
    }
  }
  console.log("SVG data merging complete.");
  // --- End Merge SVG data ---

  // --- Database Insertion Preparation ---
  console.log("Preparing word data for database insertion...");
  const variantDocs: Promise<any>[] = []; // Promises for variant insertions
  const wordDbIdDict: Record<string, string[]> = {}; // simplified -> list of db IDs

  for (const curWords of completeList) {
    if (!curWords || curWords.length === 0) continue;

    // --- Enhanced Logging for 好 ---
    // Log just before pushing the actual insert promises
    if (curWords && curWords[0] && curWords[0].simplified === "好") {
      const primaryWord = curWords[0];
      const svgLengths = `S:${primaryWord.svgSimplified?.length ?? null}, T:${
        primaryWord.svgTraditional?.length ?? null
      }, Sp:${primaryWord.svgSpecial?.length ?? null}`;
      console.log(
        `[DEBUG 好 populateDb] Preparing DB insert for PRIMARY '好'. SVG Lengths: ${svgLengths}`
      );

      if (curWords.length > 1) {
        for (let i = 1; i < curWords.length; i++) {
          const variantWord = curWords[i]!;
          const varSvgLengths = `S:${
            variantWord.svgSimplified?.length ?? null
          }, T:${variantWord.svgTraditional?.length ?? null}, Sp:${
            variantWord.svgSpecial?.length ?? null
          }`;
          console.log(
            `[DEBUG 好 populateDb] Preparing DB insert for VARIANT '好' (index ${i}). SVG Lengths: ${varSvgLengths}`
          );
        }
      }
    }
    // --- End Enhanced Logging ---

    const curWordIdList: string[] = [];
    const topWord = curWords[0]!; // The first word is primary or the only word

    // Consolidate decomposition data for the primary entry
    const decompositionDataJoined = [
      topWord.decompositionStrokes,
      topWord.decompositionCompositionType,
      topWord.decompositionLeftComponent,
      topWord.decompositionLeftStrokes,
      topWord.decompositionRightComponent,
      topWord.decompositionRightStrokes,
      topWord.decompositionSection,
    ]
      .map(String)
      .join("\n"); // Ensure all parts are strings before joining

    if (curWords.length > 1) {
      // Handle variants
      const primaryId = topWord.id; // Use the pre-generated ID for the primary
      curWordIdList.push(primaryId);

      // Insert variants first
      for (let i = 1; i < curWords.length; i++) {
        const curVariant = curWords[i]!;
        const variantId = curVariant.id; // Use pre-generated ID
        const variantInsert = db
          .insert(words)
          .values({
            id: variantId,
            dictionaryId: dictionaryId,
            name: curVariant.simplified,
            traditional: curVariant.traditional,
            definitions: curVariant.definitions,
            frequencyRank: curVariant.frequencyRank, // Variants might not have freq rank? Nullify maybe?
            hsk: curVariant.hsk,
            pronunciation: curVariant.pronunciation,
            variantParentId: primaryId, // Link to primary word
            variantRank: curVariant.variantRating,
            decompositionData: decompositionDataJoined, // Variants share decomposition of primary? Or should be null? Check requirement. For now, copy.
            svgSimplified: curVariant.svgSimplified, // Copy from processed data
            svgTraditional: curVariant.svgTraditional,
            svgSpecial: curVariant.svgSpecial,
          })
          .onConflictDoNothing(); // Added conflict handling
        variantDocs.push(variantInsert);
        curWordIdList.push(variantId);
      }

      // Insert the primary word (which might reference variants implicitly via variantParentId pointing *to* it)
      const primaryWordPromise = db
        .insert(words)
        .values({
          id: primaryId,
          dictionaryId: dictionaryId,
          name: topWord.simplified,
          traditional: topWord.traditional,
          definitions: topWord.definitions,
          frequencyRank: topWord.frequencyRank,
          variantRank: topWord.variantRating, // Primary might have a rating too
          hsk: topWord.hsk,
          pronunciation: topWord.pronunciation,
          decompositionData: decompositionDataJoined,
          svgSimplified: topWord.svgSimplified, // Add SVG data
          svgTraditional: topWord.svgTraditional,
          svgSpecial: topWord.svgSpecial,
          // variantParentId is null for primary
        })
        .onConflictDoNothing(); // Added conflict handling
      dbDocs.push(primaryWordPromise);

      wordDbIdDict[topWord.simplified] = curWordIdList;
    } else {
      // Handle single entries (no variants)
      const primaryWord = curWords[0]!;
      const wordId = primaryWord.id; // Use pre-generated ID
      const wordPromise = db
        .insert(words)
        .values({
          id: wordId,
          dictionaryId: dictionaryId,
          name: primaryWord.simplified,
          traditional: primaryWord.traditional,
          definitions: primaryWord.definitions,
          frequencyRank: primaryWord.frequencyRank,
          hsk: primaryWord.hsk,
          pronunciation: primaryWord.pronunciation,
          decompositionData: decompositionDataJoined,
          svgSimplified: primaryWord.svgSimplified, // Add SVG data
          svgTraditional: primaryWord.svgTraditional,
          svgSpecial: primaryWord.svgSpecial,
          // variantParentId is null
          // variantRank might be null or based on some default if applicable
        })
        .onConflictDoNothing(); // Added conflict handling
      dbDocs.push(wordPromise);
      wordDbIdDict[primaryWord.simplified] = [wordId];
    }
  }

  // --- Insert Variants and Primary Words ---
  console.log(`Inserting ${variantDocs.length} variant word entries...`);
  await batchSettlePromises(variantDocs, 100, true);
  console.log(`Inserting ${dbDocs.length} primary word entries...`);
  await batchSettlePromises(dbDocs, 100, true); // Insert primary words after variants (or together if FK allows)
  console.log("Word insertion complete.");

  // --- Log State After Initial Insertion ---
  try {
    const haoAfterInsert = await db
      .select()
      .from(words)
      .where(eq(words.name, "好"));
    console.log(
      `[DEBUG 好 populateDb] State of '好' in DB after initial inserts (${haoAfterInsert.length} entries):`
    );
    haoAfterInsert.forEach((entry, index) => {
      const svgLengths = `S:${entry.svgSimplified?.length ?? null}, T:${
        entry.svgTraditional?.length ?? null
      }, Sp:${entry.svgSpecial?.length ?? null}`;
      console.log(
        `  Entry ${index}: ID=${entry.id}, ParentID=${entry.variantParentId}, Rank=${entry.variantRank}, HSK=${entry.hsk}, Freq=${entry.frequencyRank}, SVG Lengths: ${svgLengths}`
      );
    });
  } catch (e) {
    console.error(
      "[DEBUG 好 populateDb] Error querying DB for '好' after insert:",
      e
    );
  }
  // --- End Log State ---

  // --- Prepare and Insert Word-to-Example Mappings ---
  console.log("Preparing word-to-example mappings...");
  type InsertWordsToExamples = typeof examplesToWords.$inferInsert;
  const wordToExampleList: InsertWordsToExamples[] = [];
  for (const word of Object.keys(wordDbIdDict)) {
    const exampleIds = wordsToExamplesMapDict[word]; // Example IDs from the examples TSV (numeric IDs)
    const curWordDbIdList = wordDbIdDict[word]; // DB IDs for this word (potentially multiple variants)

    if (!curWordDbIdList || curWordDbIdList.length === 0) continue; // Should not happen, but safety check

    if (exampleIds && exampleIds.length > 0) {
      for (const wordDbId of curWordDbIdList) {
        for (const exampleTsvId of exampleIds) {
          // Use the TSV ID (number)
          const exampleDbIds = examplesDbDict[String(exampleTsvId)]; // Lookup DB IDs using string key
          if (exampleDbIds && exampleDbIds.length > 0) {
            for (const exampleDbId of exampleDbIds) {
              wordToExampleList.push({
                sentenceId: exampleDbId,
                wordId: wordDbId,
              });
            }
          }
        }
      }
    }
  }

  console.log(
    `Inserting ${wordToExampleList.length} word-to-example mappings...`
  );
  const exampleMapPromises: Promise<any>[] = [];
  for (const insertData of wordToExampleList) {
    // Add conflict handling if necessary
    const insertCall = db
      .insert(examplesToWords)
      .values(insertData)
      .onConflictDoNothing();
    exampleMapPromises.push(insertCall);
  }
  await batchSettlePromises(exampleMapPromises, 100, true);
  console.log("Word-to-example mapping insertion complete.");
  console.log("Database population finished.");
};

const getVariantsList = (): (WordType & { variantRating: number })[][] => {
  console.log("Reading pre-rated variants list...");
  const filePath = `${RESOURCES_PATH}/CEDICT_variants_list_with_ratings.json`;
  if (!fs.existsSync(filePath)) {
    console.warn(
      `Variant ratings file not found at ${filePath}. Skipping variant rating.`
    );
    return [];
  }
  const parsedDictFile = JSON.parse(fs.readFileSync(filePath).toString()) as {
    variants: (WordType & { variantRating: number })[];
  }[];

  // Generate IDs for these variants *before* returning them
  const listsWithIds = parsedDictFile.map((item) => {
    return item.variants
      .map((variant) => ({
        ...variant,
        id: generateId(), // Assign a unique ID here
      }))
      .sort((a, b) => {
        // Sort by rating after adding IDs
        if (a.variantRating > b.variantRating) return -1;
        if (a.variantRating < b.variantRating) return 1;
        return 0;
      });
  });
  console.log(`Loaded ${listsWithIds.length} entries from variants list.`);
  return listsWithIds;
};

const getExamplesMap = async (): Promise<{
  wordsToExamplesMapDict: Record<string, number[]>;
  examplesDbDict: Record<string, string[]>;
}> => {
  console.log("Processing example sentences TSV...");
  const examplesTSVPath = `${RESOURCES_PATH}/example-chm-en.tsv`;
  if (!fs.existsSync(examplesTSVPath)) {
    console.error(
      `Example sentences file not found at ${examplesTSVPath}. Cannot proceed with examples.`
    );
    return { wordsToExamplesMapDict: {}, examplesDbDict: {} };
  }
  const examplesTSV = fs.readFileSync(examplesTSVPath).toString();

  // initially parse the hsk word lists
  const hskData = getHSKLists(); // Assume this is already called or call if needed
  const hskDict = hskData.hskDict;
  const hskSevenToNine = hskData.hskSevenToNine;

  interface Example {
    tsvId: number; // Keep track of the original TSV ID
    english: string;
    simplified: string;
    traditional: string;
    hsk?: string;
  }

  const exampleLines = examplesTSV.split("\n");
  const examples = exampleLines.map((i) => i.split("\t"));

  const converterToSimplified = OpenCC.Converter({ from: "tw", to: "cn" });
  const converterToTraditional = OpenCC.Converter({ from: "cn", to: "tw" });

  const examplesDict: Record<string, Example[]> = {}; // key is TSV ID (string)
  const wordsToExamplesMapDict: Record<string, number[]> = {}; // simplified word -> list of TSV IDs (number)

  console.log("Parsing and segmenting example sentences...");
  let exampleCount = 0;
  for (const example of examples) {
    if (
      !example ||
      example.length < 4 ||
      !example[0] ||
      !example[1] ||
      !example[3]
    )
      continue; // Basic validation

    const tsvIdStr = example[0]!;
    const tsvIdNum = parseInt(tsvIdStr, 10);
    if (isNaN(tsvIdNum)) continue; // Skip if ID is not a number

    const sentenceChineseRaw = example[1]!.trim();
    const sentenceEnglish = example[3]!.trim();

    // Normalize Chinese sentence (convert Traditional in TSV to Simplified for processing)
    const sentenceChineseSimplified = converterToSimplified(sentenceChineseRaw);
    const sentenceChineseTraditional = converterToTraditional(
      sentenceChineseSimplified
    ); // Ensure consistency

    const sentence: Example = {
      tsvId: tsvIdNum,
      english: sentenceEnglish,
      simplified: sentenceChineseSimplified,
      traditional: sentenceChineseTraditional,
    };

    if (!examplesDict[tsvIdStr]) {
      // Process each unique TSV ID only once for segmentation and HSK
      examplesDict[tsvIdStr] = [sentence];
      exampleCount++;

      // Segment words using nodejieba
      try {
        // TODO: Consider loading a user dictionary if available/needed
        // nodejieba.load({ userDict: `${RESOURCES_PATH}/dictnodejieba.utf8` }); // Example
        const segs = nodejieba.tag(sentenceChineseSimplified);
        const finalSegs = segs
          .filter((i) => i.tag !== "x" && /^[\u4e00-\u9fff]+$/.test(i.word)) // Filter non-words and punctuation
          .map((i) => i.word);
        const wordSet: Set<string> = new Set(finalSegs);

        // Determine HSK level for the sentence
        let sentenceHsk: string | null = null;
        let maxHskValue = 0;
        let nonHskCount = 0;
        let meetsHskTolerance = true;

        for (const word of wordSet) {
          // Add word to the map (word -> list of tsvIds)
          if (wordsToExamplesMapDict[word]) {
            wordsToExamplesMapDict[word]!.push(tsvIdNum);
          } else {
            wordsToExamplesMapDict[word] = [tsvIdNum];
          }

          // Check HSK level for this word
          let wordHskValue = 0;
          let wordFoundInHsk = false;
          for (let level = 1; level <= 7; level++) {
            if (level === 7) {
              if (hskSevenToNine.includes(word)) {
                wordHskValue = level; // Assign value 7 for 7-9
                wordFoundInHsk = true;
                break;
              }
            } else {
              const curHsk = hskDict[level - 1];
              if (curHsk && curHsk.includes(word)) {
                wordHskValue = level;
                wordFoundInHsk = true;
                break;
              }
            }
          }

          if (wordFoundInHsk) {
            if (wordHskValue > maxHskValue) {
              maxHskValue = wordHskValue;
              sentenceHsk = maxHskValue === 7 ? "7-9" : `${maxHskValue}`;
            }
          } else {
            nonHskCount++;
            if (nonHskCount > HSK_SENTENCE_TOLERANCE) {
              meetsHskTolerance = false;
            }
          }
        } // End word loop

        // Assign HSK to the sentence object if applicable
        if (meetsHskTolerance && sentenceHsk !== null) {
          sentence.hsk = sentenceHsk;
        }
      } catch (error) {
        console.error(`Error processing sentence ID ${tsvIdStr}:`, error);
        // Decide how to handle errors, e.g., skip sentence or continue
      }
    } else {
      // If TSV ID already exists, it might represent variations (e.g., different English translations)
      // Add this variation, inheriting the HSK level from the first one processed.
      const existingHsk = examplesDict[tsvIdStr]![0]?.hsk;
      if (existingHsk) {
        sentence.hsk = existingHsk;
      }
      examplesDict[tsvIdStr]!.push(sentence);
    }
  }
  console.log(`Parsed ${exampleCount} unique example sentences.`);

  // --- Add Examples to Database ---
  console.log("Inserting example sentences into database...");
  // Clear existing examples first (ensure FK constraints allow this or clear join table first)
  await db.delete(examplesToWords); // Clear join table if needed
  await db.delete(exampleSentences);

  type InsertExample = typeof exampleSentences.$inferInsert;

  const dbExamplePromises: Promise<any>[] = [];
  const examplesDbDict: Record<string, string[]> = {}; // tsvId (string) -> list of DB IDs (string)

  for (const tsvIdStr of Object.keys(examplesDict)) {
    const examplesList = examplesDict[tsvIdStr]!;
    if (!examplesList || examplesList.length === 0) continue;

    const parentDbId = generateId(); // ID for the first/primary sentence of this TSV ID group
    const currentDbIds: string[] = [];

    for (let i = 0; i < examplesList.length; i++) {
      const example = examplesList[i]!;
      const isVariant = i > 0;
      const exampleDbId = isVariant ? generateId() : parentDbId;

      const exampleToInsert: InsertExample = {
        id: exampleDbId,
        sentence: example.simplified,
        sentenceTranslation: example.english,
        sentenceTraditional: example.traditional,
        hsk: example.hsk,
        variantParentId: isVariant ? parentDbId : undefined, // Link variants to parent
        // sentenceAudio: "", // Add if applicable
      };

      const examplePromise = db
        .insert(exampleSentences)
        .values(exampleToInsert)
        .onConflictDoNothing();
      dbExamplePromises.push(examplePromise);
      currentDbIds.push(exampleDbId);
    }
    examplesDbDict[tsvIdStr] = currentDbIds; // Store mapping from tsvId -> list of DB IDs
  }

  await batchSettlePromises(dbExamplePromises, 100, true);
  console.log(
    `Inserted ${dbExamplePromises.length} example sentence entries (including variants).`
  );
  console.log("Example sentence processing complete.");
  return { wordsToExamplesMapDict, examplesDbDict };
};

// --- HSK Level Mapping ---
const hskLevelsMap: Record<string, string> = {
  一级: "1",
  二级: "2",
  三级: "3",
  四级: "4",
  五级: "5",
  六级: "6",
  高等: "7-9", // Assuming "高等" maps to 7-9
};

// --- HSK Reranking Function (Adapted) ---
const rerankHSK = async () => {
  console.log("Starting HSK reranking process...");
  // Get frequencies (optional here, but might be useful for tie-breaking)
  const freqDict: Record<string, number> = {};
  const freqRankPath = `${RESOURCES_PATH}/rank_freq.json`;
  if (fs.existsSync(freqRankPath)) {
    const parsedDict = JSON.parse(fs.readFileSync(freqRankPath).toString()) as {
      key: string;
      freq: number;
      rank: number;
    }[];
    for (const entry of parsedDict) {
      freqDict[cleanKey(entry.key)] = entry.rank + 1;
    }
    console.log(
      `Loaded ${
        Object.keys(freqDict).length
      } frequency ranks for HSK reranking.`
    );
  } else {
    console.warn(
      `Frequency rank file not found at ${freqRankPath}. Proceeding without frequency data for tie-breaking.`
    );
  }

  // Load HSK character data
  const hskFilePath = `${RESOURCES_PATH}/hsk/hanzi.csv`;
  if (!fs.existsSync(hskFilePath)) {
    console.error(
      `HSK character file not found at ${hskFilePath}. Cannot perform HSK reranking.`
    );
    return;
  }
  const hskFile = fs.readFileSync(hskFilePath).toString();
  const hskLines = hskFile.split("\n").map((i) => i.trim().split(","));
  hskLines.shift(); // Remove header

  // Build character -> [level, pinyin] dictionary
  const characterDict: Record<string, string[][]> = {};
  for (const entry of hskLines) {
    if (entry.length < 4) continue; // Validate line
    const levelKey = entry[1]!;
    const level = hskLevelsMap[levelKey];
    if (!level) continue; // Skip if level mapping not found
    const char = entry[2]!;
    const pro = entry[3]!; // Pinyin with tone marks
    if (characterDict[char]) {
      characterDict[char]!.push([level, pro]);
    } else {
      characterDict[char] = [[level, pro]];
    }
  }
  console.log(
    `Parsed ${
      Object.keys(characterDict).length
    } unique characters from HSK file.`
  );

  // Fetch all words from the DB (handle potentially large datasets)
  console.log("Fetching words from database for HSK reranking...");
  const allWords: (typeof words.$inferSelect)[] = await db.select().from(words);
  console.log(`Fetched ${allWords.length} words from database.`);

  // Group words by character name
  type WordSelectType = typeof words.$inferSelect;
  const dbDict: Record<string, WordSelectType[]> = {};
  for (const word of allWords) {
    const char = word.name;
    if (dbDict[char]) {
      dbDict[char]!.push(word);
    } else {
      dbDict[char] = [word];
    }
  }

  type RerankingWordType = {
    word: WordSelectType;
    level: string | null; // HSK level derived from pronunciation match
  };

  const updatePromises: Promise<any>[] = [];

  console.log("Reranking words based on HSK pronunciation match...");
  for (const char of Object.keys(dbDict)) {
    const wordsList = dbDict[char]; // Words from DB with this character
    const hskVariants = characterDict[char]; // HSK entries [level, pinyin_marks] for this char

    if (!wordsList || !hskVariants) continue; // Skip if no DB words or no HSK data for this char

    const rerankedWordsDict: Record<string, RerankingWordType[]> = {}; // char -> list of words with assigned level

    // Match DB words with HSK entries based on pronunciation
    for (const word of wordsList) {
      let foundMatch = false;
      let matchedLevel: string | null = null;

      for (const hskData of hskVariants) {
        const level = hskData[0]!;
        const pinyinWithMarks = hskData[1]!;
        // Convert HSK pinyin (marks) to match DB pinyin (numbers, v for ü)
        const hskPinyinConverted = convert(pinyinWithMarks, {
          format: "symbolToNum",
        })
          .replace("0", "5")
          .replace("ü", "v");

        // Compare converted HSK pinyin with DB word pronunciation
        if (hskPinyinConverted === word.pronunciation) {
          foundMatch = true;
          matchedLevel = level;
          break; // Found the matching pronunciation for this word
        }
      }

      // Add word to reranking dictionary with its matched level (or null)
      const rerankingEntry: RerankingWordType = { word, level: matchedLevel };
      if (!rerankedWordsDict[char]) rerankedWordsDict[char] = [];
      rerankedWordsDict[char]!.push(rerankingEntry);
    } // End loop through wordsList for the character

    // Sort, assign parent/variant status, and prepare DB updates
    for (const charKey of Object.keys(rerankedWordsDict)) {
      // Should only be one key here (char)
      const rerankList = rerankedWordsDict[charKey]!;

      // Sort the list: HSK level (ascending), variantRank (descending), definition length (descending)
      rerankList.sort((a, b) => {
        // Primary sort: HSK Level (nulls last)
        if (a.level === null && b.level !== null) return 1;
        if (a.level !== null && b.level === null) return -1;
        if (a.level !== null && b.level !== null) {
          // Compare levels numerically if possible (e.g., '1' vs '2')
          const levelA = parseInt(a.level.split("-")[0]!, 10); // Handle '7-9'
          const levelB = parseInt(b.level.split("-")[0]!, 10);
          if (levelA !== levelB) return levelA - levelB;
        }

        // Secondary sort: Original variantRank (higher rank first, nulls last)
        const rankA = a.word.variantRank ?? -1; // Treat null rank as lowest
        const rankB = b.word.variantRank ?? -1;
        if (rankA !== rankB) return rankB - rankA; // Descending order

        // Tertiary sort: Definition length (longer first) - heuristic
        const lenA = a.word.definitions?.length ?? 0;
        const lenB = b.word.definitions?.length ?? 0;
        if (lenA !== lenB) return lenB - lenA; // Descending order

        return 0; // Keep original order if all else fails
      });

      // Assign primary/variant status and prepare updates
      if (rerankList.length > 0) {
        const primaryWordData = rerankList[0]!; // The top item after sorting is primary

        // Update the primary word
        const primaryUpdate = db
          .update(words)
          .set({
            hsk: primaryWordData.level, // Assign the determined HSK level
            variantParentId: undefined, // Explicitly set to null/undefined for primary
            frequencyRank:
              freqDict[primaryWordData.word.name] ??
              primaryWordData.word.frequencyRank, // Re-assign freq rank if available
            variantRank: primaryWordData.word.variantRank, // Keep original rank or update if needed
            // --- Preserve SVG data ---
            svgSimplified: primaryWordData.word.svgSimplified,
            svgTraditional: primaryWordData.word.svgTraditional,
            svgSpecial: primaryWordData.word.svgSpecial,
            // --- End Preserve SVG data ---
          })
          .where(eq(words.id, primaryWordData.word.id));
        updatePromises.push(primaryUpdate);

        // Update variants
        for (let i = 1; i < rerankList.length; i++) {
          const variantData = rerankList[i]!;
          const variantUpdate = db
            .update(words)
            .set({
              hsk: variantData.level, // Assign determined HSK level
              variantParentId: primaryWordData.word.id, // Link to the new primary
              frequencyRank: undefined, // Variants usually don't have independent freq rank
              variantRank: variantData.word.variantRank, // Keep original variant rank or update
              // --- Preserve SVG data ---
              svgSimplified: variantData.word.svgSimplified,
              svgTraditional: variantData.word.svgTraditional,
              svgSpecial: variantData.word.svgSpecial,
              // --- End Preserve SVG data ---
            })
            .where(eq(words.id, variantData.word.id));
          updatePromises.push(variantUpdate);
        }
      }
    } // End loop through rerankedWordsDict keys
  } // End loop through dbDict characters

  console.log(
    `Prepared ${updatePromises.length} database update operations for HSK reranking.`
  );
  await batchSettlePromises(updatePromises, 100, true);
  console.log("HSK reranking process complete.");
};

// --- Utility: Clean Key ---
function cleanKey(key: string): string {
  return key.replace(/^\uFEFF/, "").trim(); // Removes BOM and trims whitespace
}

// --- Frequency Rank Fixing Function (Adapted) ---
const fixFreqRanks = async () => {
  console.log("Starting frequency rank fixing process...");
  const freqDict: Record<string, number> = {};
  const freqRankPath = `${RESOURCES_PATH}/rank_freq.json`;

  if (!fs.existsSync(freqRankPath)) {
    console.warn(
      `Frequency rank file not found at ${freqRankPath}. Cannot fix frequency ranks.`
    );
    return;
  }

  // Parse the frequency rank list
  try {
    const parsedDict = JSON.parse(fs.readFileSync(freqRankPath).toString()) as {
      key: string;
      freq: number;
      rank: number;
    }[];
    for (const entry of parsedDict) {
      const cleanedKey = cleanKey(entry.key);
      freqDict[cleanedKey] = entry.rank + 1; // Store rank + 1
    }
    console.log(
      `Loaded ${Object.keys(freqDict).length} entries from frequency rank file.`
    );
  } catch (error) {
    console.error(
      `Error reading or parsing frequency rank file ${freqRankPath}:`,
      error
    );
    return;
  }

  // Fetch only primary words (no variantParentId) from DB
  console.log(
    "Fetching primary words from database for frequency rank fixing..."
  );
  const primaryWords = await db
    .select({
      id: words.id,
      name: words.name,
      frequencyRank: words.frequencyRank,
      // --- Add SVG columns to select ---
      svgSimplified: words.svgSimplified,
      svgTraditional: words.svgTraditional,
      svgSpecial: words.svgSpecial,
      // --- End Add SVG columns ---
    })
    .from(words)
    .where(isNull(words.variantParentId)); // Use isNull for the check

  console.log(`Fetched ${primaryWords.length} primary words.`);

  // Create a map for quick lookup
  const wordsDict: Record<
    string,
    {
      id: string;
      frequencyRank: number | null;
      svgSimplified: string | null;
      svgTraditional: string | null;
      svgSpecial: string | null;
    }
  > = {};
  for (const word of primaryWords) {
    const cleanedName = cleanKey(word.name);
    wordsDict[cleanedName] = {
      id: word.id,
      frequencyRank: word.frequencyRank,
      svgSimplified: word.svgSimplified,
      svgTraditional: word.svgTraditional,
      svgSpecial: word.svgSpecial,
    };
  }

  // Create a list of words found in both DB and frequency list
  const freqDictList: { key: string; ranking: number }[] = [];
  for (const key of Object.keys(wordsDict)) {
    const ranking = freqDict[key];
    if (ranking !== undefined) {
      freqDictList.push({ key, ranking });
    }
  }

  // Sort this list by the original frequency ranking
  freqDictList.sort((a, b) => a.ranking - b.ranking);

  // Re-assign sequential ranks based on the sorted list
  const freqDictReranked: Record<string, number> = {};
  for (let i = 0; i < freqDictList.length; i++) {
    const curWord = freqDictList[i]!;
    freqDictReranked[curWord.key] = i + 1; // Assign new rank 1, 2, 3...
  }
  console.log(
    `Reranked ${
      Object.keys(freqDictReranked).length
    } words based on frequency list order.`
  );

  // Prepare database updates for words whose rank needs changing
  const dbDocs: Promise<any>[] = [];
  for (const key of Object.keys(freqDictReranked)) {
    const newRank = freqDictReranked[key]!;
    const curWordData = wordsDict[key]; // Get DB data { id, frequencyRank, svg... }

    if (!curWordData) {
      // This shouldn't happen if logic is correct, but good to check
      // console.warn(`Word "${key}" found in reranked list but not in DB primary words map.`);
      continue;
    }

    // Update only if the rank is different or was previously null
    if (newRank !== curWordData.frequencyRank) {
      const p = db
        .update(words)
        .set({
          frequencyRank: newRank,
          // --- Preserve SVG data ---
          svgSimplified: curWordData.svgSimplified,
          svgTraditional: curWordData.svgTraditional,
          svgSpecial: curWordData.svgSpecial,
          // --- End Preserve SVG data ---
        })
        .where(eq(words.id, curWordData.id!));
      dbDocs.push(p);
    }
  }

  console.log(
    `Prepared ${dbDocs.length} database updates for frequency ranks.`
  );
  await batchSettlePromises(dbDocs, 100, true);
  console.log("Frequency rank fixing process complete.");
};

// --- Main Execution ---
const seedDatabase = async () => {
  try {
    // clear data (already done by deleting the file, but good practice in case logic changes)
    console.log("Clearing existing tables (if any)...");
    await db.delete(examplesToWords);
    await db.delete(words);
    await db.delete(exampleSentences);
    await db.delete(dictionaries);
    await db.delete(fsrsParams);

    // Populate the database
    await populateDb();

    // Seed FSRS default parameters
    console.log("Seeding default FSRS parameters...");
    await db.insert(fsrsParams).values({
      id: "default_params", // Use a fixed ID for the single settings row
      weights: jsonDefaultWeights, // Already stringified
      requestRetention: default_request_retention,
      maximumInterval: default_maximum_interval,
      enableFuzz: default_enable_fuzz, // Pass boolean directly
      enableShortTerm: default_enable_short_term, // Pass boolean directly
      cardLimit: 50, // Default from schema
      lapses: 8, // Default from schema
    });
    console.log("Default FSRS parameters seeded.");

    // --- Log State Before Rerank ---
    try {
      const haoBeforeRerank = await db
        .select()
        .from(words)
        .where(eq(words.name, "好"));
      console.log(
        `[DEBUG 好 seedDatabase] State of '好' in DB BEFORE rerankHSK (${haoBeforeRerank.length} entries):`
      );
      haoBeforeRerank.forEach((entry, index) => {
        const svgLengths = `S:${entry.svgSimplified?.length ?? null}, T:${
          entry.svgTraditional?.length ?? null
        }, Sp:${entry.svgSpecial?.length ?? null}`;
        console.log(
          `  Entry ${index}: ID=${entry.id}, ParentID=${entry.variantParentId}, Rank=${entry.variantRank}, HSK=${entry.hsk}, Freq=${entry.frequencyRank}, SVG Lengths: ${svgLengths}`
        );
      });
    } catch (e) {
      console.error(
        "[DEBUG 好 seedDatabase] Error querying DB for '好' before rerankHSK:",
        e
      );
    }
    // --- End Log State ---

    await rerankHSK();

    // --- Log State After Rerank ---
    try {
      const haoAfterRerank = await db
        .select()
        .from(words)
        .where(eq(words.name, "好"));
      console.log(
        `[DEBUG 好 seedDatabase] State of '好' in DB AFTER rerankHSK (${haoAfterRerank.length} entries):`
      );
      haoAfterRerank.forEach((entry, index) => {
        const svgLengths = `S:${entry.svgSimplified?.length ?? null}, T:${
          entry.svgTraditional?.length ?? null
        }, Sp:${entry.svgSpecial?.length ?? null}`;
        console.log(
          `  Entry ${index}: ID=${entry.id}, ParentID=${entry.variantParentId}, Rank=${entry.variantRank}, HSK=${entry.hsk}, Freq=${entry.frequencyRank}, SVG Lengths: ${svgLengths}`
        );
      });
    } catch (e) {
      console.error(
        "[DEBUG 好 seedDatabase] Error querying DB for '好' after rerankHSK:",
        e
      );
    }
    // --- End Log State ---

    await fixFreqRanks();

    // --- Log State After Fix Freq ---
    try {
      const haoAfterFixFreq = await db
        .select()
        .from(words)
        .where(eq(words.name, "好"));
      console.log(
        `[DEBUG 好 seedDatabase] State of '好' in DB AFTER fixFreqRanks (${haoAfterFixFreq.length} entries):`
      );
      haoAfterFixFreq.forEach((entry, index) => {
        const svgLengths = `S:${entry.svgSimplified?.length ?? null}, T:${
          entry.svgTraditional?.length ?? null
        }, Sp:${entry.svgSpecial?.length ?? null}`;
        console.log(
          `  Entry ${index}: ID=${entry.id}, ParentID=${entry.variantParentId}, Rank=${entry.variantRank}, HSK=${entry.hsk}, Freq=${entry.frequencyRank}, SVG Lengths: ${svgLengths}`
        );
      });
    } catch (e) {
      console.error(
        "[DEBUG 好 seedDatabase] Error querying DB for '好' after fixFreqRanks:",
        e
      );
    }
    // --- End Log State ---

    console.log("--- Seeding Complete ---");
    console.log(`Database file generated at: ${DB_OUTPUT_PATH}`);

    // Optional: Close the database connection if needed
    sqlite.close();
    console.log("Database connection closed.");
  } catch (error) {
    console.error("--- Seeding Failed ---");
    console.error(error);
    sqlite.close(); // Ensure connection is closed on error too
    process.exit(1); // Exit with error code
  }
};

void seedDatabase();
