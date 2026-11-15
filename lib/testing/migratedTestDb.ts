import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";

const MIGRATIONS_DIR = path.resolve(__dirname, "../../drizzle");

/**
 * In-memory SQLite database with every Drizzle migration in `drizzle/` applied,
 * in order. Tests use this instead of hand-written CREATE TABLE statements so a
 * new migration can never leave the test schema behind the app schema.
 *
 * Foreign keys are left OFF to match the app: expo-sqlite does not enable
 * `PRAGMA foreign_keys`, while better-sqlite3 turns it on by default.
 */
export const createMigratedSqlite = (): Database.Database => {
	const sqlite = new Database(":memory:");
	sqlite.pragma("foreign_keys = OFF");
	const migrationFiles = fs
		.readdirSync(MIGRATIONS_DIR)
		.filter((file) => file.endsWith(".sql"))
		.sort();

	for (const file of migrationFiles) {
		sqlite.exec(fs.readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8"));
	}

	return sqlite;
};
