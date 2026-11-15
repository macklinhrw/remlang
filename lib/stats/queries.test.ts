import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import * as schema from "@/lib/database/schema";
import { createMigratedSqlite } from "@/lib/testing/migratedTestDb";
import type { VisibleReviewType } from "@/lib/review/reviewTypeConfig";
import {
	getKnownCardsCount,
	getReviewHistoryStats,
	getTodayReviewStats,
} from "./queries";

const createTestDb = () => {
	const sqlite = createMigratedSqlite();

	const db = drizzle(sqlite, { schema }) as unknown as DrizzleInstance;
	return db;
};

const formatLocalDateKey = (value: Date) => {
	const year = value.getFullYear();
	const month = String(value.getMonth() + 1).padStart(2, "0");
	const day = String(value.getDate()).padStart(2, "0");
	return `${year}-${month}-${day}`;
};

const shiftLocalDays = (value: Date, days: number) => {
	const shifted = new Date(value);
	shifted.setDate(shifted.getDate() + days);
	return shifted;
};

const isoAtLocalNoon = (value: Date) =>
	new Date(
		value.getFullYear(),
		value.getMonth(),
		value.getDate(),
		12,
		0,
		0,
		0,
	).toISOString();

const seedDeck = async (
	db: DrizzleInstance,
	{
		id,
		languageId,
		deleted = false,
	}: {
		id: string;
		languageId: string;
		deleted?: boolean;
	},
) => {
	await db.insert(schema.decks).values({
		id,
		name: id,
		languageId,
		deleted,
	});
};

const seedKnowledge = async (
	db: DrizzleInstance,
	{
		id,
		state = "Review",
		deleted = false,
		suspended = false,
		reviewType = "Front-Back",
	}: {
		id: string;
		state?: typeof schema.StateEnum[number];
		deleted?: boolean;
		suspended?: boolean;
		reviewType?: VisibleReviewType;
	},
) => {
	await db.insert(schema.knowledge).values({
		id,
		front: id,
		definitions: `${id} definition`,
		due: "2026-04-11T00:00:00.000Z",
		stability: 0,
		difficulty: 0,
		elapsedDays: 0,
		scheduledDays: 0,
		learningSteps: 0,
		reps: 0,
		lapses: 0,
		state,
		lastReview: "2026-04-10T00:00:00.000Z",
		reviewType,
		deleted,
		suspended,
	});
};

const seedCard = async (
	db: DrizzleInstance,
	{
		id,
		deckId,
		knowledgeId,
		deleted = false,
	}: {
		id: string;
		deckId: string;
		knowledgeId: string;
		deleted?: boolean;
	},
) => {
	await db.insert(schema.cards).values({
		id,
		deckId,
		knowledgeId,
		deleted,
	});
};

const seedReviewLog = async (
	db: DrizzleInstance,
	{
		id,
		knowledgeId,
		review,
		state,
		deleted = false,
	}: {
		id: string;
		knowledgeId: string;
		review: string;
		state: typeof schema.StateEnum[number];
		deleted?: boolean;
	},
) => {
	await db.insert(schema.reviewLog).values({
		id,
		knowledgeId,
		rating: "Good",
		review,
		due: review,
		stability: 0,
		difficulty: 0,
		elapsedDays: 0,
		scheduledDays: 0,
		learningSteps: 0,
		state,
		lastElapsedDays: 0,
		deleted,
	});
};

test("today review stats count new and total reviews for the active language", async () => {
	const db = createTestDb();
	const today = new Date();

	await seedDeck(db, { id: "deck_ja", languageId: "lang_ja" });
	await seedDeck(db, { id: "deck_zh", languageId: "lang_zh" });
	await seedKnowledge(db, { id: "knowledge_new" });
	await seedKnowledge(db, { id: "knowledge_review" });
	await seedKnowledge(db, { id: "knowledge_other" });
	await seedCard(db, { id: "card_new", deckId: "deck_ja", knowledgeId: "knowledge_new" });
	await seedCard(db, {
		id: "card_review",
		deckId: "deck_ja",
		knowledgeId: "knowledge_review",
	});
	await seedCard(db, {
		id: "card_other",
		deckId: "deck_zh",
		knowledgeId: "knowledge_other",
	});
	await seedReviewLog(db, {
		id: "log_new",
		knowledgeId: "knowledge_new",
		review: isoAtLocalNoon(today),
		state: "New",
	});
	await seedReviewLog(db, {
		id: "log_review",
		knowledgeId: "knowledge_review",
		review: isoAtLocalNoon(today),
		state: "Review",
	});
	await seedReviewLog(db, {
		id: "log_other_language",
		knowledgeId: "knowledge_other",
		review: isoAtLocalNoon(today),
		state: "New",
	});

	const stats = await getTodayReviewStats(db, "lang_ja");
	assert.deepEqual(stats, {
		newReviewedToday: 1,
		totalReviewedToday: 2,
	});
});

test("today review stats can be filtered by review type", async () => {
	const db = createTestDb();
	const today = new Date();

	await seedDeck(db, { id: "deck_ja", languageId: "lang_ja" });
	await seedKnowledge(db, { id: "knowledge_fb", reviewType: "Front-Back" });
	await seedKnowledge(db, { id: "knowledge_pitch", reviewType: "Pitch" });
	await seedCard(db, { id: "card_fb", deckId: "deck_ja", knowledgeId: "knowledge_fb" });
	await seedCard(db, { id: "card_pitch", deckId: "deck_ja", knowledgeId: "knowledge_pitch" });
	await seedReviewLog(db, {
		id: "log_fb",
		knowledgeId: "knowledge_fb",
		review: isoAtLocalNoon(today),
		state: "New",
	});
	await seedReviewLog(db, {
		id: "log_pitch",
		knowledgeId: "knowledge_pitch",
		review: isoAtLocalNoon(today),
		state: "Review",
	});

	assert.deepEqual(await getTodayReviewStats(db, "lang_ja", null), {
		newReviewedToday: 1,
		totalReviewedToday: 2,
	});
	assert.deepEqual(await getTodayReviewStats(db, "lang_ja", "Front-Back"), {
		newReviewedToday: 1,
		totalReviewedToday: 1,
	});
	assert.deepEqual(await getTodayReviewStats(db, "lang_ja", "Pitch"), {
		newReviewedToday: 0,
		totalReviewedToday: 1,
	});
});

test("review history stats group by local day and fill zero-count days", async () => {
	const db = createTestDb();
	const today = new Date();
	const threeDaysAgo = shiftLocalDays(today, -3);
	const oneDayAgo = shiftLocalDays(today, -1);

	await seedDeck(db, { id: "deck_ja", languageId: "lang_ja" });
	await seedKnowledge(db, { id: "knowledge_1" });
	await seedKnowledge(db, { id: "knowledge_2" });
	await seedCard(db, { id: "card_1", deckId: "deck_ja", knowledgeId: "knowledge_1" });
	await seedCard(db, { id: "card_2", deckId: "deck_ja", knowledgeId: "knowledge_2" });
	await seedReviewLog(db, {
		id: "log_1",
		knowledgeId: "knowledge_1",
		review: isoAtLocalNoon(threeDaysAgo),
		state: "New",
	});
	await seedReviewLog(db, {
		id: "log_2",
		knowledgeId: "knowledge_2",
		review: isoAtLocalNoon(oneDayAgo),
		state: "Review",
	});

	const history = await getReviewHistoryStats(db, "lang_ja", 5, today);
	assert.equal(history.length, 5);
	assert.deepEqual(
		history.map((entry) => entry.date),
		[4, 3, 2, 1, 0].map((offset) => formatLocalDateKey(shiftLocalDays(today, -offset))),
	);
	assert.deepEqual(history[1], {
		date: formatLocalDateKey(threeDaysAgo),
		newReviewedCount: 1,
		totalReviewedCount: 1,
	});
	assert.deepEqual(history[2], {
		date: formatLocalDateKey(shiftLocalDays(today, -2)),
		newReviewedCount: 0,
		totalReviewedCount: 0,
	});
	assert.deepEqual(history[3], {
		date: formatLocalDateKey(oneDayAgo),
		newReviewedCount: 0,
		totalReviewedCount: 1,
	});
});

test("review history stats can be filtered by review type", async () => {
	const db = createTestDb();
	const today = new Date();
	const oneDayAgo = shiftLocalDays(today, -1);

	await seedDeck(db, { id: "deck_ja", languageId: "lang_ja" });
	await seedKnowledge(db, { id: "knowledge_fb", reviewType: "Front-Back" });
	await seedKnowledge(db, { id: "knowledge_pitch", reviewType: "Pitch" });
	await seedCard(db, { id: "card_fb", deckId: "deck_ja", knowledgeId: "knowledge_fb" });
	await seedCard(db, { id: "card_pitch", deckId: "deck_ja", knowledgeId: "knowledge_pitch" });
	await seedReviewLog(db, {
		id: "log_fb",
		knowledgeId: "knowledge_fb",
		review: isoAtLocalNoon(today),
		state: "Review",
	});
	await seedReviewLog(db, {
		id: "log_pitch",
		knowledgeId: "knowledge_pitch",
		review: isoAtLocalNoon(oneDayAgo),
		state: "New",
	});

	assert.deepEqual(
		await getReviewHistoryStats(db, "lang_ja", 2, today, "Front-Back"),
		[
			{
				date: formatLocalDateKey(oneDayAgo),
				newReviewedCount: 0,
				totalReviewedCount: 0,
			},
			{
				date: formatLocalDateKey(today),
				newReviewedCount: 0,
				totalReviewedCount: 1,
			},
		],
	);
	assert.deepEqual(
		await getReviewHistoryStats(db, "lang_ja", 2, today, "Pitch"),
		[
			{
				date: formatLocalDateKey(oneDayAgo),
				newReviewedCount: 1,
				totalReviewedCount: 1,
			},
			{
				date: formatLocalDateKey(today),
				newReviewedCount: 0,
				totalReviewedCount: 0,
			},
		],
	);
});

test("today and history stats exclude deleted review logs", async () => {
	const db = createTestDb();
	const today = new Date();

	await seedDeck(db, { id: "deck_ja", languageId: "lang_ja" });
	await seedKnowledge(db, { id: "knowledge_1" });
	await seedCard(db, { id: "card_1", deckId: "deck_ja", knowledgeId: "knowledge_1" });
	await seedReviewLog(db, {
		id: "log_active",
		knowledgeId: "knowledge_1",
		review: isoAtLocalNoon(today),
		state: "New",
	});
	await seedReviewLog(db, {
		id: "log_deleted",
		knowledgeId: "knowledge_1",
		review: isoAtLocalNoon(today),
		state: "Review",
		deleted: true,
	});

	const todayStats = await getTodayReviewStats(db, "lang_ja");
	const history = await getReviewHistoryStats(db, "lang_ja", 1, today);

	assert.deepEqual(todayStats, {
		newReviewedToday: 1,
		totalReviewedToday: 1,
	});
	assert.deepEqual(history, [
		{
			date: formatLocalDateKey(today),
			newReviewedCount: 1,
			totalReviewedCount: 1,
		},
	]);
});

test("known cards count only active review-state knowledge in the active language", async () => {
	const db = createTestDb();

	await seedDeck(db, { id: "deck_ja", languageId: "lang_ja" });
	await seedDeck(db, { id: "deck_zh", languageId: "lang_zh" });
	await seedKnowledge(db, { id: "known_1", state: "Review" });
	await seedKnowledge(db, { id: "known_2", state: "Review" });
	await seedKnowledge(db, { id: "learning_1", state: "Learning" });
	await seedKnowledge(db, { id: "suspended_1", state: "Review", suspended: true });
	await seedKnowledge(db, { id: "deleted_1", state: "Review", deleted: true });
	await seedKnowledge(db, { id: "other_language_known", state: "Review" });
	await seedCard(db, { id: "card_known_1", deckId: "deck_ja", knowledgeId: "known_1" });
	await seedCard(db, { id: "card_known_2", deckId: "deck_ja", knowledgeId: "known_2" });
	await seedCard(db, {
		id: "card_learning_1",
		deckId: "deck_ja",
		knowledgeId: "learning_1",
	});
	await seedCard(db, {
		id: "card_suspended_1",
		deckId: "deck_ja",
		knowledgeId: "suspended_1",
	});
	await seedCard(db, {
		id: "card_deleted_1",
		deckId: "deck_ja",
		knowledgeId: "deleted_1",
	});
	await seedCard(db, {
		id: "card_other_language_known",
		deckId: "deck_zh",
		knowledgeId: "other_language_known",
	});
	await seedCard(db, {
		id: "card_known_duplicate",
		deckId: "deck_ja",
		knowledgeId: "known_1",
	});

	const knownCount = await getKnownCardsCount(db, "lang_ja");
	assert.equal(knownCount, 2);
});

test("known cards count can be filtered by review type", async () => {
	const db = createTestDb();

	await seedDeck(db, { id: "deck_ja", languageId: "lang_ja" });
	await seedKnowledge(db, {
		id: "knowledge_fb",
		state: "Review",
		reviewType: "Front-Back",
	});
	await seedKnowledge(db, {
		id: "knowledge_pitch",
		state: "Review",
		reviewType: "Pitch",
	});
	await seedKnowledge(db, {
		id: "knowledge_stroke_learning",
		state: "Learning",
		reviewType: "Stroke",
	});
	await seedCard(db, { id: "card_fb", deckId: "deck_ja", knowledgeId: "knowledge_fb" });
	await seedCard(db, {
		id: "card_pitch",
		deckId: "deck_ja",
		knowledgeId: "knowledge_pitch",
	});
	await seedCard(db, {
		id: "card_stroke_learning",
		deckId: "deck_ja",
		knowledgeId: "knowledge_stroke_learning",
	});

	assert.equal(await getKnownCardsCount(db, "lang_ja", null), 2);
	assert.equal(await getKnownCardsCount(db, "lang_ja", "Front-Back"), 1);
	assert.equal(await getKnownCardsCount(db, "lang_ja", "Pitch"), 1);
	assert.equal(await getKnownCardsCount(db, "lang_ja", "Stroke"), 0);
});

test("history and known-card stats are scoped to the requested language", async () => {
	const db = createTestDb();
	const today = new Date();

	await seedDeck(db, { id: "deck_ja", languageId: "lang_ja" });
	await seedDeck(db, { id: "deck_zh", languageId: "lang_zh" });
	await seedKnowledge(db, { id: "knowledge_ja", state: "Review" });
	await seedKnowledge(db, { id: "knowledge_zh", state: "Review" });
	await seedCard(db, { id: "card_ja", deckId: "deck_ja", knowledgeId: "knowledge_ja" });
	await seedCard(db, { id: "card_zh", deckId: "deck_zh", knowledgeId: "knowledge_zh" });
	await seedReviewLog(db, {
		id: "log_ja",
		knowledgeId: "knowledge_ja",
		review: isoAtLocalNoon(today),
		state: "Review",
	});
	await seedReviewLog(db, {
		id: "log_zh",
		knowledgeId: "knowledge_zh",
		review: isoAtLocalNoon(today),
		state: "New",
	});

	const jaTodayStats = await getTodayReviewStats(db, "lang_ja");
	const zhTodayStats = await getTodayReviewStats(db, "lang_zh");
	const jaHistory = await getReviewHistoryStats(db, "lang_ja", 1, today);
	const zhHistory = await getReviewHistoryStats(db, "lang_zh", 1, today);
	const jaKnownCount = await getKnownCardsCount(db, "lang_ja");
	const zhKnownCount = await getKnownCardsCount(db, "lang_zh");

	assert.deepEqual(jaTodayStats, {
		newReviewedToday: 0,
		totalReviewedToday: 1,
	});
	assert.deepEqual(zhTodayStats, {
		newReviewedToday: 1,
		totalReviewedToday: 1,
	});
	assert.deepEqual(jaHistory, [
		{
			date: formatLocalDateKey(today),
			newReviewedCount: 0,
			totalReviewedCount: 1,
		},
	]);
	assert.deepEqual(zhHistory, [
		{
			date: formatLocalDateKey(today),
			newReviewedCount: 1,
			totalReviewedCount: 1,
		},
	]);
	assert.equal(jaKnownCount, 1);
	assert.equal(zhKnownCount, 1);
});

test("known cards drop when a review-state knowledge row is suspended", async () => {
	const db = createTestDb();

	await seedDeck(db, { id: "deck_ja", languageId: "lang_ja" });
	await seedKnowledge(db, { id: "knowledge_1", state: "Review" });
	await seedCard(db, { id: "card_1", deckId: "deck_ja", knowledgeId: "knowledge_1" });

	assert.equal(await getKnownCardsCount(db, "lang_ja"), 1);

	await db
		.update(schema.knowledge)
		.set({ suspended: true })
		.where(eq(schema.knowledge.id, "knowledge_1"));

	assert.equal(await getKnownCardsCount(db, "lang_ja"), 0);
});
