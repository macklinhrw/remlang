import assert from "node:assert/strict";
import test from "node:test";
import {
	buildChangedSnapshot,
	stripEchoedPullItems,
} from "./client";
import type { UserSyncSnapshot } from "./export";
import type { SyncPullPayload } from "./import";

const createEmptySnapshot = (
	overrides?: Partial<UserSyncSnapshot>,
): UserSyncSnapshot => ({
	schemaVersion: 2,
	exportedAt: "2026-04-12T18:00:00.000Z",
	deviceId: "dev_test",
	syncMode: "manual",
	languageId: "lang_ja",
	deckFolders: [],
	decks: [],
	deckLinks: [],
	appSettings: [],
	permanentDeletes: [],
	knowledge: [],
	cards: [],
	knowledgeLinks: [],
	cardLinks: [],
	reviewLogs: [],
	reviewUndos: [],
	...overrides,
});

const createEmptyPayload = (
	overrides?: Partial<SyncPullPayload>,
): SyncPullPayload => ({
	deckFolders: [],
	decks: [],
	deckLinks: [],
	appSettings: [],
	permanentDeletes: [],
	knowledge: [],
	cards: [],
	knowledgeLinks: [],
	cardLinks: [],
	reviewLogs: [],
	reviewUndos: [],
	...overrides,
});

test("buildChangedSnapshot uses review log timestamps to find locally changed review logs", () => {
	const snapshot = createEmptySnapshot({
		reviewLogs: [
			{
				id: "log_old",
				knowledgeId: "knowledge_1",
				rating: "Good",
				review: "2026-04-12T17:00:00.000Z",
				due: "2026-04-12T18:00:00.000Z",
				stability: 0,
				difficulty: 0,
				elapsedDays: 0,
				scheduledDays: 0,
				learningSteps: 0,
				state: "New",
				lastElapsedDays: 0,
				deleted: false,
				createdAt: "2026-04-12T17:00:00.000Z",
				updatedAt: "2026-04-12T17:00:00.000Z",
			},
			{
				id: "log_new",
				knowledgeId: "knowledge_2",
				rating: "Again",
				review: "2026-04-12T18:30:00.000Z",
				due: "2026-04-12T18:31:00.000Z",
				stability: 0,
				difficulty: 0,
				elapsedDays: 0,
				scheduledDays: 0,
				learningSteps: 0,
				state: "New",
				lastElapsedDays: 0,
				deleted: false,
				createdAt: "2026-04-12T18:30:00.000Z",
				updatedAt: "2026-04-12T18:30:00.000Z",
			},
		],
	});

	const changed = buildChangedSnapshot(snapshot, "2026-04-12T18:00:00.000Z");

	assert.deepEqual(
		changed.reviewLogs.map((item) => item.id),
		["log_new"],
	);
});

test("stripEchoedPullItems removes same-run echoed rows but keeps genuinely newer remote rows", () => {
	const pushed = createEmptyPayload({
		reviewLogs: [
			{
				id: "log_1",
				knowledgeId: "knowledge_1",
				rating: "Good",
				review: "2026-04-12T18:30:00.000Z",
				due: "2026-04-12T18:31:00.000Z",
				stability: 0,
				difficulty: 0,
				elapsedDays: 0,
				scheduledDays: 0,
				learningSteps: 0,
				state: "New",
				lastElapsedDays: 0,
				deleted: false,
				createdAt: "2026-04-12T18:30:00.000Z",
				updatedAt: "2026-04-12T18:30:00.000Z",
			},
		],
		appSettings: [
			{
				key: "sync_last_local_change_at",
				value: "2026-04-12T18:30:00.000Z",
				updatedAt: "2026-04-12T18:30:00.000Z",
			},
		],
	});

	const pulled = createEmptyPayload({
		reviewLogs: [
			pushed.reviewLogs[0]!,
			{
				id: "log_1",
				knowledgeId: "knowledge_1",
				rating: "Again",
				review: "2026-04-12T18:45:00.000Z",
				due: "2026-04-12T18:46:00.000Z",
				stability: 0,
				difficulty: 0,
				elapsedDays: 0,
				scheduledDays: 0,
				learningSteps: 0,
				state: "Learning",
				lastElapsedDays: 0,
				deleted: false,
				createdAt: "2026-04-12T18:45:00.000Z",
				updatedAt: "2026-04-12T18:45:00.000Z",
			},
			{
				id: "log_2",
				knowledgeId: "knowledge_2",
				rating: "Hard",
				review: "2026-04-12T18:32:00.000Z",
				due: "2026-04-12T18:33:00.000Z",
				stability: 0,
				difficulty: 0,
				elapsedDays: 0,
				scheduledDays: 0,
				learningSteps: 0,
				state: "Review",
				lastElapsedDays: 0,
				deleted: false,
				createdAt: "2026-04-12T18:32:00.000Z",
				updatedAt: "2026-04-12T18:32:00.000Z",
			},
		],
		appSettings: [
			pushed.appSettings[0]!,
			{
				key: "sync_last_pulled_at",
				value: "2026-04-12T18:35:00.000Z",
				updatedAt: "2026-04-12T18:35:00.000Z",
			},
		],
	});

	const filtered = stripEchoedPullItems(pulled, pushed);

	assert.deepEqual(
		filtered.reviewLogs.map((item) => item.id),
		["log_1", "log_2"],
	);
	assert.equal(
		filtered.reviewLogs.some(
			(item) =>
				item.id === "log_1" && item.updatedAt === "2026-04-12T18:30:00.000Z",
		),
		false,
	);
	assert.deepEqual(
		filtered.appSettings.map((item) => item.key),
		["sync_last_pulled_at"],
	);
});
