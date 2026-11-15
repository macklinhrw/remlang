import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import * as schema from "@/lib/database/schema";
import {
	getDeckReviewCountsToday,
} from "./reviewLimits";
import {
	submitKnowledgeReview,
	undoPreviousReview,
} from "./fsrs";

const createTestDb = () => {
	const sqlite = new Database(":memory:");
	sqlite.exec(`
		CREATE TABLE app_settings (
			key text PRIMARY KEY NOT NULL,
			value text,
			updated_at text
		);
		CREATE TABLE params (
			id text PRIMARY KEY NOT NULL,
			weights text,
			request_retention real,
			maximum_interval integer,
			enable_fuzz integer,
			enable_short_term integer,
			card_limit integer,
			lapses integer
		);
		CREATE TABLE decks (
			id text PRIMARY KEY NOT NULL,
			name text NOT NULL,
			created_at text,
			updated_at text,
			visibility text,
			is_starred integer,
			folder_id text,
			language_id text,
			source_review_type text,
			primary_deck_id text,
			new_cards_paused integer,
			daily_new_limit_enabled integer,
			daily_new_limit integer,
			daily_review_limit_enabled integer,
			daily_review_limit integer,
			deleted integer DEFAULT 0 NOT NULL,
			deleted_at text
		);
		CREATE TABLE knowledge (
			id text PRIMARY KEY NOT NULL,
			created_at text,
			updated_at text,
			front text NOT NULL,
			definitions text NOT NULL,
			source_definitions text,
			pronunciation text,
			word_id text,
			entry_id text,
			focus text,
			show_focus integer,
			focus_allows_duplicates integer,
			note text,
			tags text,
			primary_pitch_accent_dictionary_id text,
			primary_pitch_accent_reading text,
			primary_pitch_accent_accent_number integer,
			primary_pitch_accent_is_custom integer,
			config_signature text,
			definition_config text,
			config_label text,
			due text NOT NULL,
			stability real NOT NULL,
			difficulty real NOT NULL,
			elapsed_days real NOT NULL,
			scheduled_days real NOT NULL,
			learning_steps integer NOT NULL,
			reps integer NOT NULL,
			lapses integer NOT NULL,
			state text NOT NULL,
			last_review text NOT NULL,
			review_type text NOT NULL,
			deleted integer DEFAULT 0,
			suspended integer DEFAULT 0
		);
		CREATE TABLE cards (
			id text PRIMARY KEY NOT NULL,
			created_at text,
			updated_at text,
			deck_id text NOT NULL,
			knowledge_id text NOT NULL,
			note text,
			tags text,
			deleted integer DEFAULT 0,
			deleted_at text
		);
		CREATE TABLE review_log (
			id text PRIMARY KEY NOT NULL,
			rating text,
			knowledge_id text,
			review text NOT NULL,
			due text NOT NULL,
			stability real NOT NULL,
			difficulty real NOT NULL,
			elapsed_days real NOT NULL,
			scheduled_days real NOT NULL,
			learning_steps integer NOT NULL,
			state text NOT NULL,
			last_elapsed_days real NOT NULL,
			deleted integer DEFAULT 0,
			created_at text,
			updated_at text
		);
		CREATE TABLE review_undo (
			id text PRIMARY KEY NOT NULL,
			knowledge_id text NOT NULL,
			review_log_id text NOT NULL,
			due text NOT NULL,
			stability real NOT NULL,
			difficulty real NOT NULL,
			elapsed_days real NOT NULL,
			scheduled_days real NOT NULL,
			learning_steps integer NOT NULL,
			reps integer NOT NULL,
			lapses integer NOT NULL,
			state text NOT NULL,
			last_review text NOT NULL,
			undone integer DEFAULT 0 NOT NULL,
			invalidated integer DEFAULT 0 NOT NULL,
			created_at text,
			updated_at text
		);
	`);

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
