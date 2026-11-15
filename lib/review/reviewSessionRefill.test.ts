import assert from "node:assert/strict";
import test from "node:test";
import { drizzle } from "drizzle-orm/better-sqlite3";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import * as schema from "@/lib/database/schema";
import { createMigratedSqlite } from "@/lib/testing/migratedTestDb";
import {
	deckReview$,
	loadDeckReviewSession,
	submitDeckReviewRating,
} from "@/lib/store/deckReviewStore";

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
