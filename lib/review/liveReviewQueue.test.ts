import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import * as schema from "@/lib/database/schema";
import { createMigratedSqlite } from "@/lib/testing/migratedTestDb";
import { setGlobalReviewLimitSettings } from "./reviewLimits";
import {
	getDeckAvailableDueCount,
	getDeckReviewSession,
	getFolderAvailableDueCount,
	getFolderReviewSession,
	submitKnowledgeReview,
} from "./fsrs";

const createTestDb = () => {
	const sqlite = createMigratedSqlite();

	const db = drizzle(sqlite, { schema }) as unknown as DrizzleInstance;
	(
		db as unknown as {
			transaction: <T>(callback: (tx: DrizzleInstance) => Promise<T>) => Promise<T>;
		}
	).transaction = async <T>(callback: (tx: DrizzleInstance) => Promise<T>) =>
		await callback(db);
	return db;
};

const seedDeck = async (
	db: DrizzleInstance,
	values?: Partial<typeof schema.decks.$inferInsert>,
) => {
	await db.insert(schema.decks).values({
		id: "deck_1",
		name: "Deck",
		languageId: "lang_ja",
		deleted: false,
		...values,
	});
};

const seedFolder = async (
	db: DrizzleInstance,
	values?: Partial<typeof schema.decksFolders.$inferInsert>,
) => {
	await db.insert(schema.decksFolders).values({
		id: "folder_1",
		name: "Folder",
		languageId: "lang_ja",
		deleted: false,
		...values,
	});
};

const seedKnowledge = async (
	db: DrizzleInstance,
	{
		id,
		due,
		front,
		state = "New",
		deckId = "deck_1",
	}: {
		id: string;
		due: string;
		front: string;
		state?: typeof schema.StateEnum[number];
		deckId?: string;
	},
) => {
	await db.insert(schema.knowledge).values({
		id,
		front,
		definitions: `${front} definition`,
		due,
		stability: 0,
		difficulty: 0,
		elapsedDays: 0,
		scheduledDays: 0,
		learningSteps: 0,
		reps: 0,
		lapses: 0,
		state,
		lastReview: "2026-04-10T00:00:00.000Z",
		reviewType: "Front-Back",
		deleted: false,
		suspended: false,
	});

	await db.insert(schema.cards).values({
		id: `card_${id}`,
		deckId,
		knowledgeId: id,
		deleted: false,
	});
};

test("deck review sessions allow a previously reviewed card to re-enter once it is due again", async () => {
	const db = createTestDb();
	await seedDeck(db);
	await seedKnowledge(db, {
		id: "knowledge_1",
		due: "2026-04-11T00:00:00.000Z",
		front: "猫",
	});

	const initialSession = await getDeckReviewSession(db, "deck_1", "lang_ja");
	assert.ok(initialSession);
	assert.equal(initialSession.cards.map((card) => card.knowledge.id).join(","), "knowledge_1");

	const review = await submitKnowledgeReview(db, {
		knowledgeId: "knowledge_1",
		rating: "Again",
	});
	assert.ok(review);

	await db
		.update(schema.knowledge)
		.set({
			due: "2026-04-11T00:00:00.000Z",
		})
		.where(eq(schema.knowledge.id, "knowledge_1"));

	const refreshedSession = await getDeckReviewSession(db, "deck_1", "lang_ja");
	assert.ok(refreshedSession);
	assert.equal(
		refreshedSession.cards.map((card) => card.knowledge.id).join(","),
		"knowledge_1",
	);
});

test("deck available due counts exclude paused new cards and match the live deck session", async () => {
	const db = createTestDb();
	await seedDeck(db, {
		newCardsPaused: true,
	});
	await seedKnowledge(db, {
		id: "knowledge_1",
		due: "2026-04-11T00:00:00.000Z",
		front: "新",
		state: "New",
	});
	await seedKnowledge(db, {
		id: "knowledge_2",
		due: "2026-04-11T00:01:00.000Z",
		front: "復",
		state: "Review",
	});

	const deck = await db.query.decks.findFirst({
		where: eq(schema.decks.id, "deck_1"),
	});
	assert.ok(deck);

	const availableDueCount = await getDeckAvailableDueCount({
		db,
		deck,
		languageId: "lang_ja",
	});
	const session = await getDeckReviewSession(db, "deck_1", "lang_ja");

	assert.ok(session);
	assert.equal(availableDueCount, 1);
	assert.equal(session.dueCount, 1);
	assert.deepEqual(
		session.cards.map((card) => card.knowledge.id),
		["knowledge_2"],
	);
});

test("fresh deck review loads re-sort cards by their current due time after a review", async () => {
	const db = createTestDb();
	await seedDeck(db);
	await seedKnowledge(db, {
		id: "knowledge_1",
		due: "2026-04-11T00:01:00.000Z",
		front: "犬",
	});
	await seedKnowledge(db, {
		id: "knowledge_2",
		due: "2026-04-11T00:02:00.000Z",
		front: "鳥",
	});

	const initialSession = await getDeckReviewSession(db, "deck_1", "lang_ja");
	assert.ok(initialSession);
	assert.deepEqual(
		initialSession.cards.map((card) => card.knowledge.id),
		["knowledge_1", "knowledge_2"],
	);

	const review = await submitKnowledgeReview(db, {
		knowledgeId: "knowledge_2",
		rating: "Again",
	});
	assert.ok(review);

	await db
		.update(schema.knowledge)
		.set({
			due: "2026-04-10T23:59:00.000Z",
		})
		.where(eq(schema.knowledge.id, "knowledge_2"));

	const refreshedSession = await getDeckReviewSession(db, "deck_1", "lang_ja");
	assert.ok(refreshedSession);
	assert.deepEqual(
		refreshedSession.cards.map((card) => card.knowledge.id),
		["knowledge_2", "knowledge_1"],
	);
});

test("deck review limits are driven by completed reviews, not preloaded queue snapshots", async () => {
	const db = createTestDb();
	await seedDeck(db, {
		dailyReviewLimitEnabled: true,
		dailyReviewLimit: 1,
	});
	await seedKnowledge(db, {
		id: "knowledge_1",
		due: "2026-04-11T00:00:00.000Z",
		front: "山",
	});
	await seedKnowledge(db, {
		id: "knowledge_2",
		due: "2026-04-11T00:01:00.000Z",
		front: "川",
	});

	const initialSession = await getDeckReviewSession(db, "deck_1", "lang_ja");
	assert.ok(initialSession);
	const deck = await db.query.decks.findFirst({
		where: eq(schema.decks.id, "deck_1"),
	});
	assert.ok(deck);
	const availableDueCount = await getDeckAvailableDueCount({
		db,
		deck,
		languageId: "lang_ja",
	});
	assert.equal(availableDueCount, 1);
	assert.equal(initialSession.dueCount, 1);
	assert.equal(initialSession.cards.length, 1);

	const repeatedLoad = await getDeckReviewSession(db, "deck_1", "lang_ja");
	assert.ok(repeatedLoad);
	assert.equal(repeatedLoad.dueCount, 1);
	assert.equal(repeatedLoad.cards.length, 1);

	const review = await submitKnowledgeReview(db, {
		knowledgeId: initialSession.cards[0]?.knowledge.id ?? "",
		rating: "Good",
	});
	assert.ok(review);

	const postReviewSession = await getDeckReviewSession(db, "deck_1", "lang_ja");
	assert.ok(postReviewSession);
	assert.equal(postReviewSession.dueCount, 0);
	assert.equal(postReviewSession.cards.length, 0);
});

test("folder available due counts honor child deck and folder limits and match the live folder session", async () => {
	const db = createTestDb();
	await seedFolder(db, {
		dailyReviewLimitEnabled: true,
		dailyReviewLimit: 2,
	});
	await seedDeck(db, {
		id: "deck_1",
		folderId: "folder_1",
		dailyReviewLimitEnabled: true,
		dailyReviewLimit: 1,
	});
	await seedDeck(db, {
		id: "deck_2",
		name: "Deck 2",
		folderId: "folder_1",
	});
	await seedKnowledge(db, {
		id: "knowledge_1",
		due: "2026-04-11T00:00:00.000Z",
		front: "一",
		state: "Review",
		deckId: "deck_1",
	});
	await seedKnowledge(db, {
		id: "knowledge_2",
		due: "2026-04-11T00:01:00.000Z",
		front: "二",
		state: "Review",
		deckId: "deck_1",
	});
	await seedKnowledge(db, {
		id: "knowledge_3",
		due: "2026-04-11T00:02:00.000Z",
		front: "三",
		state: "Review",
		deckId: "deck_2",
	});
	await seedKnowledge(db, {
		id: "knowledge_4",
		due: "2026-04-11T00:03:00.000Z",
		front: "四",
		state: "Review",
		deckId: "deck_2",
	});

	const folder = await db.query.decksFolders.findFirst({
		where: eq(schema.decksFolders.id, "folder_1"),
	});
	assert.ok(folder);
	const childDecks = await db.query.decks.findMany({
		where: eq(schema.decks.folderId, "folder_1"),
	});
	const availableDueCount = await getFolderAvailableDueCount({
		db,
		folder,
		childDecks,
		languageId: "lang_ja",
	});
	const session = await getFolderReviewSession(db, "folder_1", "lang_ja");

	assert.ok(session);
	assert.equal(availableDueCount, 2);
	assert.equal(session.dueCount, 2);
	assert.deepEqual(
		session.cards.map((card) => card.knowledge.id),
		["knowledge_1", "knowledge_3"],
	);
});

test("folder available due counts deduplicate shared knowledge across child decks", async () => {
	const db = createTestDb();
	await seedFolder(db);
	await seedDeck(db, {
		id: "deck_1",
		folderId: "folder_1",
	});
	await seedDeck(db, {
		id: "deck_2",
		name: "Deck 2",
		folderId: "folder_1",
	});
	await seedKnowledge(db, {
		id: "knowledge_shared",
		due: "2026-04-11T00:00:00.000Z",
		front: "共",
		state: "Review",
		deckId: "deck_1",
	});
	await seedKnowledge(db, {
		id: "knowledge_unique",
		due: "2026-04-11T00:01:00.000Z",
		front: "別",
		state: "Review",
		deckId: "deck_2",
	});

	await db.insert(schema.cards).values({
		id: "card_shared_deck_2",
		deckId: "deck_2",
		knowledgeId: "knowledge_shared",
		deleted: false,
	});

	const folder = await db.query.decksFolders.findFirst({
		where: eq(schema.decksFolders.id, "folder_1"),
	});
	assert.ok(folder);
	const childDecks = await db.query.decks.findMany({
		where: eq(schema.decks.folderId, "folder_1"),
	});
	const availableDueCount = await getFolderAvailableDueCount({
		db,
		folder,
		childDecks,
		languageId: "lang_ja",
	});
	const session = await getFolderReviewSession(db, "folder_1", "lang_ja");

	assert.ok(session);
	assert.equal(availableDueCount, 2);
	assert.equal(session.dueCount, 2);
	assert.deepEqual(
		session.cards.map((card) => card.knowledge.id),
		["knowledge_shared", "knowledge_unique"],
	);
});

test("folder available due counts honor global limits and match the live folder session", async () => {
	const db = createTestDb();
	await seedFolder(db);
	await seedDeck(db, {
		id: "deck_1",
		folderId: "folder_1",
	});
	await seedDeck(db, {
		id: "deck_2",
		name: "Deck 2",
		folderId: "folder_1",
	});
	await seedKnowledge(db, {
		id: "knowledge_1",
		due: "2026-04-11T00:00:00.000Z",
		front: "甲",
		state: "Review",
		deckId: "deck_1",
	});
	await seedKnowledge(db, {
		id: "knowledge_2",
		due: "2026-04-11T00:01:00.000Z",
		front: "乙",
		state: "Review",
		deckId: "deck_2",
	});

	await setGlobalReviewLimitSettings(db, "lang_ja", {
		newLimitEnabled: false,
		newLimit: null,
		totalLimitEnabled: true,
		totalLimit: 1,
	});

	const folder = await db.query.decksFolders.findFirst({
		where: eq(schema.decksFolders.id, "folder_1"),
	});
	assert.ok(folder);
	const childDecks = await db.query.decks.findMany({
		where: eq(schema.decks.folderId, "folder_1"),
	});
	const availableDueCount = await getFolderAvailableDueCount({
		db,
		folder,
		childDecks,
		languageId: "lang_ja",
	});
	const session = await getFolderReviewSession(db, "folder_1", "lang_ja");

	assert.ok(session);
	assert.equal(availableDueCount, 1);
	assert.equal(session.dueCount, 1);
	assert.deepEqual(
		session.cards.map((card) => card.knowledge.id),
		["knowledge_1"],
	);
});
