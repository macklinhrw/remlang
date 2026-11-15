import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import * as schema from "@/lib/database/schema";
import journal from "@/drizzle/meta/_journal.json";
import type { SeedDb } from "./types";

export const DB_OUTPUT_PATH = "assets/database.db";
export const RESOURCES_PATH = "assets/resources";

const ensureAssetsDir = () => {
  if (!fs.existsSync("assets")) {
    fs.mkdirSync("assets");
  }
};

const applyMigrations = (sqlite: Database.Database) => {
  const migrationFolder = path.join(process.cwd(), "drizzle");
  const migrationFiles = fs
    .readdirSync(migrationFolder)
    .filter((file) => file.endsWith(".sql"))
    .sort();

  for (const file of migrationFiles) {
    const migrationPath = path.join(migrationFolder, file);
    const sql = fs.readFileSync(migrationPath, "utf-8");
    sqlite.exec(sql);
  }
};

const writeDrizzleMigrationState = (sqlite: Database.Database) => {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS "__drizzle_migrations" (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      hash text NOT NULL,
      created_at numeric
    )
  `);

  const insert = sqlite.prepare(
    `INSERT OR IGNORE INTO "__drizzle_migrations" ("hash", "created_at") VALUES (?, ?)`,
  );
  const transaction = sqlite.transaction(() => {
    for (const entry of journal.entries) {
      insert.run("", entry.when);
    }
  });
  transaction();
};

export const createFreshSeedDatabase = () => {
  ensureAssetsDir();
  if (fs.existsSync(DB_OUTPUT_PATH)) {
    fs.unlinkSync(DB_OUTPUT_PATH);
  }
  const sqlite = new Database(DB_OUTPUT_PATH);
  applyMigrations(sqlite);
  writeDrizzleMigrationState(sqlite);
  const db: SeedDb = drizzle(sqlite, { schema });
  return { sqlite, db };
};

export const openSeedDatabase = () => {
  ensureAssetsDir();
  const sqlite = new Database(DB_OUTPUT_PATH);
  const db: SeedDb = drizzle(sqlite, { schema });
  return { sqlite, db };
};
