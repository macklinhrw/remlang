import type { PremadeDeckBook } from "./types";

export type ParsedTobiraLesson = {
	book: PremadeDeckBook;
	lesson: number;
};

export type ParsedTobiraRow = {
	sourceTag: string;
	kana: string | null;
	kanji: string | null;
	english: string;
};

const TOBIRA_FILE_PATTERN = /Tobira (1|2)\/L(\d+)\/L\d+-vocab\.tsv$/;
const TOBIRA_COUNTING_FILE_PATTERN = /Tobira (1|2)\/L(\d+)\/L\d+-counting_vocab\.tsv$/;

export const splitSlashVariants = (value: string | null | undefined) => {
	if (!value) return [];

	return [...new Set(
		value
			.split(/[\/／]/)
			.map((part) => part.replace(/\s+/g, " ").trim())
			.filter(Boolean),
	)];
};

export const parseTobiraLessonFromPath = (filePath: string): ParsedTobiraLesson | null => {
	const match = filePath.match(TOBIRA_FILE_PATTERN);
	if (!match) return null;

	return {
		book: match[1] === "1" ? "tobira-1" : "tobira-2",
		lesson: Number(match[2]),
	};
};

export const parseTobiraCountingLessonFromPath = (
	filePath: string,
): ParsedTobiraLesson | null => {
	const match = filePath.match(TOBIRA_COUNTING_FILE_PATTERN);
	if (!match) return null;

	return {
		book: match[1] === "1" ? "tobira-1-counting" : "tobira-2-counting",
		lesson: Number(match[2]),
	};
};

export const parseTobiraVocabTsv = (contents: string): ParsedTobiraRow[] => {
	const lines = contents
		.split(/\r?\n/)
		.map((line) => line.trimEnd())
		.filter(Boolean);

	if (lines.length === 0) return [];

	const body = lines[0] === "Tag\tKana\tKanji\tEnglish" ? lines.slice(1) : lines;

	return body.map((line) => {
		const columns = line.split("\t");
		const [sourceTag = "", kana = "", kanji = "", ...englishParts] = columns;
		const english = englishParts.join("\t").trim();

		return {
			sourceTag: sourceTag.trim(),
			kana: kana.trim() || null,
			kanji: kanji.trim() || null,
			english,
		};
	});
};

export const resolvePremadeFront = ({
	kana,
	kanji,
}: {
	kana: string | null;
	kanji: string | null;
}) => kanji?.trim() || kana?.trim() || "";
