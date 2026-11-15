import assert from "node:assert/strict";
import test from "node:test";
import {
	computeNextLocalChangeTimestamp,
	hasUnsyncedLocalChanges,
} from "./logic";

test("treats a local change after the last push as pending upload", () => {
	assert.equal(
		hasUnsyncedLocalChanges({
			lastLocalChangeAt: "2026-03-24T17:08:05.000Z",
			lastPushedAt: "2026-03-24T17:06:00.000Z",
		}),
		true,
	);
});

test("does not suppress upload just because a prior pull was newer than the last push", () => {
	assert.equal(
		hasUnsyncedLocalChanges({
			lastLocalChangeAt: "2026-03-24T17:08:05.000Z",
			lastPushedAt: "2026-03-24T17:06:00.000Z",
		}),
		true,
	);
});

test("bumps the local-change timestamp past a newer server push timestamp", () => {
	assert.equal(
		computeNextLocalChangeTimestamp({
			candidateTimestamp: "2026-03-24T17:08:11.000Z",
			lastLocalChangeAt: "2026-03-24T17:08:00.000Z",
			lastPushedAt: "2026-03-24T17:08:20.000Z",
			lastPulledAt: "2026-03-24T17:08:19.000Z",
		}),
		"2026-03-24T17:08:20.001Z",
	);
});

test("keeps the candidate timestamp when it is already newer than sync markers", () => {
	assert.equal(
		computeNextLocalChangeTimestamp({
			candidateTimestamp: "2026-03-24T17:08:21.000Z",
			lastLocalChangeAt: "2026-03-24T17:08:00.000Z",
			lastPushedAt: "2026-03-24T17:08:20.000Z",
			lastPulledAt: "2026-03-24T17:08:19.000Z",
		}),
		"2026-03-24T17:08:21.000Z",
	);
});
