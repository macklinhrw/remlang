import type { SQLiteDatabase } from "expo-sqlite";

const FOLDER_LANGUAGE_SCOPE_MIGRATION_MILLIS = 1776124800000;
const FOLDER_TRASH_MIGRATION_MILLIS = 1776211200000;
const REVIEW_LIMITS_MIGRATION_MILLIS = 1776297600000;
const DECK_NEW_CARDS_PAUSED_MIGRATION_MILLIS = 1776384000000;
const FOLDER_NEW_CARDS_PAUSED_MIGRATION_MILLIS = 1776556800000;
const PERMANENT_DELETES_MIGRATION_MILLIS = 1776988800000;
const REVIEW_UNDO_MIGRATION_MILLIS = 1777075200000;

type TableInfoRow = {
	name: string;
};

type MigrationRow = {
	created_at: number | string | null;
};

const getTableColumnNames = async (db: SQLiteDatabase, tableName: string) => {
	const rows = await db.getAllAsync<TableInfoRow>(`PRAGMA table_info(${tableName})`);
	return new Set(rows.map((row) => row.name));
};

const hasTable = async (db: SQLiteDatabase, tableName: string) => {
	const row = await db.getFirstAsync<{ name: string }>(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = ? LIMIT 1",
		tableName,
	);

	return Boolean(row);
};

const getLastMigrationMillis = async (db: SQLiteDatabase) => {
	const migrationTable = await db.getFirstAsync<{ name: string }>(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations' LIMIT 1",
	);

	if (!migrationTable) {
		return null;
	}

	const row = await db.getFirstAsync<MigrationRow>(
		'SELECT created_at FROM "__drizzle_migrations" ORDER BY created_at DESC LIMIT 1',
	);
	const value = Number(row?.created_at ?? 0);
	return Number.isFinite(value) && value > 0 ? value : 0;
};

const ensureMigrationMarker = async (
	db: SQLiteDatabase,
	migrationMillis: number,
) => {
	const migrationTable = await db.getFirstAsync<{ name: string }>(
		"SELECT name FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations' LIMIT 1",
	);

	if (!migrationTable) {
		return;
	}

	const existingRow = await db.getFirstAsync<{ id: number }>(
		'SELECT id FROM "__drizzle_migrations" WHERE created_at = ? LIMIT 1',
		migrationMillis,
	);

	if (existingRow) {
		return;
	}

	await db.runAsync(
		'INSERT INTO "__drizzle_migrations" ("hash", "created_at") VALUES(?, ?)',
		"",
		migrationMillis,
	);
};

const repairPermanentDeletesSchemaAsync = async (
	db: SQLiteDatabase,
	lastMigrationMillis: number | null,
) => {
	const permanentDeletesExists = await hasTable(db, "permanent_deletes");

	if (!permanentDeletesExists) {
		await db.execAsync(`
			CREATE TABLE \`permanent_deletes\` (
				\`id\` text PRIMARY KEY NOT NULL,
				\`entity_type\` text NOT NULL,
				\`entity_id\` text NOT NULL,
				\`deleted_at\` text NOT NULL
			);
		`);
	}

	if (!permanentDeletesExists) {
		await db.execAsync(
			"CREATE INDEX IF NOT EXISTS `permanent_deletes_entity_idx` ON `permanent_deletes` (`entity_type`, `entity_id`);",
		);
		await db.execAsync(
			"CREATE INDEX IF NOT EXISTS `permanent_deletes_deleted_at_idx` ON `permanent_deletes` (`deleted_at`);",
		);
		await ensureMigrationMarker(db, PERMANENT_DELETES_MIGRATION_MILLIS);
		return;
	}

	await db.execAsync(
		"CREATE INDEX IF NOT EXISTS `permanent_deletes_entity_idx` ON `permanent_deletes` (`entity_type`, `entity_id`);",
	);
	await db.execAsync(
		"CREATE INDEX IF NOT EXISTS `permanent_deletes_deleted_at_idx` ON `permanent_deletes` (`deleted_at`);",
	);

	if (
		lastMigrationMillis !== null &&
		lastMigrationMillis < PERMANENT_DELETES_MIGRATION_MILLIS
	) {
		await ensureMigrationMarker(db, PERMANENT_DELETES_MIGRATION_MILLIS);
	}
};

const repairReviewUndoSchemaAsync = async (
	db: SQLiteDatabase,
	lastMigrationMillis: number | null,
) => {
	const reviewLogColumnNames = await getTableColumnNames(db, "review_log");
	const reviewUndoExists = await hasTable(db, "review_undo");
	const addedReviewLogColumns: string[] = [];

	if (!reviewLogColumnNames.has("created_at")) {
		await db.execAsync("ALTER TABLE `review_log` ADD COLUMN `created_at` text;");
		addedReviewLogColumns.push("created_at");
	}

	if (!reviewLogColumnNames.has("updated_at")) {
		await db.execAsync("ALTER TABLE `review_log` ADD COLUMN `updated_at` text;");
		addedReviewLogColumns.push("updated_at");
	}

	if (addedReviewLogColumns.length > 0) {
		await db.execAsync(`
			UPDATE \`review_log\`
			SET
				\`created_at\` = COALESCE(\`created_at\`, \`review\`),
				\`updated_at\` = COALESCE(\`updated_at\`, \`review\`);
		`);
	}

	if (!reviewUndoExists) {
		await db.execAsync(`
			CREATE TABLE \`review_undo\` (
				\`id\` text PRIMARY KEY NOT NULL,
				\`knowledge_id\` text NOT NULL,
				\`review_log_id\` text NOT NULL,
				\`due\` text NOT NULL,
				\`stability\` real DEFAULT 0 NOT NULL,
				\`difficulty\` real DEFAULT 0 NOT NULL,
				\`elapsed_days\` real DEFAULT 0 NOT NULL,
				\`scheduled_days\` real DEFAULT 0 NOT NULL,
				\`learning_steps\` integer DEFAULT 0 NOT NULL,
				\`reps\` integer DEFAULT 0 NOT NULL,
				\`lapses\` integer DEFAULT 0 NOT NULL,
				\`state\` text DEFAULT 'New' NOT NULL,
				\`last_review\` text NOT NULL,
				\`undone\` integer DEFAULT false NOT NULL,
				\`invalidated\` integer DEFAULT false NOT NULL,
				\`created_at\` text DEFAULT (strftime('%Y-%m-%d %H:%M:%f', 'now')),
				\`updated_at\` text,
				FOREIGN KEY (\`knowledge_id\`) REFERENCES \`knowledge\`(\`id\`) ON UPDATE no action ON DELETE cascade,
				FOREIGN KEY (\`review_log_id\`) REFERENCES \`review_log\`(\`id\`) ON UPDATE no action ON DELETE cascade
			);
		`);
	}

	if (!reviewUndoExists) {
		await db.execAsync(
			"CREATE INDEX IF NOT EXISTS `review_undo_active_idx` ON `review_undo` (`invalidated`, `undone`, `created_at`);",
		);
		await db.execAsync(
			"CREATE INDEX IF NOT EXISTS `review_undo_knowledge_idx` ON `review_undo` (`knowledge_id`, `created_at`);",
		);
		await ensureMigrationMarker(db, REVIEW_UNDO_MIGRATION_MILLIS);
		return;
	}

	await db.execAsync(
		"CREATE INDEX IF NOT EXISTS `review_undo_active_idx` ON `review_undo` (`invalidated`, `undone`, `created_at`);",
	);
	await db.execAsync(
		"CREATE INDEX IF NOT EXISTS `review_undo_knowledge_idx` ON `review_undo` (`knowledge_id`, `created_at`);",
	);

	if (addedReviewLogColumns.length > 0) {
		await ensureMigrationMarker(db, REVIEW_UNDO_MIGRATION_MILLIS);
		return;
	}

	if (
		lastMigrationMillis !== null &&
		lastMigrationMillis < REVIEW_UNDO_MIGRATION_MILLIS
	) {
		await ensureMigrationMarker(db, REVIEW_UNDO_MIGRATION_MILLIS);
	}
};

export const repairDeckFolderTrashSchemaAsync = async (db: SQLiteDatabase) => {
	const folderColumnNames = await getTableColumnNames(db, "decks_folders");
	const deckColumnNames = await getTableColumnNames(db, "decks");
	const hasLanguageId = folderColumnNames.has("language_id");
	const hasDeleted = folderColumnNames.has("deleted");
	const hasDeletedAt = folderColumnNames.has("deleted_at");

	if (!hasLanguageId) {
		return;
	}

	const lastMigrationMillis = await getLastMigrationMillis(db);

	if (
		lastMigrationMillis !== null &&
		lastMigrationMillis < FOLDER_LANGUAGE_SCOPE_MIGRATION_MILLIS
	) {
		return;
	}

	if (!hasDeleted) {
		await db.execAsync(
			"ALTER TABLE `decks_folders` ADD COLUMN `deleted` integer DEFAULT 0 NOT NULL;",
		);
	}

	if (!hasDeletedAt) {
		await db.execAsync(
			"ALTER TABLE `decks_folders` ADD COLUMN `deleted_at` text;",
		);
	}

	if (!hasDeleted || !hasDeletedAt) {
		await ensureMigrationMarker(db, FOLDER_TRASH_MIGRATION_MILLIS);
		return;
	}

	if (
		lastMigrationMillis !== null &&
		lastMigrationMillis < FOLDER_TRASH_MIGRATION_MILLIS
	) {
		await ensureMigrationMarker(db, FOLDER_TRASH_MIGRATION_MILLIS);
	}

	const missingDeckReviewLimitColumns = [
		"daily_new_limit_enabled",
		"daily_new_limit",
		"daily_review_limit_enabled",
		"daily_review_limit",
	].filter((columnName) => !deckColumnNames.has(columnName));
	const missingFolderReviewLimitColumns = [
		"daily_new_limit_enabled",
		"daily_new_limit",
		"daily_review_limit_enabled",
		"daily_review_limit",
	].filter((columnName) => !folderColumnNames.has(columnName));

	for (const columnName of missingDeckReviewLimitColumns) {
		await db.execAsync(`ALTER TABLE \`decks\` ADD COLUMN \`${columnName}\` integer;`);
	}

	for (const columnName of missingFolderReviewLimitColumns) {
		await db.execAsync(
			`ALTER TABLE \`decks_folders\` ADD COLUMN \`${columnName}\` integer;`,
		);
	}

	if (missingDeckReviewLimitColumns.length > 0 || missingFolderReviewLimitColumns.length > 0) {
		await ensureMigrationMarker(db, REVIEW_LIMITS_MIGRATION_MILLIS);
		return;
	}

	if (
		lastMigrationMillis !== null &&
		lastMigrationMillis < REVIEW_LIMITS_MIGRATION_MILLIS
	) {
		await ensureMigrationMarker(db, REVIEW_LIMITS_MIGRATION_MILLIS);
	}

	if (!deckColumnNames.has("new_cards_paused")) {
		await db.execAsync(
			"ALTER TABLE `decks` ADD COLUMN `new_cards_paused` integer DEFAULT 0;",
		);
		await ensureMigrationMarker(db, DECK_NEW_CARDS_PAUSED_MIGRATION_MILLIS);
		return;
	}

	if (
		lastMigrationMillis !== null &&
		lastMigrationMillis < DECK_NEW_CARDS_PAUSED_MIGRATION_MILLIS
	) {
		await ensureMigrationMarker(db, DECK_NEW_CARDS_PAUSED_MIGRATION_MILLIS);
	}

	if (!folderColumnNames.has("new_cards_paused")) {
		await db.execAsync(
			"ALTER TABLE `decks_folders` ADD COLUMN `new_cards_paused` integer DEFAULT 0;",
		);
		await ensureMigrationMarker(db, FOLDER_NEW_CARDS_PAUSED_MIGRATION_MILLIS);
		return;
	}

	if (
		lastMigrationMillis !== null &&
		lastMigrationMillis < FOLDER_NEW_CARDS_PAUSED_MIGRATION_MILLIS
	) {
		await ensureMigrationMarker(db, FOLDER_NEW_CARDS_PAUSED_MIGRATION_MILLIS);
	}

	await repairPermanentDeletesSchemaAsync(db, lastMigrationMillis);
	await repairReviewUndoSchemaAsync(db, lastMigrationMillis);
};
