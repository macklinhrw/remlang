import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { getEntryDetail, type EntryDetailResult } from "@/lib/database/lexicon";
import {
	cards,
	decks,
	decksFolders,
	knowledge,
	premadeDecks,
	premadeItems,
	premadeSyncState,
	type ReviewType,
} from "@/lib/database/schema";
import { generateId } from "@/lib/id";
import {
	DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
	buildKnowledgeConfigSignature,
	getDefaultKnowledgeDefinitionConfig,
	getGlossKey,
	getKnowledgeDefinitionTexts,
	getNextKnowledgeConfigLabel,
	serializeKnowledgeDefinitionConfig,
} from "@/lib/knowledge/config";
import { pullCloudPremadeDecks } from "@/lib/premadeDecks/client";
import {
	getPremadeBookLabel,
	getPremadeBookSortOrder,
	inferPremadeBookFromDeckId,
	type PremadeDeckItem,
	type PremadeDeckItemRecord,
	type PremadeDeckRecord,
	type PremadeDeckTombstone,
	type PremadeDeckItemTombstone,
} from "@/lib/premadeDecks/types";
import {
	addPremadeItemToDeck,
	createDeck,
	refreshDecksStore,
} from "@/lib/store/decksStore";
import { hasPitchAccentReviewSupport } from "@/lib/review/pitchEligibility";
import { hasStrokeEligibleCharacters } from "@/lib/review/strokeEligibility";
import { markLocalChange } from "@/lib/sync/settings";

const getPremadeSyncStateId = (languageId?: string | null) =>
	`premade:${languageId?.trim() || "all"}`;

export type PremadeSyncStateSnapshot = {
	lastPulledAt: string | null;
	lastCursor: string | null;
	lastSuccessfulSyncAt: string | null;
	lastError: string | null;
};

export type CachedPremadeDeckListItem = PremadeDeckRecord & {
	itemCount: number;
};

export type CachedPremadeBookListItem = {
	book: PremadeDeckRecord["book"];
	name: string;
	decks: CachedPremadeDeckListItem[];
	itemCount: number;
};

export type PremadeCollectionCopyProgress = {
	phase: "loading_decks" | "resolving_entries" | "writing_knowledge" | "writing_cards" | "finalizing";
	label: string;
	current: number;
	total: number;
};

const BULK_INSERT_BATCH_SIZE = 100;
const PREMADE_PULL_PAGE_SIZE = 100;
const PREMADE_CACHE_DELETE_BATCH_SIZE = 200;

const yieldToEventLoop = () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});

const trimOrNull = (value: string | null | undefined) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
};

const buildKnowledgeConfigFromSenseIds = (
	entry: EntryDetailResult,
	senseIds: string[],
) => {
	const selectedSenseIds = entry.senses
		.filter((sense) => senseIds.includes(sense.id))
		.map((sense) => sense.id);

	if (selectedSenseIds.length === 0) {
		return null;
	}

	return {
		selectedSenseIds,
		selectedGlossKeys: entry.senses
			.filter((sense) => selectedSenseIds.includes(sense.id))
			.flatMap((sense) =>
				sense.glosses.map((gloss) =>
					getGlossKey(sense.id, gloss.glossOrder, gloss.glossLanguage),
				),
			),
	};
};

const buildPremadeKnowledgePayload = ({
	item,
	entry,
}: {
	item: PremadeDeckItem;
	entry: EntryDetailResult | null;
}) => {
	const trustedEntryId = item.dictionaryLink?.entryId && entry?.id === item.dictionaryLink.entryId
		? entry.id
		: null;
	const sourceDefinitions = trimOrNull(item.sourceDefinitions) ?? item.english.trim();

	if (!trustedEntryId || !entry || !item.dictionaryLink) {
		return {
			front: item.front,
			definitions: sourceDefinitions || "No definition available.",
			sourceDefinitions,
			pronunciation: trimOrNull(item.pronunciation),
			entryId: null,
			configSignature: DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
			definitionConfig: null,
		};
	}

	if (!item.dictionaryLink.usesAllSenses && item.dictionaryLink.senseIds.length > 0) {
		const config = buildKnowledgeConfigFromSenseIds(entry, item.dictionaryLink.senseIds);
		const definitions = config ? getKnowledgeDefinitionTexts(entry, config).join("\n").trim() : "";

		return {
			front: entry.canonicalForm ?? item.front,
			definitions: definitions || sourceDefinitions || "No definition available.",
			sourceDefinitions,
			pronunciation: trimOrNull(entry.canonicalReading) ?? trimOrNull(item.pronunciation),
			entryId: entry.id,
			configSignature: config
				? buildKnowledgeConfigSignature(entry, config)
				: DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
			definitionConfig: config ? serializeKnowledgeDefinitionConfig(entry, config) : null,
		};
	}

	const defaultConfig = getDefaultKnowledgeDefinitionConfig(entry);

	return {
		front: entry.canonicalForm ?? item.front,
		definitions: sourceDefinitions || "No definition available.",
		sourceDefinitions,
		pronunciation: trimOrNull(entry.canonicalReading) ?? trimOrNull(item.pronunciation),
		entryId: entry.id,
		configSignature: DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
		definitionConfig: serializeKnowledgeDefinitionConfig(entry, defaultConfig),
	};
};

const customKnowledgeKey = ({
	reviewType,
	front,
	definitions,
	sourceDefinitions,
	pronunciation,
}: {
	reviewType: string;
	front: string;
	definitions: string;
	sourceDefinitions: string | null;
	pronunciation: string | null;
}) =>
	JSON.stringify([
		reviewType,
		front,
		definitions,
		sourceDefinitions ?? null,
		pronunciation ?? null,
	]);

const chunkArray = <T,>(items: T[], size: number) => {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
};

const parseSenseIdList = (value: string) => {
	try {
		const parsed = JSON.parse(value) as unknown;
		return Array.isArray(parsed)
			? parsed.filter((item): item is string => typeof item === "string")
			: [];
	} catch {
		return [];
	}
};

const persistPremadeSyncState = async (
	db: DrizzleInstance,
	values: Partial<typeof premadeSyncState.$inferInsert> & {
		id?: string;
		languageId?: string | null;
	},
) => {
	await db
		.insert(premadeSyncState)
		.values({
			id: values.id ?? getPremadeSyncStateId(values.languageId),
			lastPulledAt: values.lastPulledAt ?? null,
			lastCursor: values.lastCursor ?? null,
			lastSuccessfulSyncAt: values.lastSuccessfulSyncAt ?? null,
			lastError: values.lastError ?? null,
		})
		.onConflictDoUpdate({
			target: premadeSyncState.id,
			set: {
				lastPulledAt: values.lastPulledAt ?? null,
				lastCursor: values.lastCursor ?? null,
				lastSuccessfulSyncAt: values.lastSuccessfulSyncAt ?? null,
				lastError: values.lastError ?? null,
			},
		});
};

const normalizePremadeDeck = (
	row: typeof premadeDecks.$inferSelect,
): PremadeDeckRecord => ({
	id: row.id,
	slug: row.slug,
	name: row.name,
	book:
		inferPremadeBookFromDeckId(row.id) ??
		(row.book as PremadeDeckRecord["book"]),
	lesson: row.lesson,
	languageId: row.languageId,
	source: row.source as PremadeDeckRecord["source"],
	isPublished: row.isPublished,
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

const normalizePremadeItem = (
	row: typeof premadeItems.$inferSelect,
): PremadeDeckItemRecord => ({
	id: row.id,
	premadeDeckId: row.premadeDeckId,
	sortOrder: row.sortOrder,
	sourceTag: row.sourceTag,
	kana: row.kana ?? null,
	kanji: row.kanji ?? null,
	english: row.english,
	front: row.front,
	pronunciation: row.pronunciation ?? null,
	sourceDefinitions: row.sourceDefinitions,
	dictionaryEntryId: row.dictionaryEntryId ?? null,
	dictionarySenseIds: parseSenseIdList(row.dictionarySenseIds),
	usesAllSenses: row.usesAllSenses,
	matchStatus: row.matchStatus as PremadeDeckItemRecord["matchStatus"],
	matchMethod: row.matchMethod as PremadeDeckItemRecord["matchMethod"],
	createdAt: row.createdAt,
	updatedAt: row.updatedAt,
});

const toPremadeDeckItem = (item: PremadeDeckItemRecord): PremadeDeckItem => ({
	id: item.id,
	sourceTag: item.sourceTag,
	kana: item.kana,
	kanji: item.kanji,
	english: item.english,
	front: item.front,
	pronunciation: item.pronunciation,
	sourceDefinitions: item.sourceDefinitions,
	dictionaryLink: item.dictionaryEntryId
		? {
				entryId: item.dictionaryEntryId,
				senseIds: item.dictionarySenseIds,
				usesAllSenses: item.usesAllSenses,
				matchStatus: item.matchStatus ?? "unlinked",
				matchMethod: item.matchMethod ?? "none",
			}
		: null,
});

const upsertActiveDecks = async (
	db: DrizzleInstance,
	rows: PremadeDeckTombstone[],
) => {
	const activeRows = rows.filter((row) => row.deletedAt === null && row.isPublished);
	if (activeRows.length === 0) {
		return 0;
	}

	for (const batch of chunkArray(activeRows, BULK_INSERT_BATCH_SIZE)) {
		await db
			.insert(premadeDecks)
			.values(
				batch.map((row) => ({
					id: row.id,
					slug: row.slug,
					name: row.name,
					book: row.book,
					lesson: row.lesson,
					languageId: row.languageId,
					source: row.source,
					isPublished: row.isPublished,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
				})),
			)
			.onConflictDoUpdate({
				target: premadeDecks.id,
				set: {
					slug: sql`excluded.slug`,
					name: sql`excluded.name`,
					book: sql`excluded.book`,
					lesson: sql`excluded.lesson`,
					languageId: sql`excluded.language_id`,
					source: sql`excluded.source`,
					isPublished: sql`excluded.is_published`,
					createdAt: sql`excluded.created_at`,
					updatedAt: sql`excluded.updated_at`,
				},
			});
		await yieldToEventLoop();
	}

	return activeRows.length;
};

const upsertActiveItems = async (
	db: DrizzleInstance,
	rows: PremadeDeckItemTombstone[],
	deletedDeckIds: Set<string>,
) => {
	const activeRows = rows.filter(
		(row) => row.deletedAt === null && !deletedDeckIds.has(row.premadeDeckId),
	);
	if (activeRows.length === 0) {
		return 0;
	}

	for (const batch of chunkArray(activeRows, BULK_INSERT_BATCH_SIZE)) {
		await db
			.insert(premadeItems)
			.values(
				batch.map((row) => ({
					id: row.id,
					premadeDeckId: row.premadeDeckId,
					sortOrder: row.sortOrder,
					sourceTag: row.sourceTag,
					kana: row.kana,
					kanji: row.kanji,
					english: row.english,
					front: row.front,
					pronunciation: row.pronunciation,
					sourceDefinitions: row.sourceDefinitions,
					dictionaryEntryId: row.dictionaryEntryId,
					dictionarySenseIds: JSON.stringify(row.dictionarySenseIds),
					usesAllSenses: row.usesAllSenses,
					matchStatus: row.matchStatus,
					matchMethod: row.matchMethod,
					createdAt: row.createdAt,
					updatedAt: row.updatedAt,
				})),
			)
			.onConflictDoUpdate({
				target: premadeItems.id,
				set: {
					premadeDeckId: sql`excluded.premade_deck_id`,
					sortOrder: sql`excluded.sort_order`,
					sourceTag: sql`excluded.source_tag`,
					kana: sql`excluded.kana`,
					kanji: sql`excluded.kanji`,
					english: sql`excluded.english`,
					front: sql`excluded.front`,
					pronunciation: sql`excluded.pronunciation`,
					sourceDefinitions: sql`excluded.source_definitions`,
					dictionaryEntryId: sql`excluded.dictionary_entry_id`,
					dictionarySenseIds: sql`excluded.dictionary_sense_ids`,
					usesAllSenses: sql`excluded.uses_all_senses`,
					matchStatus: sql`excluded.match_status`,
					matchMethod: sql`excluded.match_method`,
					createdAt: sql`excluded.created_at`,
					updatedAt: sql`excluded.updated_at`,
				},
			});
		await yieldToEventLoop();
	}

	return activeRows.length;
};

const deleteDecksFromCache = async (db: DrizzleInstance, deckIds: string[]) => {
	if (deckIds.length === 0) {
		return 0;
	}

	for (const batch of chunkArray(deckIds, PREMADE_CACHE_DELETE_BATCH_SIZE)) {
		await db.delete(premadeDecks).where(inArray(premadeDecks.id, batch));
		await yieldToEventLoop();
	}
	return deckIds.length;
};

const deleteItemsFromCache = async (db: DrizzleInstance, itemIds: string[]) => {
	if (itemIds.length === 0) {
		return 0;
	}

	for (const batch of chunkArray(itemIds, PREMADE_CACHE_DELETE_BATCH_SIZE)) {
		await db.delete(premadeItems).where(inArray(premadeItems.id, batch));
		await yieldToEventLoop();
	}
	return itemIds.length;
};

export const getPremadeSyncStateSnapshot = async (
	db: DrizzleInstance,
	languageId?: string | null,
): Promise<PremadeSyncStateSnapshot> => {
	const row = await db.query.premadeSyncState.findFirst({
		where: eq(premadeSyncState.id, getPremadeSyncStateId(languageId)),
	});

	if (!row) {
		const snapshot: PremadeSyncStateSnapshot = {
			lastPulledAt: null,
			lastCursor: null,
			lastSuccessfulSyncAt: null,
			lastError: null,
		};
		await persistPremadeSyncState(db, {
			...snapshot,
			languageId,
		});
		return snapshot;
	}

	return {
		lastPulledAt: row.lastPulledAt ?? null,
		lastCursor: row.lastCursor ?? null,
		lastSuccessfulSyncAt: row.lastSuccessfulSyncAt ?? null,
		lastError: row.lastError ?? null,
	};
};

export const refreshPremadeDeckCache = async ({
	db,
	languageId,
	limit = PREMADE_PULL_PAGE_SIZE,
}: {
	db: DrizzleInstance;
	languageId?: string;
	limit?: number;
}) => {
	const initialState = await getPremadeSyncStateSnapshot(db, languageId);
	let nextCursor = initialState.lastCursor;
	let pages = 0;
	let upsertedDecks = 0;
	let upsertedItems = 0;
	let deletedDecks = 0;
	let deletedItems = 0;
	let lastPulledAt = initialState.lastPulledAt;

	try {
		while (true) {
			const payload = await pullCloudPremadeDecks({
				cursor: nextCursor,
				languageId,
				limit,
			});

			const deletedDeckIds = payload.premadeDecks
				.filter((row) => row.deletedAt !== null || !row.isPublished)
				.map((row) => row.id);
			const deletedItemIds = payload.premadeItems
				.filter((row) => row.deletedAt !== null)
				.map((row) => row.id);

			await db.transaction(async (tx) => {
				upsertedDecks += await upsertActiveDecks(tx as DrizzleInstance, payload.premadeDecks);
				upsertedItems += await upsertActiveItems(
					tx as DrizzleInstance,
					payload.premadeItems,
					new Set(deletedDeckIds),
				);
				deletedItems += await deleteItemsFromCache(tx as DrizzleInstance, deletedItemIds);
				deletedDecks += await deleteDecksFromCache(tx as DrizzleInstance, deletedDeckIds);
				await persistPremadeSyncState(tx as DrizzleInstance, {
					languageId,
					lastPulledAt: payload.serverTime,
					lastCursor: payload.cursor,
					lastSuccessfulSyncAt: payload.hasMore ? initialState.lastSuccessfulSyncAt : payload.serverTime,
					lastError: null,
				});
			});

			pages += 1;
			nextCursor = payload.cursor;
			lastPulledAt = payload.serverTime;
			await yieldToEventLoop();

			if (!payload.hasMore) {
				break;
			}
		}
	} catch (error) {
		await persistPremadeSyncState(db, {
			languageId,
			lastPulledAt,
			lastCursor: nextCursor,
			lastSuccessfulSyncAt: initialState.lastSuccessfulSyncAt,
			lastError: error instanceof Error ? error.message : "Unknown premade sync error.",
		});
		throw error;
	}

	return {
		pages,
		cursor: nextCursor,
		lastPulledAt,
		upsertedDecks,
		upsertedItems,
		deletedDecks,
		deletedItems,
	};
};

export const getCachedPremadeDecks = async (
	db: DrizzleInstance,
	languageId?: string,
): Promise<CachedPremadeDeckListItem[]> => {
	const deckRows = await db.query.premadeDecks.findMany({
		where: languageId ? eq(premadeDecks.languageId, languageId) : undefined,
		orderBy: [asc(premadeDecks.book), asc(premadeDecks.lesson), asc(premadeDecks.name)],
	});

	const deckIds = deckRows.map((deck) => deck.id);
	const countRows =
		deckIds.length > 0
			? await db
					.select({
						premadeDeckId: premadeItems.premadeDeckId,
						itemCount: sql<number>`count(*)`,
					})
					.from(premadeItems)
					.where(inArray(premadeItems.premadeDeckId, deckIds))
					.groupBy(premadeItems.premadeDeckId)
			: [];
	const countByDeckId = new Map<string, number>();
	for (const deckId of deckIds) {
		countByDeckId.set(deckId, 0);
	}
	for (const row of countRows) {
		countByDeckId.set(row.premadeDeckId, Number(row.itemCount ?? 0));
	}

	return deckRows.map((deck) => ({
		...normalizePremadeDeck(deck),
		itemCount: countByDeckId.get(deck.id) ?? 0,
	}));
};

export const getCachedPremadeBooks = async (
	db: DrizzleInstance,
	languageId?: string,
): Promise<CachedPremadeBookListItem[]> => {
	const decks = await getCachedPremadeDecks(db, languageId);
	const groups = new Map<PremadeDeckRecord["book"], CachedPremadeDeckListItem[]>();

	for (const deck of decks) {
		const current = groups.get(deck.book) ?? [];
		current.push(deck);
		groups.set(deck.book, current);
	}

	return [...groups.entries()]
		.map(([book, deckRows]) => ({
			book,
			name: getPremadeBookLabel(book),
			decks: deckRows,
			itemCount: deckRows.reduce((sum, item) => sum + item.itemCount, 0),
		}))
		.sort((left, right) => getPremadeBookSortOrder(left.book) - getPremadeBookSortOrder(right.book));
};

export const getCachedPremadeDeck = async (db: DrizzleInstance, premadeDeckId: string) => {
	const deck = await db.query.premadeDecks.findFirst({
		where: eq(premadeDecks.id, premadeDeckId),
	});

	return deck ? normalizePremadeDeck(deck) : null;
};

export const getCachedPremadeDeckItems = async (
	db: DrizzleInstance,
	premadeDeckId: string,
) => {
	const itemRows = await db.query.premadeItems.findMany({
		where: eq(premadeItems.premadeDeckId, premadeDeckId),
		orderBy: [asc(premadeItems.sortOrder), asc(premadeItems.id)],
	});

	return itemRows.map(normalizePremadeItem);
};

export const copyCachedPremadeDeckToLocalDeck = async ({
	db,
	premadeDeckId,
	reviewType,
	name,
}: {
	db: DrizzleInstance;
	premadeDeckId: string;
	reviewType: ReviewType;
	name?: string;
}) => {
	const premadeDeck = await getCachedPremadeDeck(db, premadeDeckId);
	if (!premadeDeck) {
		return { status: "missing_premade_deck" as const };
	}

	const items = await getCachedPremadeDeckItems(db, premadeDeckId);
	const deck = await createDeck(db, {
		id: generateId(),
		name: name?.trim() || premadeDeck.name,
		languageId: premadeDeck.languageId,
	});

	if (!deck) {
		return { status: "create_failed" as const };
	}

	let addedCount = 0;
	let existingCount = 0;
	let skippedCount = 0;

	for (const item of items) {
		const result = await addPremadeItemToDeck(db, {
			deckId: deck.id,
			item: toPremadeDeckItem(item),
			reviewType,
		});

		if (result.status === "added") {
			addedCount += 1;
		} else if (result.status === "exists") {
			existingCount += 1;
		} else if (
			result.status === "stroke_not_supported" ||
			result.status === "pitch_not_supported"
		) {
			skippedCount += 1;
		}
	}

	await refreshDecksStore(db, premadeDeck.languageId);

	return {
		status: "created" as const,
		deckId: deck.id,
		addedCount,
		existingCount,
		skippedCount,
		totalItems: items.length,
	};
};

export const copyCachedPremadeDeckToExistingDeck = async ({
	db,
	premadeDeckId,
	targetDeckId,
	reviewType,
}: {
	db: DrizzleInstance;
	premadeDeckId: string;
	targetDeckId: string;
	reviewType: ReviewType;
}) => {
	const [premadeDeck, targetDeck] = await Promise.all([
		getCachedPremadeDeck(db, premadeDeckId),
		db.query.decks.findFirst({
			where: eq(decks.id, targetDeckId),
		}),
	]);

	if (!premadeDeck) {
		return { status: "missing_premade_deck" as const };
	}

	if (!targetDeck || targetDeck.deleted) {
		return { status: "missing_target_deck" as const };
	}

	if (targetDeck.primaryDeckId) {
		return {
			status: "managed_by_primary" as const,
			primaryDeckId: targetDeck.primaryDeckId,
		};
	}

	if (targetDeck.languageId && targetDeck.languageId !== premadeDeck.languageId) {
		return { status: "language_mismatch" as const };
	}

	const items = await getCachedPremadeDeckItems(db, premadeDeckId);
	let addedCount = 0;
	let existingCount = 0;
	let skippedCount = 0;

	for (const item of items) {
		const result = await addPremadeItemToDeck(db, {
			deckId: targetDeck.id,
			item: toPremadeDeckItem(item),
			reviewType,
		});

		if (result.status === "added") {
			addedCount += 1;
			continue;
		}

		if (result.status === "exists") {
			existingCount += 1;
			continue;
		}

		if (
			result.status === "stroke_not_supported" ||
			result.status === "pitch_not_supported"
		) {
			skippedCount += 1;
			continue;
		}

		if (result.status === "language_mismatch") {
			return { status: "language_mismatch" as const };
		}

		if (result.status === "managed_by_primary") {
			return {
				status: "managed_by_primary" as const,
				primaryDeckId: result.primaryDeckId,
			};
		}

		return {
			status: "copy_failed" as const,
			reason: result.status,
		};
	}

	await refreshDecksStore(db, premadeDeck.languageId);

	return {
		status: "copied" as const,
		deckId: targetDeck.id,
		addedCount,
		existingCount,
		skippedCount,
		totalItems: items.length,
	};
};

export const copyCachedPremadeCollectionToLocalFolder = async ({
	db,
	book,
	reviewType,
	name,
	onProgress,
}: {
	db: DrizzleInstance;
	book: PremadeDeckRecord["book"];
	reviewType: ReviewType;
	name?: string;
	onProgress?: (progress: PremadeCollectionCopyProgress) => void;
}) => {
	const reportProgress = (
		phase: PremadeCollectionCopyProgress["phase"],
		label: string,
		current: number,
		total: number,
	) => {
		onProgress?.({
			phase,
			label,
			current,
			total,
		});
	};

	const premadeDeckRows = (await getCachedPremadeDecks(db)).filter((deck) => deck.book === book);
	if (premadeDeckRows.length === 0) {
		return { status: "missing_premade_collection" as const };
	}

	const folderId = generateId();
	const folderName = name?.trim() || getPremadeBookLabel(book);
	let addedCount = 0;
	let existingCount = 0;
	let skippedCount = 0;
	let totalItems = 0;
	const createdDecks: { id: string; name: string }[] = [];
	const languageId = premadeDeckRows[0]?.languageId ?? null;
	const deckRows = premadeDeckRows.map((premadeDeck) => {
		const localDeckId = generateId();
		createdDecks.push({
			id: localDeckId,
			name: premadeDeck.name,
		});

		return {
			premadeDeck,
			localDeckId,
		};
	});
	reportProgress("loading_decks", "Loading decks", 0, deckRows.length);
	const deckItems: {
		premadeDeck: typeof deckRows[number]["premadeDeck"];
		localDeckId: string;
		items: PremadeDeckItemRecord[];
	}[] = [];
	for (const [index, row] of deckRows.entries()) {
		deckItems.push({
			premadeDeck: row.premadeDeck,
			localDeckId: row.localDeckId,
			items: await getCachedPremadeDeckItems(db, row.premadeDeck.id),
		});
		reportProgress("loading_decks", "Loading decks", index + 1, deckRows.length);
	}
	const flattenedItems = deckItems.flatMap(({ premadeDeck, localDeckId, items }) =>
		items.map((item, index) => ({
			premadeDeck,
			localDeckId,
			item,
			itemIndex: index,
			premadeItem: toPremadeDeckItem(item),
		})),
	);

	totalItems = flattenedItems.length;

	const linkedEntryIds = [
		...new Set(
			flattenedItems
				.map((row) => row.premadeItem.dictionaryLink?.entryId ?? null)
				.filter((entryId): entryId is string => Boolean(entryId)),
		),
	];
	reportProgress("resolving_entries", "Resolving entries", 0, 1);
	const entryDetails = await Promise.all(
		linkedEntryIds.map(async (entryId) => [entryId, await getEntryDetail(db, entryId)] as const),
	);
	reportProgress("resolving_entries", "Resolving entries", 1, 1);
	const entryById = new Map(entryDetails);

	const payloadRows = flattenedItems.map((row) => {
		const payload = buildPremadeKnowledgePayload({
			item: row.premadeItem,
			entry: row.premadeItem.dictionaryLink?.entryId
				? (entryById.get(row.premadeItem.dictionaryLink.entryId) ?? null)
				: null,
		});

		return {
			...row,
			payload,
		};
	}).filter((row) => {
		if (reviewType === "Stroke") {
			if (hasStrokeEligibleCharacters(row.payload.front)) {
				return true;
			}

			skippedCount += 1;
			return false;
		}

		if (reviewType === "Pitch") {
			const entry = row.premadeItem.dictionaryLink?.entryId
				? (entryById.get(row.premadeItem.dictionaryLink.entryId) ?? null)
				: null;
			if (hasPitchAccentReviewSupport(entry)) {
				return true;
			}

			skippedCount += 1;
			return false;
		}

		return true;
	});

	const existingLinkedKnowledge =
		linkedEntryIds.length > 0
			? await db.query.knowledge.findMany({
					where: and(
						inArray(knowledge.entryId, linkedEntryIds),
						eq(knowledge.reviewType, reviewType),
					),
				})
			: [];
	const customFronts = [
		...new Set(
			payloadRows
				.filter((row) => row.payload.entryId === null)
				.map((row) => row.payload.front),
		),
	];
	const existingCustomKnowledge =
		customFronts.length > 0
			? await db.query.knowledge.findMany({
					where: and(
						isNull(knowledge.entryId),
						eq(knowledge.reviewType, reviewType),
						inArray(knowledge.front, customFronts),
					),
				})
			: [];

	const linkedKnowledgeByEntryKey = new Map(
		existingLinkedKnowledge.map((row) => [
			`${row.entryId}:${row.configSignature ?? DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE}`,
			row,
		]),
	);
	const customKnowledgeByKey = new Map(
		existingCustomKnowledge.map((row) => [
			customKnowledgeKey({
				reviewType,
				front: row.front,
				definitions: row.definitions,
				sourceDefinitions: row.sourceDefinitions ?? null,
				pronunciation: row.pronunciation ?? null,
			}),
			row,
		]),
	);
	const siblingLabelsByEntryId = new Map<string, (string | null)[]>();
	for (const row of existingLinkedKnowledge) {
		if (!row.entryId) {
			continue;
		}

		const current = siblingLabelsByEntryId.get(row.entryId) ?? [];
		current.push(row.configLabel);
		siblingLabelsByEntryId.set(row.entryId, current);
	}

	const pendingKnowledgeInserts: (typeof knowledge.$inferInsert)[] = [];
	const pendingKnowledgeSourceDefinitionUpdates: {
		id: string;
		sourceDefinitions: string;
	}[] = [];
	const resolvedKnowledgeIdByItemId = new Map<string, string>();

	for (const row of payloadRows) {
		if (row.payload.entryId) {
			const knowledgeKey = `${row.payload.entryId}:${row.payload.configSignature}`;
			let matchingKnowledge = linkedKnowledgeByEntryKey.get(knowledgeKey) ?? null;

			if (!matchingKnowledge) {
				const siblingLabels = siblingLabelsByEntryId.get(row.payload.entryId) ?? [];
				const configLabel = getNextKnowledgeConfigLabel(siblingLabels);
				siblingLabels.push(configLabel);
				siblingLabelsByEntryId.set(row.payload.entryId, siblingLabels);
				matchingKnowledge = {
					id: generateId(),
					entryId: row.payload.entryId,
					front: row.payload.front,
					definitions: row.payload.definitions,
					sourceDefinitions: row.payload.sourceDefinitions,
					pronunciation: row.payload.pronunciation,
					configSignature: row.payload.configSignature,
					definitionConfig: row.payload.definitionConfig,
					configLabel,
					reviewType,
				} as typeof knowledge.$inferSelect;
				linkedKnowledgeByEntryKey.set(knowledgeKey, matchingKnowledge);
				pendingKnowledgeInserts.push({
					id: matchingKnowledge.id,
					entryId: matchingKnowledge.entryId,
					front: matchingKnowledge.front,
					definitions: matchingKnowledge.definitions,
					sourceDefinitions: matchingKnowledge.sourceDefinitions,
					pronunciation: matchingKnowledge.pronunciation,
					configSignature: matchingKnowledge.configSignature,
					definitionConfig: matchingKnowledge.definitionConfig,
					configLabel: matchingKnowledge.configLabel,
					reviewType,
				});
			} else if (row.payload.sourceDefinitions && !matchingKnowledge.sourceDefinitions) {
				pendingKnowledgeSourceDefinitionUpdates.push({
					id: matchingKnowledge.id,
					sourceDefinitions: row.payload.sourceDefinitions,
				});
				matchingKnowledge = {
					...matchingKnowledge,
					sourceDefinitions: row.payload.sourceDefinitions,
				};
				linkedKnowledgeByEntryKey.set(knowledgeKey, matchingKnowledge);
			}

			resolvedKnowledgeIdByItemId.set(row.item.id, matchingKnowledge.id);
			continue;
		}

		const knowledgeKey = customKnowledgeKey({
			reviewType,
			front: row.payload.front,
			definitions: row.payload.definitions,
			sourceDefinitions: row.payload.sourceDefinitions,
			pronunciation: row.payload.pronunciation,
		});
		let matchingKnowledge = customKnowledgeByKey.get(knowledgeKey) ?? null;

		if (!matchingKnowledge) {
			matchingKnowledge = {
				id: generateId(),
				entryId: null,
				front: row.payload.front,
				definitions: row.payload.definitions,
				sourceDefinitions: row.payload.sourceDefinitions,
				pronunciation: row.payload.pronunciation,
				configSignature: row.payload.configSignature,
				definitionConfig: row.payload.definitionConfig,
				configLabel: getNextKnowledgeConfigLabel([]),
				reviewType,
			} as typeof knowledge.$inferSelect;
			customKnowledgeByKey.set(knowledgeKey, matchingKnowledge);
			pendingKnowledgeInserts.push({
				id: matchingKnowledge.id,
				entryId: null,
				front: matchingKnowledge.front,
				definitions: matchingKnowledge.definitions,
				sourceDefinitions: matchingKnowledge.sourceDefinitions,
				pronunciation: matchingKnowledge.pronunciation,
				configSignature: matchingKnowledge.configSignature,
				definitionConfig: matchingKnowledge.definitionConfig,
				configLabel: matchingKnowledge.configLabel,
				reviewType,
			});
		}

		resolvedKnowledgeIdByItemId.set(row.item.id, matchingKnowledge.id);
	}

	const pendingCards: (typeof cards.$inferInsert)[] = [];
	const seenKnowledgeIdsByDeckId = new Map<string, Set<string>>();

	for (const row of payloadRows) {
		const knowledgeId = resolvedKnowledgeIdByItemId.get(row.item.id);
		if (!knowledgeId) {
			return {
				status: "copy_failed" as const,
				reason: "missing_knowledge_resolution" as const,
			};
		}

		const seenKnowledgeIds = seenKnowledgeIdsByDeckId.get(row.localDeckId) ?? new Set<string>();
		if (seenKnowledgeIds.has(knowledgeId)) {
			existingCount += 1;
			continue;
		}

		seenKnowledgeIds.add(knowledgeId);
		seenKnowledgeIdsByDeckId.set(row.localDeckId, seenKnowledgeIds);
		pendingCards.push({
			id: generateId(),
			deckId: row.localDeckId,
			knowledgeId,
		});
		addedCount += 1;
	}

	await db.transaction(async (tx) => {
		const transactionDb = tx as DrizzleInstance;
		await transactionDb.insert(decksFolders).values({
			id: folderId,
			name: folderName,
			parentId: null,
		});

		await transactionDb.insert(decks).values(
			deckRows.map(({ premadeDeck, localDeckId }) => ({
				id: localDeckId,
				name: premadeDeck.name,
				languageId: premadeDeck.languageId,
				folderId,
			})),
		);

		for (const update of pendingKnowledgeSourceDefinitionUpdates) {
			await transactionDb
				.update(knowledge)
				.set({
					sourceDefinitions: update.sourceDefinitions,
				})
				.where(eq(knowledge.id, update.id));
		}

		const knowledgeBatches = chunkArray(pendingKnowledgeInserts, BULK_INSERT_BATCH_SIZE);
		if (knowledgeBatches.length === 0) {
			reportProgress("writing_knowledge", "Writing knowledge", 1, 1);
		}
		for (const [index, batch] of knowledgeBatches.entries()) {
			reportProgress(
				"writing_knowledge",
				"Writing knowledge",
				index + 1,
				knowledgeBatches.length,
			);
			await transactionDb.insert(knowledge).values(batch);
		}

		const cardBatches = chunkArray(pendingCards, BULK_INSERT_BATCH_SIZE);
		if (cardBatches.length === 0) {
			reportProgress("writing_cards", "Writing cards", 1, 1);
		}
		for (const [index, batch] of cardBatches.entries()) {
			reportProgress("writing_cards", "Writing cards", index + 1, cardBatches.length);
			await transactionDb.insert(cards).values(batch);
		}
	});

	reportProgress("finalizing", "Finalizing", 1, 1);
	await markLocalChange(db);
	await refreshDecksStore(db, languageId ?? undefined);

	return {
		status: "created" as const,
		folderId,
		folderName,
		createdDecks,
		addedCount,
		existingCount,
		skippedCount,
		totalItems,
	};
};

export const copyCachedPremadeBookToLocalFolder = copyCachedPremadeCollectionToLocalFolder;
