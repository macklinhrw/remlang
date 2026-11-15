import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import * as schema from "@/lib/database/schema";
import { createMigratedSqlite } from "@/lib/testing/migratedTestDb";
import {
	getDeckReviewCountsToday,
} from "./reviewLimits";
import {
	submitKnowledgeReview,
	undoPreviousReview,
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

const seedReviewableKnowledge = async (db: DrizzleInstance) => {
	await db.insert(schema.decks).values({
		id: "deck_1",
		name: "Deck",
		languageId: "lang_ja",
		deleted: false,
	});

	await db.insert(schema.knowledge).values({
		id: "knowledge_1",
		front: "猫",
		definitions: "cat",
		due: "2026-04-11T00:00:00.000Z",
		stability: 0,
		difficulty: 0,
		elapsedDays: 0,
		scheduledDays: 0,
		learningSteps: 0,
		reps: 0,
		lapses: 0,
		state: "New",
		lastReview: "2026-04-10T00:00:00.000Z",
		reviewType: "Front-Back",
		deleted: false,
		suspended: false,
	});

	await db.insert(schema.cards).values({
		id: "card_1",
		deckId: "deck_1",
		knowledgeId: "knowledge_1",
		deleted: false,
	});
};

test("review undo invalidates older snapshots, restores the prior state, and excludes deleted logs from limits", async () => {
	const db = createTestDb();
	await seedReviewableKnowledge(db);

	const firstReview = await submitKnowledgeReview(db, {
		knowledgeId: "knowledge_1",
		rating: "Good",
	});
	assert.ok(firstReview);

	const afterFirstReview = await db.query.knowledge.findFirst({
		where: eq(schema.knowledge.id, "knowledge_1"),
	});
	assert.ok(afterFirstReview);

	const firstUndoRow = await db.query.reviewUndo.findFirst({
		where: eq(schema.reviewUndo.knowledgeId, "knowledge_1"),
	});
	assert.ok(firstUndoRow);
	assert.equal(firstUndoRow.invalidated, false);
	assert.equal(firstUndoRow.undone, false);

	const secondReview = await submitKnowledgeReview(db, {
		knowledgeId: "knowledge_1",
		rating: "Hard",
	});
	assert.ok(secondReview);

	const undoRows = await db.query.reviewUndo.findMany({
		where: eq(schema.reviewUndo.knowledgeId, "knowledge_1"),
	});
	assert.equal(undoRows.length, 2);
	assert.equal(
		undoRows.filter((row) => !row.invalidated && !row.undone).length,
		1,
	);
	assert.equal(
		undoRows.filter((row) => row.invalidated).length,
		1,
	);

	const undoResult = await undoPreviousReview({
		db,
		targetType: "deck",
		targetId: "deck_1",
	});
	assert.equal(undoResult.status, "undone");

	const restoredKnowledge = await db.query.knowledge.findFirst({
		where: eq(schema.knowledge.id, "knowledge_1"),
	});
	assert.ok(restoredKnowledge);
	assert.equal(restoredKnowledge.due, afterFirstReview.due);
	assert.equal(restoredKnowledge.stability, afterFirstReview.stability);
	assert.equal(restoredKnowledge.difficulty, afterFirstReview.difficulty);
	assert.equal(restoredKnowledge.elapsedDays, afterFirstReview.elapsedDays);
	assert.equal(restoredKnowledge.scheduledDays, afterFirstReview.scheduledDays);
	assert.equal(restoredKnowledge.learningSteps, afterFirstReview.learningSteps);
	assert.equal(restoredKnowledge.reps, afterFirstReview.reps);
	assert.equal(restoredKnowledge.lapses, afterFirstReview.lapses);
	assert.equal(restoredKnowledge.state, afterFirstReview.state);
	assert.equal(restoredKnowledge.lastReview, afterFirstReview.lastReview);

	const reviewLogs = await db.query.reviewLog.findMany({
		where: eq(schema.reviewLog.knowledgeId, "knowledge_1"),
	});
	assert.equal(reviewLogs.length, 2);
	assert.equal(reviewLogs.filter((row) => row.deleted).length, 1);

	const activeUndoRows = await db.query.reviewUndo.findMany({
		where: eq(schema.reviewUndo.knowledgeId, "knowledge_1"),
	});
	assert.equal(
		activeUndoRows.filter((row) => !row.invalidated && !row.undone).length,
		0,
	);
	assert.equal(activeUndoRows.filter((row) => row.undone).length, 1);

	const deckCounts = await getDeckReviewCountsToday(db, ["deck_1"]);
	assert.deepEqual(deckCounts.get("deck_1"), {
		newCount: 1,
		totalCount: 1,
	});
});
