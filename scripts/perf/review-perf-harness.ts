// [DEBUG-rvperf] Throwaway perf harness for review-page lag diagnosis.
// Replicates the exact per-grade work the app does on the JS thread:
//   1. submitKnowledgeReview        (awaited before UI advances)
//   2. previewKnowledgeReview       (fired immediately for next card)
//   3. getDeckReviewSession         (queue refresh, scheduled +32ms)
//   4. refreshDecksStore body       (getDecks + getDeckCollectionItems, +32ms)
// Run: DUE_COUNT=1000 npx tsx scripts/perf/review-perf-harness.ts
import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { performance } from "node:perf_hooks";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { sql } from "drizzle-orm";
import * as schema from "../../lib/database/schema";
import type { DrizzleInstance } from "../../lib/database/DrizzleContext";
import {
	getDeckReviewSession,
	previewKnowledgeReview,
	submitKnowledgeReview,
} from "../../lib/review/fsrs";
import { getDecks, getDeckCollectionItems } from "../../lib/store/decksStore";
import { generateId } from "../../lib/id";

const ASSET_DB = `${__dirname}/../../assets/database.db`;
const WORK_DB = "/tmp/remlang-perf-work.db";
const DUE_COUNT = Number(process.env.DUE_COUNT ?? 500);
const GRADES = Number(process.env.GRADES ?? 5);

// APFS clonefile copy — instant, fresh state each run
execSync(`rm -f ${WORK_DB} ${WORK_DB}-wal ${WORK_DB}-shm && cp -c ${ASSET_DB} ${WORK_DB}`);
if (!existsSync(WORK_DB)) throw new Error("work db copy failed");

let queryCount = 0;
const sqlite = new Database(WORK_DB);
sqlite.pragma("journal_mode = WAL");
const db = drizzle(sqlite, {
	schema,
	logger: { logQuery: () => void queryCount++ },
}) as unknown as DrizzleInstance;

// better-sqlite3 rejects async transaction callbacks; the app's expo driver
// accepts them. Shim with manual BEGIN/COMMIT so submitKnowledgeReview runs.
(db as any).transaction = async (fn: (tx: unknown) => Promise<unknown>) => {
	sqlite.exec("BEGIN");
	try {
		const result = await fn(db);
		sqlite.exec("COMMIT");
		return result;
	} catch (error) {
		sqlite.exec("ROLLBACK");
		throw error;
	}
};

const seed = () => {
	const deckId = generateId();
	const nowMs = Date.now();
	sqlite
		.prepare(
			"INSERT INTO decks (id, name, language_id, deleted) VALUES (?, ?, 'lang_ja', 0)",
		)
		.run(deckId, "Perf Deck");

	const entryIds = sqlite
		.prepare(
			`SELECT e.id FROM entries e
			 WHERE e.language_id = 'lang_ja'
			   AND EXISTS (SELECT 1 FROM entry_senses s WHERE s.entry_id = e.id)
			 LIMIT ?`,
		)
		.all(DUE_COUNT)
		.map((r: any) => r.id);
	if (entryIds.length < DUE_COUNT) {
		throw new Error(`only ${entryIds.length} entries with senses found`);
	}

	const insertKnowledge = sqlite.prepare(
		`INSERT INTO knowledge (id, front, definitions, entry_id, due, state, review_type, deleted, suspended, stability, difficulty, elapsed_days, scheduled_days, learning_steps, reps, lapses, last_review)
		 VALUES (?, ?, ?, ?, ?, ?, 'Front-Back', 0, 0, 1.0, 5.0, 0, 0, 0, ?, 0, ?)`,
	);
	const insertCard = sqlite.prepare(
		"INSERT INTO cards (id, deck_id, knowledge_id, deleted) VALUES (?, ?, ?, 0)",
	);
	const knowledgeIds: string[] = [];
	const seedTxn = sqlite.transaction(() => {
		for (let i = 0; i < DUE_COUNT; i++) {
			const kid = generateId();
			knowledgeIds.push(kid);
			const isNew = i % 5 === 0;
			// due in the past, spread over the last day
			const due = new Date(nowMs - 1000 * 60 * (i + 1)).toISOString();
			const lastReview = new Date(nowMs - 1000 * 60 * 60 * 24).toISOString();
			insertKnowledge.run(
				kid,
				`front-${i}`,
				`definition ${i}`,
				entryIds[i],
				due,
				isNew ? "New" : "Review",
				isNew ? 0 : 3,
				lastReview,
			);
			insertCard.run(generateId(), deckId, kid);
		}
	});
	seedTxn();
	return { deckId, knowledgeIds };
};

const timed = async <T>(label: string, fn: () => Promise<T>) => {
	const q0 = queryCount;
	const t0 = performance.now();
	const result = await fn();
	const ms = performance.now() - t0;
	console.log(
		`  ${label.padEnd(28)} ${ms.toFixed(1).padStart(8)} ms   ${String(queryCount - q0).padStart(5)} queries`,
	);
	return result;
};

const main = async () => {
	const { deckId } = seed();
	console.log(`[DEBUG-rvperf] due=${DUE_COUNT} grades=${GRADES}\n`);

	// initial session load (entering the review screen)
	console.log("enter review screen:");
	let session = await timed("getDeckReviewSession", () =>
		getDeckReviewSession(db, deckId, "lang_ja", { limit: 10 }),
	);
	if (!session || session.cards.length === 0) throw new Error("no session cards");

	for (let g = 0; g < GRADES; g++) {
		console.log(`\ngrade #${g + 1}:`);
		const current = session!.cards[g % session!.cards.length];
		await timed("submitKnowledgeReview", () =>
			submitKnowledgeReview(db, {
				knowledgeId: current.knowledge.id,
				rating: "Good",
			}),
		);
		const next = session!.cards[(g + 1) % session!.cards.length];
		await timed("previewKnowledgeReview", () =>
			previewKnowledgeReview(db, next.knowledge.id),
		);
		session = await timed("getDeckReviewSession", () =>
			getDeckReviewSession(db, deckId, "lang_ja", { limit: 10 }),
		);
		const deckRows = await timed("getDecks", () => getDecks(db, "lang_ja"));
		await timed("getDeckCollectionItems", () =>
			getDeckCollectionItems(db, "lang_ja", deckRows),
		);
	}

	// sanity: WAL check on row count visibility
	const dueLeft = sqlite
		.prepare(
			`SELECT COUNT(*) AS c FROM knowledge WHERE deleted = 0 AND suspended = 0
			 AND datetime(replace(substr(due,1,19),'T',' ')) <= datetime('now')`,
		)
		.get() as { c: number };
	console.log(`\n[DEBUG-rvperf] due remaining: ${dueLeft.c}`);
};

void main();
