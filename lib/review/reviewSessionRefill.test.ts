import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import * as schema from "@/lib/database/schema";
import {
	deckReview$,
	loadDeckReviewSession,
	submitDeckReviewRating,
} from "@/lib/store/deckReviewStore";

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
			deleted integer DEFAULT 0,
			deleted_at text
		);
		CREATE TABLE decks_folders (
			id text PRIMARY KEY NOT NULL,
			name text NOT NULL,
			created_at text,
			updated_at text,
			language_id text,
			parent_id text,
			new_cards_paused integer,
			daily_new_limit_enabled integer,
			daily_new_limit integer,
			daily_review_limit_enabled integer,
			daily_review_limit integer,
			deleted integer DEFAULT 0,
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
			config_signature text DEFAULT '__all__' NOT NULL,
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
			deleted integer DEFAULT 0 NOT NULL,
			deleted_at text
		);
		CREATE TABLE deck_links (
			id text PRIMARY KEY NOT NULL,
			created_at text,
			updated_at text,
			primary_deck_id text NOT NULL,
			linked_deck_id text NOT NULL,
			target_review_type text NOT NULL
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

const seedKnowledge = async (
	db: DrizzleInstance,
	{
		id,
		due,
		front,
	}: {
		id: string;
		due: string;
		front: string;
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
		state: "Review",
		lastReview: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
		reviewType: "Front-Back",
		deleted: false,
		suspended: false,
	});

	await db.insert(schema.cards).values({
		id: `card_${id}`,
		deckId: "deck_1",
		knowledgeId: id,
		deleted: false,
	});
};

// Background tasks are scheduled with requestIdleCallback / setTimeout(32ms).
const flushBackgroundTasks = () =>
	new Promise((resolve) => setTimeout(resolve, 80));

const sessionKnowledgeIds = () =>
	(deckReview$.session.peek()?.cards ?? []).map((card) => card.knowledge.id);

test("grading refills the session bucket only when it runs low", async () => {
	const db = createTestDb();
	await db.insert(schema.decks).values({
		id: "deck_1",
		name: "Deck",
		languageId: "lang_ja",
		deleted: false,
	});

	const dueAt = (minutesAgo: number) =>
		new Date(Date.now() - minutesAgo * 60 * 1000).toISOString();
	for (let i = 1; i <= 6; i++) {
		await seedKnowledge(db, {
			id: `knowledge_${i}`,
			due: dueAt(60 - i),
			front: `card ${i}`,
		});
	}

	const session = await loadDeckReviewSession({
		db,
		deckId: "deck_1",
		languageId: "lang_ja",
	});
	assert.ok(session);
	assert.equal(session.cards.length, 6);

	// A card that becomes due after the session loaded: it must NOT enter the
	// queue while plenty of cards remain (no per-grade refill), and it must
	// appear once the bucket runs low enough to trigger a refill.
	await seedKnowledge(db, {
		id: "knowledge_late",
		due: dueAt(120),
		front: "late card",
	});

	// 6 -> 5 remaining, above threshold: no refill.
	assert.ok(await submitDeckReviewRating({ db, rating: "Good" }));
	await flushBackgroundTasks();
	assert.equal(sessionKnowledgeIds().length, 5);
	assert.ok(!sessionKnowledgeIds().includes("knowledge_late"));

	// 5 -> 4 remaining: still no refill.
	assert.ok(await submitDeckReviewRating({ db, rating: "Good" }));
	await flushBackgroundTasks();
	assert.ok(!sessionKnowledgeIds().includes("knowledge_late"));

	// 4 -> 3 remaining: at threshold, refill runs and picks up the late card.
	assert.ok(await submitDeckReviewRating({ db, rating: "Good" }));
	await flushBackgroundTasks();
	assert.ok(sessionKnowledgeIds().includes("knowledge_late"));

	// Refill preserved the card the user is currently looking at.
	assert.equal(sessionKnowledgeIds()[0], "knowledge_4");
});
