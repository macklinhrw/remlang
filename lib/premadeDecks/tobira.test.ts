import assert from "node:assert/strict";
import test from "node:test";
import {
	parseTobiraCountingLessonFromPath,
	parseTobiraLessonFromPath,
	parseTobiraVocabTsv,
	resolvePremadeFront,
	splitSlashVariants,
} from "./tobira";

test("splits slash-delimited Tobira variants", () => {
	assert.deepEqual(splitSlashVariants("なまえ / おなまえ"), ["なまえ", "おなまえ"]);
	assert.deepEqual(splitSlashVariants("店をやる / する"), ["店をやる", "する"]);
});

test("parses Tobira lesson metadata from source paths", () => {
	assert.deepEqual(
		parseTobiraLessonFromPath("/tmp/Tobira 1/L4/L4-vocab.tsv"),
		{ book: "tobira-1", lesson: 4 },
	);
	assert.deepEqual(
		parseTobiraLessonFromPath("/tmp/Tobira 2/L17/L17-vocab.tsv"),
		{ book: "tobira-2", lesson: 17 },
	);
	assert.equal(parseTobiraLessonFromPath("/tmp/Tobira 1/L4/L4-counting_vocab.tsv"), null);
});

test("parses Tobira 1 counting lesson metadata from source paths", () => {
	assert.deepEqual(
		parseTobiraCountingLessonFromPath("/tmp/Tobira 1/L4/L4-counting_vocab.tsv"),
		{ book: "tobira-1-counting", lesson: 4 },
	);
	assert.deepEqual(
		parseTobiraCountingLessonFromPath("/tmp/Tobira 2/L13/L13-counting_vocab.tsv"),
		{ book: "tobira-2-counting", lesson: 13 },
	);
});

test("parses Tobira vocab TSV rows without losing English tabs", () => {
	const rows = parseTobiraVocabTsv(
		[
			"Tag\tKana\tKanji\tEnglish",
			"NOUNS\tなまえ / おなまえ\t\tname\twith note",
			"RU-VERBS\tあたためる\t温める\tto warm",
		].join("\n"),
	);

	assert.deepEqual(rows, [
		{
			sourceTag: "NOUNS",
			kana: "なまえ / おなまえ",
			kanji: null,
			english: "name\twith note",
		},
		{
			sourceTag: "RU-VERBS",
			kana: "あたためる",
			kanji: "温める",
			english: "to warm",
		},
	]);
});

test("prefers kanji for premade front values", () => {
	assert.equal(resolvePremadeFront({ kana: "あたためる", kanji: "温める" }), "温める");
	assert.equal(resolvePremadeFront({ kana: "わたし", kanji: null }), "わたし");
});
