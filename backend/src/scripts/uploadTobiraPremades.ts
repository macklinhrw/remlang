import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import * as schema from "../db/schema";

type RawPremadeDictionaryLink = {
	entryId: string;
	senseIds: string[];
	usesAllSenses: boolean;
	matchStatus: string;
	matchMethod: string;
};

type RawPremadeDeckItem = {
	id: string;
	sourceTag: string;
	kana: string | null;
	kanji: string | null;
	english: string;
	front: string;
	pronunciation: string | null;
	sourceDefinitions: string;
	dictionaryLink: RawPremadeDictionaryLink | null;
};

type RawPremadeDeckFile = {
	deck: {
		id: string;
		book: string;
		lesson: number;
		name: string;
		languageId: string;
		source: string;
	};
	list: RawPremadeDeckItem[];
};

const currentFilePath = fileURLToPath(import.meta.url);
const backendRoot = path.resolve(path.dirname(currentFilePath), "../..");
const repoRoot = path.resolve(backendRoot, "..");
const decklistsRoot = path.join(repoRoot, "assets", "decklists");
const fileFilter = process.env.TOBIRA_UPLOAD_FILTER?.trim() || null;
const TOBIRA_BOOK_DIRECTORIES = [
	"tobira-1",
	"tobira-1-counting",
	"tobira-2",
	"tobira-2-counting",
];

const loadLocalEnv = () => {
	for (const root of [repoRoot, backendRoot]) {
		for (const fileName of [".env", ".env.local"]) {
			const envPath = path.join(root, fileName);
			if (!fs.existsSync(envPath)) {
				continue;
			}

			const contents = fs.readFileSync(envPath, "utf-8");
			for (const rawLine of contents.split(/\r?\n/)) {
				const line = rawLine.trim();
				if (!line || line.startsWith("#")) {
					continue;
				}

				const separatorIndex = line.indexOf("=");
				if (separatorIndex <= 0) {
					continue;
				}

				const key = line.slice(0, separatorIndex).trim();
				if (!key || process.env[key] !== undefined) {
					continue;
				}

				let value = line.slice(separatorIndex + 1).trim();
				if (
					(value.startsWith('"') && value.endsWith('"')) ||
					(value.startsWith("'") && value.endsWith("'"))
				) {
					value = value.slice(1, -1);
				}

				process.env[key] = value;
			}
		}
	}
};

const requireEnv = (name: string) => {
	const value = process.env[name]?.trim();
	if (!value) {
		throw new Error(`Missing required environment variable: ${name}`);
	}
	return value;
};

const normalizeDatabaseUrl = (value: string) => {
	const url = new URL(value);
	const sslmode = url.searchParams.get("sslmode");
	const sslrootcert = url.searchParams.get("sslrootcert");

	url.searchParams.delete("sslmode");
	url.searchParams.delete("sslrootcert");

	return {
		databaseUrl: url.toString(),
		useSsl:
			sslmode === "require" ||
			sslmode === "verify-ca" ||
			sslmode === "verify-full" ||
			Boolean(sslrootcert),
	};
};

const listDecklistFiles = () =>
	TOBIRA_BOOK_DIRECTORIES
		.flatMap((book) => {
			const directory = path.join(decklistsRoot, book);
			if (!fs.existsSync(directory)) {
				return [];
			}

			return fs
				.readdirSync(directory)
				.filter((fileName) => fileName.endsWith(".json"))
				.map((fileName) => path.join(directory, fileName));
		})
		.filter((filePath) => (fileFilter ? filePath.includes(fileFilter) : true))
		.sort((left, right) => left.localeCompare(right, undefined, { numeric: true }));

const readDecklistFiles = () =>
	listDecklistFiles().map((filePath) => ({
		filePath,
		payload: JSON.parse(fs.readFileSync(filePath, "utf-8")) as RawPremadeDeckFile,
	}));

const main = async () => {
	loadLocalEnv();

	const databaseConfig = normalizeDatabaseUrl(requireEnv("DATABASE_URL"));
	const client = postgres(databaseConfig.databaseUrl, {
		max: 1,
		prepare: false,
		ssl: databaseConfig.useSsl ? "require" : false,
	});
	const db = drizzle(client, { schema });
	const deckFiles = readDecklistFiles();
	const importedDeckIds = new Set<string>();
	const importedItemIds = new Set<string>();
	const timestamp = new Date();
	const timestampIso = timestamp.toISOString();

	if (deckFiles.length === 0) {
		throw new Error(`No Tobira decklists found under ${decklistsRoot}.`);
	}

	try {
		await db.transaction(async (tx) => {
			for (const { payload } of deckFiles) {
				importedDeckIds.add(payload.deck.id);
				await tx
					.insert(schema.premadeDecks)
					.values({
						id: payload.deck.id,
						slug: payload.deck.id,
						name: payload.deck.name,
						book: payload.deck.book,
						lesson: payload.deck.lesson,
						languageId: payload.deck.languageId,
						source: payload.deck.source,
						isPublished: true,
						deletedAt: null,
						updatedAt: timestamp,
						serverUpdatedAt: timestamp,
					})
					.onConflictDoUpdate({
						target: schema.premadeDecks.id,
						set: {
							slug: payload.deck.id,
							name: payload.deck.name,
							book: payload.deck.book,
							lesson: payload.deck.lesson,
							languageId: payload.deck.languageId,
							source: payload.deck.source,
							isPublished: true,
							deletedAt: null,
							updatedAt: timestamp,
							serverUpdatedAt: timestamp,
						},
					});

				for (const [index, item] of payload.list.entries()) {
					importedItemIds.add(item.id);
					await tx
						.insert(schema.premadeItems)
						.values({
							id: item.id,
							premadeDeckId: payload.deck.id,
							sortOrder: index + 1,
							sourceTag: item.sourceTag,
							kana: item.kana,
							kanji: item.kanji,
							english: item.english,
							front: item.front,
							pronunciation: item.pronunciation,
							sourceDefinitions: item.sourceDefinitions,
							dictionaryEntryId: item.dictionaryLink?.entryId ?? null,
							dictionarySenseIds: item.dictionaryLink?.senseIds ?? [],
							usesAllSenses: item.dictionaryLink?.usesAllSenses ?? false,
							matchStatus: item.dictionaryLink?.matchStatus ?? null,
							matchMethod: item.dictionaryLink?.matchMethod ?? null,
							deletedAt: null,
							updatedAt: timestamp,
							serverUpdatedAt: timestamp,
						})
						.onConflictDoUpdate({
							target: schema.premadeItems.id,
							set: {
								premadeDeckId: payload.deck.id,
								sortOrder: index + 1,
								sourceTag: item.sourceTag,
								kana: item.kana,
								kanji: item.kanji,
								english: item.english,
								front: item.front,
								pronunciation: item.pronunciation,
								sourceDefinitions: item.sourceDefinitions,
								dictionaryEntryId: item.dictionaryLink?.entryId ?? null,
								dictionarySenseIds: item.dictionaryLink?.senseIds ?? [],
								usesAllSenses: item.dictionaryLink?.usesAllSenses ?? false,
								matchStatus: item.dictionaryLink?.matchStatus ?? null,
								matchMethod: item.dictionaryLink?.matchMethod ?? null,
								deletedAt: null,
								updatedAt: timestamp,
								serverUpdatedAt: timestamp,
							},
						});
				}
			}

			if (!fileFilter) {
				const existingDeckRows = await tx.query.premadeDecks.findMany({
					where: eq(schema.premadeDecks.source, "tobira"),
				});
				const existingTobiraDeckIds = new Set(existingDeckRows.map((row) => row.id));
				for (const row of existingDeckRows) {
					if (importedDeckIds.has(row.id)) {
						continue;
					}

					await tx
						.update(schema.premadeDecks)
						.set({
							isPublished: false,
							deletedAt: timestamp,
							updatedAt: timestamp,
							serverUpdatedAt: timestamp,
						})
						.where(eq(schema.premadeDecks.id, row.id));
				}

				const existingItemRows = await tx.query.premadeItems.findMany();
				for (const row of existingItemRows) {
					if (!existingTobiraDeckIds.has(row.premadeDeckId)) {
						continue;
					}
					if (importedItemIds.has(row.id)) {
						continue;
					}

					await tx
						.update(schema.premadeItems)
						.set({
							deletedAt: timestamp,
							updatedAt: timestamp,
							serverUpdatedAt: timestamp,
						})
						.where(eq(schema.premadeItems.id, row.id));
				}
			}
		});

		console.log(
			JSON.stringify(
				{
					ok: true,
					decksImported: importedDeckIds.size,
					itemsImported: importedItemIds.size,
					filtered: Boolean(fileFilter),
					importedAt: timestampIso,
				},
				null,
				2,
			),
		);
	} finally {
		await client.end({ timeout: 5 });
	}
};

void main();
