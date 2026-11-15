import assert from "node:assert/strict";
import test from "node:test";
import { hasPitchAccentReviewSupport } from "./pitchEligibility";

const samplePitchAccent = {
	dictionaryId: "dict_unidic_cwj",
	reading: "はし",
	pronunciation: null,
	accentNumber: 1,
	accentOrder: 0,
	accentPattern: null,
	sourcePosClass: null,
};

test("requires a Japanese entry with at least one pitch accent", () => {
	assert.equal(hasPitchAccentReviewSupport(null), false);
	assert.equal(
		hasPitchAccentReviewSupport({
			languageId: "lang_ja",
			pitchAccents: [],
		}),
		false,
	);
	assert.equal(
		hasPitchAccentReviewSupport({
			languageId: "lang_zh",
			pitchAccents: [samplePitchAccent],
		}),
		false,
	);
	assert.equal(
		hasPitchAccentReviewSupport({
			languageId: "lang_ja",
			pitchAccents: [samplePitchAccent],
		}),
		true,
	);
});
