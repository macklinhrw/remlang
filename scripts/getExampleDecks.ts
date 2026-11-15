// What example decks?
// Individual HSK decks for each level
// Decks for each Integrated Chinese book, combined

import assert from "assert";
import fs from "fs";
import path from "path";

const HSK_DIR = "./assets/resources/hsk";
const IC_DIR = "./assets/resources/ic";
const OUT_DIR = "./assets/decklists";

type DeckListWord = {
	word: string;
	pinyin: string | null;
	partOfSpeech: string | null;
	definition: string | null;
};

const getHskList = () => {
	const hskMap = {
		"hsk-1": 1,
		"hsk-2": 2,
		"hsk-3": 3,
		"hsk-4": 4,
		"hsk-5": 5,
		"hsk-6": 6,
		"hsk-7-9": 7,
	};

	for (const item of Object.keys(hskMap)) {
		const hskPath = path.join(HSK_DIR, `${item}.txt`);
		const file = fs.readFileSync(hskPath);
		const hskContents = file.toString();
		const words: DeckListWord[] = [];
		// console.log(
		// 	item,
		// 	hskContents.split("\n").slice(0, 10),
		// 	"length:",
		// 	hskContents.length,
		// 	"\n\n",
		// );
		hskContents.split("\n").forEach((w) => {
			words.push({
				word: w,
				pinyin: null,
				partOfSpeech: null,
				definition: null,
			});
		});
		fs.writeFileSync(
			path.join(OUT_DIR, `${item}-decklist.json`),
			JSON.stringify({ list: words }, null, 2),
		);
	}
};

const getIcList = () => {
	const files = fs.readdirSync(IC_DIR);

	// List 1
	// from lesson 1 to 11
	// List 2
	// from lesson 12 to 20

	// first process titles
	const processedNames = files
		.map((f) => {
			// 1. get contents before dot
			// 2. get contents not include starting 'l'
			// 3. split before and after 'd'
			// result: first index is lesson number, second is dialogue number
			if (f.includes("min")) return null; // don't include "minified" lists
			const parts = f.split(".")[0].slice(1).split("d");
			assert(parts.length === 2, "parse should be length 2");
			for (const p in parts) {
				assert(!Number.isNaN(Number(p)), "parsed value should not be NaN");
			}
			return { lesson: Number(parts[0]), dialogue: Number(parts[1]), file: f };
		})
		.filter((f) => f); // filter out null values

	type ProcessedType = { lesson: number; dialogue: number; file: string };
	// make list 1
	const listOne = processedNames
		.map((f) => f!.lesson < 11 && f)
		.filter((f) => f) as ProcessedType[];

	const listTwo = processedNames
		.map((f) => f!.lesson >= 11 && f)
		.filter((f) => f) as ProcessedType[];

	const deckMap = {
		"Elementary Chinese": listOne,
		"Intermediate Chinese": listTwo,
	};
	for (const deckName of Object.keys(deckMap)) {
		const deck = deckMap[deckName as keyof typeof deckMap];
		const deckList = [];
		// word, pinyin, part of speech, definition
		for (const ptype of deck) {
			const filePath = path.join(IC_DIR, ptype.file);
			const contents = fs.readFileSync(filePath).toString();
			// skip first line
			const lines = contents.split("\n");
			for (const line of lines) {
				if (line === "") continue;
				const vals = line.split("\t").filter((l) => l !== "");
				assert(
					vals.length === 4 || vals.length === 3,
					`TSV parsing issue, length is not expected value 3 or 4, got ${vals.length} for {${vals}} in file ${filePath}.`,
				);

				// if length is 4 then all parts are included
				// if length is then there is no POS
				if (vals.length === 4) {
					const word: DeckListWord = {
						word: vals[0],
						pinyin: vals[1],
						partOfSpeech: vals[2],
						definition: vals[3],
					};
					deckList.push(word);
				} else if (vals.length === 3) {
					const word: DeckListWord = {
						word: vals[0],
						pinyin: vals[1],
						partOfSpeech: null,
						definition: vals[2],
					};
					deckList.push(word);
				}
			}
		}
		console.log(deckList.length);
		// save the decklist
		fs.writeFileSync(
			path.join(OUT_DIR, `${deckName}-decklist.json`),
			JSON.stringify({ list: deckList }, null, 2),
		);
	}
};

getHskList();
getIcList();
