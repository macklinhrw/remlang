import assert from "node:assert/strict";
import test from "node:test";
import Database from "better-sqlite3";
import { repairDeckFolderTrashSchemaAsync } from "./migrationRepair";

type AsyncSqliteDb = {
	execAsync: (sql: string) => Promise<void>;
	getAllAsync: <T>(sql: string, ...params: unknown[]) => Promise<T[]>;
	getFirstAsync: <T>(sql: string, ...params: unknown[]) => Promise<T | null>;
	runAsync: (sql: string, ...params: unknown[]) => Promise<void>;
};

const createAsyncDb = () => {
	const sqlite = new Database(":memory:");

	const db: AsyncSqliteDb = {
		async execAsync(sql: string) {
			sqlite.exec(sql);
		},
		async getAllAsync<T>(sql: string, ...params: unknown[]) {
			return sqlite.prepare(sql).all(...params) as T[];
		},
		async getFirstAsync<T>(sql: string, ...params: unknown[]) {
			return (sqlite.prepare(sql).get(...params) as T | undefined) ?? null;
		},
		async runAsync(sql: string, ...params: unknown[]) {
			sqlite.prepare(sql).run(...params);
		},
	};

	return { sqlite, db };
};

const createPreReviewUndoSchema = (sqlite: Database.Database) => {
	sqlite.exec(`
		CREATE TABLE "__drizzle_migrations" (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			hash text NOT NULL,
			created_at numeric
		);
		CREATE TABLE knowledge (
			id text PRIMARY KEY NOT NULL,
			primary_pitch_accent_dictionary_id text,
			primary_pitch_accent_reading text,
			primary_pitch_accent_accent_number integer,
			primary_pitch_accent_is_custom integer
		);
		CREATE TABLE decks_folders (
			id text PRIMARY KEY NOT NULL,
			name text NOT NULL,
			language_id text,
			parent_id text,
			deleted integer DEFAULT 0 NOT NULL,
			deleted_at text,
			daily_new_limit_enabled integer,
			daily_new_limit integer,
			daily_review_limit_enabled integer,
			daily_review_limit integer,
			new_cards_paused integer DEFAULT 0
		);
		CREATE TABLE decks (
			id text PRIMARY KEY NOT NULL,
			name text NOT NULL,
			language_id text,
			folder_id text,
			deleted integer DEFAULT 0 NOT NULL,
			deleted_at text,
			daily_new_limit_enabled integer,
			daily_new_limit integer,
			daily_review_limit_enabled integer,
			daily_review_limit integer,
			new_cards_paused integer DEFAULT 0
		);
		CREATE TABLE review_log (
			id text PRIMARY KEY NOT NULL,
			knowledge_id text,
			review text NOT NULL,
			due text NOT NULL,
			stability real DEFAULT 0 NOT NULL,
			difficulty real DEFAULT 0 NOT NULL,
			elapsed_days real DEFAULT 0 NOT NULL,
			scheduled_days real DEFAULT 0 NOT NULL,
			state text DEFAULT 'New' NOT NULL,
			last_elapsed_days real DEFAULT 0 NOT NULL,
			deleted integer DEFAULT 0,
			learning_steps integer DEFAULT 0 NOT NULL,
			FOREIGN KEY (knowledge_id) REFERENCES knowledge(id) ON DELETE cascade
		);
	`);
};

test("repairs stale review sync schema even when migrations claim the database is current", async () => {
	const { sqlite, db } = createAsyncDb();
	createPreReviewUndoSchema(sqlite);
	sqlite
		.prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`)
		.run("", 1777075200000);
	sqlite.prepare("INSERT INTO knowledge (id) VALUES (?)").run("knowledge_1");
	sqlite
		.prepare(
			"INSERT INTO review_log (id, knowledge_id, review, due) VALUES (?, ?, ?, ?)",
		)
		.run("log_1", "knowledge_1", "2026-04-12 10:00:00.000", "2026-04-13 10:00:00.000");

	await repairDeckFolderTrashSchemaAsync(db as never);

	const reviewLogColumns = sqlite
		.prepare("PRAGMA table_info(review_log)")
		.all() as Array<{ name: string }>;
	assert.ok(reviewLogColumns.some((column) => column.name === "created_at"));
	assert.ok(reviewLogColumns.some((column) => column.name === "updated_at"));

	const repairedReviewLog = sqlite
		.prepare("SELECT created_at, updated_at FROM review_log WHERE id = ?")
		.get("log_1") as { created_at: string; updated_at: string };
	assert.equal(repairedReviewLog.created_at, "2026-04-12 10:00:00.000");
	assert.equal(repairedReviewLog.updated_at, "2026-04-12 10:00:00.000");

	const tables = sqlite
		.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
		.all() as Array<{ name: string }>;
	assert.ok(tables.some((table) => table.name === "permanent_deletes"));
	assert.ok(tables.some((table) => table.name === "review_undo"));
});

test("records missing migration markers after repairing a database stuck at migration 0019", async () => {
	const { sqlite, db } = createAsyncDb();
	createPreReviewUndoSchema(sqlite);
	sqlite
		.prepare(`INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`)
		.run("", 1776902400000);

	await repairDeckFolderTrashSchemaAsync(db as never);

	const migrationRows = sqlite
		.prepare('SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at')
		.all() as Array<{ created_at: number }>;
	const migrationMillis = migrationRows.map((row) => row.created_at);

	assert.ok(migrationMillis.includes(1776988800000));
	assert.ok(migrationMillis.includes(1777075200000));
});
