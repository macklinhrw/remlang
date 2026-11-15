import assert from "node:assert/strict";
import test from "node:test";
import {
	getPrimaryPitchAccent,
	getSortedPitchAccents,
	getPitchAccentVariantKey,
	resolveKnowledgePitchAccent,
	validateCustomPitchAccent,
} from "./japanesePitchAccent";

const pitchAccents = [
	{
		dictionaryId: "dict_unidic_cwj",
		reading: "はし",
		pronunciation: null,
		accentNumber: 1,
		accentOrder: 0,
		accentPattern: null,
		sourcePosClass: null,
	},
	{
		dictionaryId: "dict_kanjium_pitch",
		reading: "はし",
		pronunciation: null,
		accentNumber: 2,
		accentOrder: 1,
		accentPattern: null,
		sourcePosClass: null,
	},
] as const;

test("selected variant override becomes primary and removes that variant from the list", () => {
	const resolved = resolveKnowledgePitchAccent({
		pitchAccents: [...pitchAccents],
		override: {
			primaryPitchAccentDictionaryId: "dict_kanjium_pitch",
			primaryPitchAccentReading: "はし",
			primaryPitchAccentAccentNumber: 2,
			primaryPitchAccentIsCustom: false,
		},
	});

	assert.ok(resolved);
	assert.equal(resolved.mode, "variant");
	assert.equal(resolved.primaryAccentNumber, 2);
	assert.equal(resolved.variants.length, 1);
	assert.equal(resolved.variants[0]?.accentNumber, 1);
});

test("variant override distinguishes same-reading accents from the same dictionary", () => {
	const variants = [
		{
			dictionaryId: "dict_unidic_cwj",
			reading: "あめ",
			pronunciation: null,
			accentNumber: 1,
			accentOrder: 0,
			accentPattern: "atamadaka",
			sourcePosClass: null,
		},
		{
			dictionaryId: "dict_unidic_cwj",
			reading: "あめ",
			pronunciation: null,
			accentNumber: 2,
			accentOrder: 1,
			accentPattern: "nakadaka",
			sourcePosClass: null,
		},
	] as const;

	assert.notEqual(getPitchAccentVariantKey(variants[0]), getPitchAccentVariantKey(variants[1]));

	const resolved = resolveKnowledgePitchAccent({
		pitchAccents: [...variants],
		override: {
			primaryPitchAccentDictionaryId: "dict_unidic_cwj",
			primaryPitchAccentReading: "あめ",
			primaryPitchAccentAccentNumber: 2,
			primaryPitchAccentIsCustom: false,
		},
	});

	assert.ok(resolved);
	assert.equal(resolved.mode, "variant");
	assert.equal(resolved.primaryAccentNumber, 2);
	assert.equal(resolved.variants.length, 1);
	assert.equal(resolved.variants[0]?.accentNumber, 1);
});

test("valid custom override takes precedence over variant selection", () => {
	const resolved = resolveKnowledgePitchAccent({
		pitchAccents: [...pitchAccents],
		override: {
			primaryPitchAccentDictionaryId: "dict_unidic_cwj",
			primaryPitchAccentReading: "はし",
			primaryPitchAccentAccentNumber: 0,
			primaryPitchAccentIsCustom: true,
		},
	});

	assert.ok(resolved);
	assert.equal(resolved.mode, "custom");
	assert.equal(resolved.primaryReading, "はし");
	assert.equal(resolved.primaryAccentNumber, 0);
	assert.equal(resolved.variants.length, 2);
});

test("invalid custom override falls back to the entry default when no variant matches", () => {
	const resolved = resolveKnowledgePitchAccent({
		pitchAccents: [...pitchAccents],
		override: {
			primaryPitchAccentDictionaryId: "dict_missing",
			primaryPitchAccentReading: "はし",
			primaryPitchAccentAccentNumber: 9,
			primaryPitchAccentIsCustom: true,
		},
	});

	assert.ok(resolved);
	assert.equal(resolved.mode, "default");
	assert.equal(resolved.primaryAccentNumber, 1);
	assert.equal(resolved.variants.length, 1);
});

test("preferred reading is used to choose the default primary accent", () => {
	const variants = [
		{
			dictionaryId: "dict_unidic_cwj",
			reading: "いずく",
			pronunciation: null,
			accentNumber: 1,
			accentOrder: 1,
			accentPattern: "atamadaka",
			sourcePosClass: null,
		},
		{
			dictionaryId: "dict_unidic_cwj",
			reading: "どこ",
			pronunciation: null,
			accentNumber: 1,
			accentOrder: 1,
			accentPattern: "atamadaka",
			sourcePosClass: null,
		},
	] as const;

	const primary = getPrimaryPitchAccent([...variants], "どこ");
	assert.equal(primary?.reading, "どこ");

	const sorted = getSortedPitchAccents([...variants], { preferredReading: "どこ" });
	assert.equal(sorted[0]?.reading, "どこ");

	const resolved = resolveKnowledgePitchAccent({
		pitchAccents: [...variants],
		preferredReading: "どこ",
	});
	assert.ok(resolved);
	assert.equal(resolved.primaryReading, "どこ");
});

test("custom pitch validation enforces kana reading and mora bounds", () => {
	assert.equal(
		validateCustomPitchAccent({
			reading: "橋",
			accentNumber: 1,
		}).isValid,
		false,
	);
	assert.equal(
		validateCustomPitchAccent({
			reading: "きょう",
			accentNumber: 2,
		}).isValid,
		true,
	);
	assert.equal(
		validateCustomPitchAccent({
			reading: "きょう",
			accentNumber: 3,
		}).isValid,
		false,
	);
});

test("UniDic noun accents outrank suffix-like variants for the same reading", () => {
	const variants = [
		{
			dictionaryId: "dict_unidic_cwj",
			reading: "つくり",
			pronunciation: "つくり",
			accentNumber: 1,
			accentOrder: 1,
			accentPattern: "atamadaka",
			sourcePosClass: "suffix-prefix-auxiliary",
		},
		{
			dictionaryId: "dict_unidic_cwj",
			reading: "つくり",
			pronunciation: "つくり",
			accentNumber: 3,
			accentOrder: 1,
			accentPattern: "odaka",
			sourcePosClass: "noun-general",
		},
	] as const;

	const primary = getPrimaryPitchAccent([...variants], "つくり");
	assert.equal(primary?.accentNumber, 3);
});

test("UniDic noun accents outrank other non-noun analyses for the same reading", () => {
	const variants = [
		{
			dictionaryId: "dict_unidic_cwj",
			reading: "おつ",
			pronunciation: "おつ",
			accentNumber: 0,
			accentOrder: 1,
			accentPattern: "heiban",
			sourcePosClass: "other",
		},
		{
			dictionaryId: "dict_unidic_cwj",
			reading: "おつ",
			pronunciation: "おつ",
			accentNumber: 1,
			accentOrder: 1,
			accentPattern: "atamadaka",
			sourcePosClass: "noun-general",
		},
	] as const;

	const primary = getPrimaryPitchAccent([...variants], "おつ");
	assert.equal(primary?.accentNumber, 1);
});
