import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
	FSRS,
	Rating,
	createEmptyCard,
	generatorParameters,
	type CardInput,
	type Grade,
	type RecordLogItem,
} from "ts-fsrs";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { getEntryDetail, type EntryDetailResult } from "@/lib/database/lexicon";
import {
	cards,
	decks,
	decksFolders,
	fsrsParams,
	knowledge,
	type RatingType,
	type ReviewType,
	type StateType,
	reviewLog,
	reviewUndo,
} from "@/lib/database/schema";
import { generateId } from "@/lib/id";
import {
	REVIEW_LIMITS_DEFAULTS,
	canAdmitReviewUnderLimit,
	getDeckReviewCountsToday,
	getDeckReviewLimitSettings,
	getFolderReviewCountsToday,
	getFolderReviewLimitSettings,
	getGlobalReviewCountsToday,
	getGlobalReviewLimitSettings,
	incrementReviewLimitCounts,
	type ReviewLimitCounts,
	type ReviewLimitSettings,
} from "@/lib/review/reviewLimits";
import { HIDDEN_REVIEW_TYPES } from "@/lib/review/reviewTypeConfig";
import { appendSyncDebugEvent } from "@/lib/sync/debug";
import { markLocalChange } from "@/lib/sync/settings";

export const REVIEW_GRADES = ["Again", "Hard", "Good", "Easy"] as const;
export type ReviewGrade = (typeof REVIEW_GRADES)[number];

export type ReviewQueueCard = typeof cards.$inferSelect & {
	knowledge: typeof knowledge.$inferSelect;
	entryDetail: EntryDetailResult | null;
};

type ReviewQueueCardBase = typeof cards.$inferSelect & {
	knowledge: typeof knowledge.$inferSelect;
};

export type DeckReviewSession = {
	target: {
		type: "deck";
		id: string;
		name: string;
	};
	deck: typeof decks.$inferSelect;
	cards: ReviewQueueCard[];
	dueCount: number;
	totalCards: number;
};

export type FolderReviewSession = {
	target: {
		type: "folder";
		id: string;
		name: string;
	};
	folder: typeof decksFolders.$inferSelect;
	childDeckIds: string[];
	cards: ReviewQueueCard[];
	dueCount: number;
	totalCards: number;
};

type ReviewSessionQueryOptions = {
	limit?: number;
};

type DueReviewQueueSliceOptions = {
	limit?: number;
	includeCards?: boolean;
};

export const REVIEW_SESSION_BUCKET_SIZE = 10;

const dueAtSql = sql`datetime(replace(substr(${knowledge.due}, 1, 19), 'T', ' '))`;

export type ReviewSession = DeckReviewSession | FolderReviewSession;

export type ReviewTargetType = "deck" | "folder";

export type ReviewUndoAvailability = {
	isAvailable: boolean;
	knowledgeId: string | null;
};

export type KnowledgeReviewPreview = {
	knowledgeId: string;
	now: Date;
	retrievability: number | null;
	grades: {
		rating: ReviewGrade;
		card: RecordLogItem["card"];
		log: RecordLogItem["log"];
	}[];
};

const STATE_TO_FSRS: Record<StateType, CardInput["state"]> = {
	New: "New",
	Learning: "Learning",
	Review: "Review",
	Relearning: "Relearning",
};

const FSRS_TO_STATE: Record<CardInput["state"], StateType> = {
	New: "New",
	Learning: "Learning",
	Review: "Review",
	Relearning: "Relearning",
	0: "New",
	1: "Learning",
	2: "Review",
	3: "Relearning",
};

const RATING_TO_FSRS: Record<ReviewGrade, Grade> = {
	Again: Rating.Again,
	Hard: Rating.Hard,
	Good: Rating.Good,
	Easy: Rating.Easy,
};

const FSRS_TO_RATING: Record<Grade, ReviewGrade> = {
	1: "Again",
	2: "Hard",
	3: "Good",
	4: "Easy",
};

export const parseStoredDateTime = (
	value: string | Date | null | undefined,
): Date | null => {
	if (!value) return null;
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? null : value;
	}

	const normalized = value.includes("T") ? value : value.replace(" ", "T");
	const withTimezone = /(?:Z|[+-]\d{2}:\d{2})$/.test(normalized)
		? normalized
		: `${normalized}Z`;
	const parsed = new Date(withTimezone);
	return Number.isNaN(parsed.getTime()) ? null : parsed;
};

export const formatStoredDateTime = (value: Date) => value.toISOString();

export const isKnowledgeDue = (
	item: Pick<typeof knowledge.$inferSelect, "due" | "deleted" | "suspended"> | null,
	now = new Date(),
) => {
	if (!item || item.deleted || item.suspended) return false;
	const due = parseStoredDateTime(item.due);
	return due ? due.getTime() <= now.getTime() : false;
};

let cachedFsrsEngine: FSRS | null = null;

export const clearFsrsEngineCache = () => {
	cachedFsrsEngine = null;
};

const getFsrsEngine = async (db: DrizzleInstance) => {
	if (cachedFsrsEngine) {
		return cachedFsrsEngine;
	}

	const engine = await loadFsrsEngine(db);
	cachedFsrsEngine = engine;
	return engine;
};

const loadFsrsEngine = async (db: DrizzleInstance) => {
	const paramsRow = await db.query.fsrsParams.findFirst({
		where: eq(fsrsParams.id, "default_params"),
	});

	if (!paramsRow) {
		return new FSRS(generatorParameters({}));
	}

	let weights: number[] | undefined;
	try {
		const parsed = JSON.parse(paramsRow.weights);
		if (Array.isArray(parsed)) {
			weights = parsed.map((value) => Number(value));
		}
	} catch {
		weights = undefined;
	}

	return new FSRS(
		generatorParameters({
			w: weights,
			request_retention: paramsRow.requestRetention,
			maximum_interval: paramsRow.maximumInterval,
			enable_fuzz: paramsRow.enableFuzz,
			enable_short_term: paramsRow.enableShortTerm,
		}),
	);
};

const toFsrsCard = (item: typeof knowledge.$inferSelect): CardInput => {
	const emptyCard = createEmptyCard();

	return {
		due: parseStoredDateTime(item.due) ?? emptyCard.due,
		stability: item.stability,
		difficulty: item.difficulty,
		elapsed_days: item.elapsedDays,
		scheduled_days: item.scheduledDays,
		learning_steps: item.learningSteps,
		reps: item.reps,
		lapses: item.lapses,
		state: STATE_TO_FSRS[item.state as StateType] ?? "New",
		last_review: parseStoredDateTime(item.lastReview) ?? undefined,
	};
};

const toPreviewEntry = (
	rating: ReviewGrade,
	result: RecordLogItem,
): KnowledgeReviewPreview["grades"][number] => ({
	rating,
	card: result.card,
	log: result.log,
});

// Dictionary entry data is read-only at runtime (only import scripts write it),
// so details can be reused across queue refreshes instead of re-running the
// 8 queries per entry that getEntryDetail costs.
const ENTRY_DETAIL_CACHE_MAX = 100;
const entryDetailCache = new Map<string, EntryDetailResult | null>();

export const clearReviewEntryDetailCache = () => {
	entryDetailCache.clear();
};

const getCachedEntryDetail = async (db: DrizzleInstance, entryId: string) => {
	if (entryDetailCache.has(entryId)) {
		const cached = entryDetailCache.get(entryId) ?? null;
		// refresh recency for LRU eviction
		entryDetailCache.delete(entryId);
		entryDetailCache.set(entryId, cached);
		return cached;
	}

	const detail = await getEntryDetail(db, entryId);
	entryDetailCache.set(entryId, detail);
	if (entryDetailCache.size > ENTRY_DETAIL_CACHE_MAX) {
		const oldestKey = entryDetailCache.keys().next().value;
		if (oldestKey !== undefined) {
			entryDetailCache.delete(oldestKey);
		}
	}
	return detail;
};

const buildReviewQueueCards = async (
	db: DrizzleInstance,
	deckCards: ReviewQueueCardBase[],
) => {
	const dueCards = deckCards
		.filter(
			(card): card is ReviewQueueCardBase =>
				Boolean(card.knowledge) && isKnowledgeDue(card.knowledge),
		)
		.sort((left, right) => {
			const leftDue = parseStoredDateTime(left.knowledge.due)?.getTime() ?? 0;
			const rightDue = parseStoredDateTime(right.knowledge.due)?.getTime() ?? 0;
			return leftDue - rightDue;
		});

	const seenKnowledgeIds = new Set<string>();
	const uniqueDueCards = dueCards.filter((card) => {
		if (seenKnowledgeIds.has(card.knowledge.id)) {
			return false;
		}

		seenKnowledgeIds.add(card.knowledge.id);
		return true;
	});

	return Promise.all(
		uniqueDueCards.map(async (card) => ({
			...card,
			entryDetail: card.knowledge.entryId
				? await getCachedEntryDetail(db, card.knowledge.entryId)
				: null,
		})),
	);
};

const buildDueKnowledgeWhereClause = ({
	deckIds,
}: {
	deckIds: string[];
}) =>
	and(
		inArray(cards.deckId, deckIds),
		eq(cards.deleted, false),
		eq(knowledge.deleted, false),
		eq(knowledge.suspended, false),
		sql`${dueAtSql} <= datetime('now')`,
	);

const cloneReviewLimitCounts = (
	counts?: ReviewLimitCounts | null,
): ReviewLimitCounts => ({
	newCount: counts?.newCount ?? 0,
	totalCount: counts?.totalCount ?? 0,
});

const getDueReviewQueueSlice = async ({
	db,
	deckIds,
	limit = REVIEW_SESSION_BUCKET_SIZE,
	includeCards = true,
	deckSettingsByDeckId,
	deckNewCardsPausedByDeckId,
	deckBaseCountsByDeckId,
	folderSettings,
	folderNewCardsPaused = false,
	folderBaseCounts,
	globalSettings,
	globalBaseCounts,
}: {
	db: DrizzleInstance;
	deckIds: string[];
	limit?: number;
	includeCards?: boolean;
	deckSettingsByDeckId: Map<string, ReviewLimitSettings>;
	deckNewCardsPausedByDeckId: Map<string, boolean>;
	deckBaseCountsByDeckId: Map<string, ReviewLimitCounts>;
	folderSettings?: ReviewLimitSettings | null;
	folderNewCardsPaused?: boolean;
	folderBaseCounts?: ReviewLimitCounts | null;
	globalSettings?: ReviewLimitSettings | null;
	globalBaseCounts?: ReviewLimitCounts | null;
}) => {
	if (deckIds.length === 0) {
		return {
			cards: [] as ReviewQueueCard[],
			dueCount: 0,
		};
	}

	const whereClause = buildDueKnowledgeWhereClause({ deckIds });
	const normalizedLimit = Math.max(limit, 0);
	const seenKnowledgeIds = new Set<string>();
	const deckCountsByDeckId = new Map<string, ReviewLimitCounts>();
	for (const deckId of deckIds) {
		deckCountsByDeckId.set(deckId, cloneReviewLimitCounts(deckBaseCountsByDeckId.get(deckId)));
	}
	let folderCounts = cloneReviewLimitCounts(folderBaseCounts);
	let globalCounts = cloneReviewLimitCounts(globalBaseCounts);
	let admittedCount = 0;

	// One pass over light rows (id/state/deck only); full card rows are fetched
	// afterwards for just the admitted slice. Admission must walk every due row
	// in due order because per-deck/folder/global limits skip rows individually.
	const dueRows = await db
		.select({
			knowledgeId: knowledge.id,
			cardId: cards.id,
			state: knowledge.state,
			deckId: cards.deckId,
		})
		.from(cards)
		.innerJoin(knowledge, eq(cards.knowledgeId, knowledge.id))
		.where(whereClause)
		.orderBy(asc(dueAtSql), asc(cards.createdAt), asc(cards.id));

	const admittedCardIds: string[] = [];

	for (const row of dueRows) {
		if (seenKnowledgeIds.has(row.knowledgeId)) {
			continue;
		}

		seenKnowledgeIds.add(row.knowledgeId);
		const deckSettings =
			deckSettingsByDeckId.get(row.deckId) ?? REVIEW_LIMITS_DEFAULTS;
		const newCardsPaused =
			deckNewCardsPausedByDeckId.get(row.deckId) ?? false;
		const deckCounts =
			deckCountsByDeckId.get(row.deckId) ?? cloneReviewLimitCounts();
		const isNew = row.state === "New";

		if (isNew && newCardsPaused) {
			continue;
		}

		if (
			!canAdmitReviewUnderLimit({
				settings: deckSettings,
				counts: deckCounts,
				isNew,
			})
		) {
			continue;
		}

		if (
			isNew &&
			folderNewCardsPaused
		) {
			continue;
		}

		if (
			folderSettings &&
			!canAdmitReviewUnderLimit({
				settings: folderSettings,
				counts: folderCounts,
				isNew,
			})
		) {
			continue;
		}

		if (
			globalSettings &&
			!canAdmitReviewUnderLimit({
				settings: globalSettings,
				counts: globalCounts,
				isNew,
			})
		) {
			continue;
		}

		deckCountsByDeckId.set(
			row.deckId,
			incrementReviewLimitCounts(deckCounts, isNew),
		);
		if (folderSettings) {
			folderCounts = incrementReviewLimitCounts(folderCounts, isNew);
		}
		if (globalSettings) {
			globalCounts = incrementReviewLimitCounts(globalCounts, isNew);
		}

		admittedCount += 1;
		if (includeCards && admittedCardIds.length < normalizedLimit) {
			admittedCardIds.push(row.cardId);
		}
	}

	let admittedRows: {
		card: typeof cards.$inferSelect;
		knowledge: typeof knowledge.$inferSelect;
	}[] = [];
	if (includeCards && admittedCardIds.length > 0) {
		const fullRows = await db
			.select({
				card: cards,
				knowledge,
			})
			.from(cards)
			.innerJoin(knowledge, eq(cards.knowledgeId, knowledge.id))
			.where(inArray(cards.id, admittedCardIds));
		const orderByCardId = new Map(
			admittedCardIds.map((cardId, index) => [cardId, index]),
		);
		admittedRows = fullRows.sort(
			(left, right) =>
				(orderByCardId.get(left.card.id) ?? 0) -
				(orderByCardId.get(right.card.id) ?? 0),
		);
	}

	return {
		cards:
			includeCards && normalizedLimit > 0
				? await buildReviewQueueCards(
						db,
						admittedRows.map((row) => ({
							...row.card,
							knowledge: row.knowledge,
						})),
					)
				: [],
		dueCount: admittedCount,
	};
};

const getDeckDueReviewQueueSlice = async ({
	db,
	deck,
	languageId,
	limit = REVIEW_SESSION_BUCKET_SIZE,
	includeCards = true,
}: {
	db: DrizzleInstance;
	deck: typeof decks.$inferSelect;
	languageId?: string;
} & DueReviewQueueSliceOptions) => {
	const effectiveLanguageId = languageId ?? deck.languageId ?? undefined;
	const [deckCountsByDeckId, globalSettings, globalCounts] = await Promise.all([
		getDeckReviewCountsToday(db, [deck.id]),
		effectiveLanguageId
			? getGlobalReviewLimitSettings(db, effectiveLanguageId)
			: Promise.resolve(REVIEW_LIMITS_DEFAULTS),
		effectiveLanguageId
			? getGlobalReviewCountsToday(db, effectiveLanguageId)
			: Promise.resolve(cloneReviewLimitCounts()),
	]);

	return getDueReviewQueueSlice({
		db,
		deckIds: [deck.id],
		limit,
		includeCards,
		deckSettingsByDeckId: new Map([[deck.id, getDeckReviewLimitSettings(deck)]]),
		deckNewCardsPausedByDeckId: new Map([[deck.id, Boolean(deck.newCardsPaused)]]),
		deckBaseCountsByDeckId: deckCountsByDeckId,
		globalSettings: effectiveLanguageId ? globalSettings : null,
		globalBaseCounts: effectiveLanguageId ? globalCounts : null,
	});
};

const getFolderDueReviewQueueSlice = async ({
	db,
	folder,
	childDecks,
	languageId,
	limit = REVIEW_SESSION_BUCKET_SIZE,
	includeCards = true,
}: {
	db: DrizzleInstance;
	folder: typeof decksFolders.$inferSelect;
	childDecks: (typeof decks.$inferSelect)[];
	languageId?: string;
} & DueReviewQueueSliceOptions) => {
	if (childDecks.length === 0) {
		return {
			cards: [] as ReviewQueueCard[],
			dueCount: 0,
		};
	}

	const childDeckIds = childDecks.map((deck) => deck.id);
	const effectiveLanguageId = languageId ?? childDecks[0]?.languageId ?? undefined;
	const [
		deckCountsByDeckId,
		folderCounts,
		globalSettings,
		globalCounts,
	] = await Promise.all([
		getDeckReviewCountsToday(db, childDeckIds),
		getFolderReviewCountsToday(db, folder.id),
		effectiveLanguageId
			? getGlobalReviewLimitSettings(db, effectiveLanguageId)
			: Promise.resolve(REVIEW_LIMITS_DEFAULTS),
		effectiveLanguageId
			? getGlobalReviewCountsToday(db, effectiveLanguageId)
			: Promise.resolve(cloneReviewLimitCounts()),
	]);

	return getDueReviewQueueSlice({
		db,
		deckIds: childDeckIds,
		limit,
		includeCards,
		deckSettingsByDeckId: new Map(
			childDecks.map((childDeck) => [childDeck.id, getDeckReviewLimitSettings(childDeck)]),
		),
		deckNewCardsPausedByDeckId: new Map(
			childDecks.map((childDeck) => [childDeck.id, Boolean(childDeck.newCardsPaused)]),
		),
		deckBaseCountsByDeckId: deckCountsByDeckId,
		folderSettings: getFolderReviewLimitSettings(folder),
		folderNewCardsPaused: Boolean(folder.newCardsPaused),
		folderBaseCounts: folderCounts,
		globalSettings: effectiveLanguageId ? globalSettings : null,
		globalBaseCounts: effectiveLanguageId ? globalCounts : null,
	});
};

export const getDeckAvailableDueCount = async ({
	db,
	deck,
	languageId,
}: {
	db: DrizzleInstance;
	deck: typeof decks.$inferSelect;
	languageId?: string;
}) =>
	(
		await getDeckDueReviewQueueSlice({
			db,
			deck,
			languageId,
			limit: 0,
			includeCards: false,
		})
	).dueCount;

export const getFolderAvailableDueCount = async ({
	db,
	folder,
	childDecks,
	languageId,
}: {
	db: DrizzleInstance;
	folder: typeof decksFolders.$inferSelect;
	childDecks: (typeof decks.$inferSelect)[];
	languageId?: string;
}) =>
	(
		await getFolderDueReviewQueueSlice({
			db,
			folder,
			childDecks,
			languageId,
			limit: 0,
			includeCards: false,
		})
	).dueCount;

export const getDeckReviewSession = async (
	db: DrizzleInstance,
	deckId: string,
	languageId?: string,
	options: ReviewSessionQueryOptions = {},
): Promise<DeckReviewSession | null> => {
	const deck = await db.query.decks.findFirst({
		where: languageId
			? and(eq(decks.id, deckId), eq(decks.languageId, languageId), eq(decks.deleted, false))
			: and(eq(decks.id, deckId), eq(decks.deleted, false)),
	});

	if (!deck) {
		return null;
	}

	const effectiveLanguageId = languageId ?? deck.languageId ?? undefined;
	const dueSlice = await getDeckDueReviewQueueSlice({
		db,
		deck,
		languageId: effectiveLanguageId,
		limit: options.limit ?? REVIEW_SESSION_BUCKET_SIZE,
	});

	return {
		target: {
			type: "deck",
			id: deck.id,
			name: deck.name,
		},
		deck,
		cards: dueSlice.cards,
		dueCount: dueSlice.dueCount,
		totalCards: dueSlice.dueCount,
	};
};

export const getFolderReviewSession = async (
	db: DrizzleInstance,
	folderId: string,
	languageId?: string,
	options: ReviewSessionQueryOptions = {},
): Promise<FolderReviewSession | null> => {
	const folder = await db.query.decksFolders.findFirst({
		where: and(eq(decksFolders.id, folderId), eq(decksFolders.deleted, false)),
	});

	if (!folder) {
		return null;
	}

	const childDecks = await db.query.decks.findMany({
		where: languageId
			? and(
					eq(decks.folderId, folderId),
					eq(decks.languageId, languageId),
					eq(decks.deleted, false),
				)
			: and(eq(decks.folderId, folderId), eq(decks.deleted, false)),
	});

	if (childDecks.length === 0) {
		return {
			target: {
				type: "folder",
				id: folder.id,
				name: folder.name,
			},
			folder,
			childDeckIds: [],
			cards: [],
			dueCount: 0,
			totalCards: 0,
		};
	}

	const childDeckIds = childDecks.map((deck) => deck.id);
	const effectiveLanguageId = languageId ?? childDecks[0]?.languageId ?? undefined;
	const dueSlice = await getFolderDueReviewQueueSlice({
		db,
		folder,
		childDecks,
		languageId: effectiveLanguageId,
		limit: options.limit ?? REVIEW_SESSION_BUCKET_SIZE,
	});

	return {
		target: {
			type: "folder",
			id: folder.id,
			name: folder.name,
		},
		folder,
		childDeckIds,
		cards: dueSlice.cards,
		dueCount: dueSlice.dueCount,
		totalCards: dueSlice.dueCount,
	};
};

const getLatestReviewUndoCandidate = async (db: DrizzleInstance) =>
	await db.query.reviewUndo.findFirst({
		where: and(eq(reviewUndo.undone, false), eq(reviewUndo.invalidated, false)),
		orderBy: [desc(reviewUndo.createdAt), desc(reviewUndo.id)],
	});

const targetContainsKnowledge = async ({
	db,
	targetType,
	targetId,
	knowledgeId,
}: {
	db: DrizzleInstance;
	targetType: ReviewTargetType;
	targetId: string;
	knowledgeId: string;
}) => {
	if (targetType === "deck") {
		const card = await db.query.cards.findFirst({
			where: and(
				eq(cards.deckId, targetId),
				eq(cards.knowledgeId, knowledgeId),
				eq(cards.deleted, false),
			),
			columns: {
				id: true,
			},
		});

		return Boolean(card);
	}

	const card = await db
		.select({
			cardId: cards.id,
		})
		.from(cards)
		.innerJoin(decks, eq(cards.deckId, decks.id))
		.where(
			and(
				eq(decks.folderId, targetId),
				eq(decks.deleted, false),
				eq(cards.knowledgeId, knowledgeId),
				eq(cards.deleted, false),
			),
		)
		.limit(1);

	return card.length > 0;
};

export const getReviewUndoAvailability = async ({
	db,
	targetType,
	targetId,
}: {
	db: DrizzleInstance;
	targetType: ReviewTargetType;
	targetId: string | null;
}): Promise<ReviewUndoAvailability> => {
	if (!targetId) {
		return {
			isAvailable: false,
			knowledgeId: null,
		};
	}

	const candidate = await getLatestReviewUndoCandidate(db);
	if (!candidate) {
		return {
			isAvailable: false,
			knowledgeId: null,
		};
	}

	const isAvailable = await targetContainsKnowledge({
		db,
		targetType,
		targetId,
		knowledgeId: candidate.knowledgeId,
	});

	return {
		isAvailable,
		knowledgeId: isAvailable ? candidate.knowledgeId : null,
	};
};

export const previewKnowledgeReview = async (
	db: DrizzleInstance,
	knowledgeId: string,
): Promise<KnowledgeReviewPreview | null> => {
	const foundKnowledge = await db.query.knowledge.findFirst({
		where: eq(knowledge.id, knowledgeId),
	});

	if (!foundKnowledge || foundKnowledge.deleted || foundKnowledge.suspended) {
		return null;
	}

	const now = new Date();
	const card = toFsrsCard(foundKnowledge);
	const engine = await getFsrsEngine(db);
	const retrievability =
		foundKnowledge.reps > 0 ? engine.get_retrievability(card, now, false) : null;

	return {
		knowledgeId,
		now,
		retrievability,
		grades: REVIEW_GRADES.map((rating) =>
			toPreviewEntry(rating, engine.next(card, now, RATING_TO_FSRS[rating])),
		),
	};
};

export const submitKnowledgeReview = async (
	db: DrizzleInstance,
	input: {
		knowledgeId: string;
		rating: ReviewGrade;
		durationMs?: number | null;
	},
) => {
	await appendSyncDebugEvent(db, "review.submit.start", {
		knowledgeId: input.knowledgeId,
		rating: input.rating,
	});

	const foundKnowledge = await db.query.knowledge.findFirst({
		where: eq(knowledge.id, input.knowledgeId),
	});

	if (!foundKnowledge || foundKnowledge.deleted || foundKnowledge.suspended) {
		await appendSyncDebugEvent(db, "review.submit.skipped", {
			knowledgeId: input.knowledgeId,
			missing: !foundKnowledge,
			deleted: foundKnowledge?.deleted ?? null,
			suspended: foundKnowledge?.suspended ?? null,
		});
		return null;
	}

	const now = new Date();
	const previousDue = isKnowledgeDue(foundKnowledge, now);
	const engine = await getFsrsEngine(db);
	const result = engine.next(
		toFsrsCard(foundKnowledge),
		now,
		RATING_TO_FSRS[input.rating],
	);
	const reviewLogId = generateId();
	const reviewUndoId = generateId();
	const reviewedAt = formatStoredDateTime(result.log.review);
	const nowIso = formatStoredDateTime(now);

	await db.transaction(async (tx) => {
		const transactionDb = tx as DrizzleInstance;

		await transactionDb
			.update(reviewUndo)
			.set({
				invalidated: true,
				updatedAt: nowIso,
			})
			.where(and(eq(reviewUndo.undone, false), eq(reviewUndo.invalidated, false)));

		await transactionDb.insert(reviewLog).values({
			id: reviewLogId,
			knowledgeId: foundKnowledge.id,
			rating: FSRS_TO_RATING[result.log.rating as Grade] satisfies RatingType,
			review: reviewedAt,
			due: formatStoredDateTime(result.log.due),
			stability: result.log.stability,
			difficulty: result.log.difficulty,
			elapsedDays: result.log.elapsed_days,
			scheduledDays: result.log.scheduled_days,
			learningSteps: result.log.learning_steps,
			state: FSRS_TO_STATE[result.log.state],
			lastElapsedDays: result.log.last_elapsed_days,
			durationMs: input.durationMs ?? null,
			createdAt: reviewedAt,
			updatedAt: reviewedAt,
		});

		await transactionDb.insert(reviewUndo).values({
			id: reviewUndoId,
			knowledgeId: foundKnowledge.id,
			reviewLogId,
			due: foundKnowledge.due,
			stability: foundKnowledge.stability,
			difficulty: foundKnowledge.difficulty,
			elapsedDays: foundKnowledge.elapsedDays,
			scheduledDays: foundKnowledge.scheduledDays,
			learningSteps: foundKnowledge.learningSteps,
			reps: foundKnowledge.reps,
			lapses: foundKnowledge.lapses,
			state: foundKnowledge.state,
			lastReview: foundKnowledge.lastReview,
			undone: false,
			invalidated: false,
			createdAt: reviewedAt,
			updatedAt: reviewedAt,
		});

		await transactionDb
			.update(knowledge)
			.set({
				due: formatStoredDateTime(result.card.due),
				stability: result.card.stability,
				difficulty: result.card.difficulty,
				elapsedDays: result.card.elapsed_days,
				scheduledDays: result.card.scheduled_days,
				learningSteps: result.card.learning_steps,
				reps: result.card.reps,
				lapses: result.card.lapses,
				state: FSRS_TO_STATE[result.card.state],
				lastReview: result.card.last_review
					? formatStoredDateTime(result.card.last_review)
					: nowIso,
			})
			.where(eq(knowledge.id, foundKnowledge.id));
	});
	await appendSyncDebugEvent(db, "review.submit.log_inserted", {
		knowledgeId: foundKnowledge.id,
		reviewedAt,
	});
	await appendSyncDebugEvent(db, "review.submit.knowledge_updated", {
		knowledgeId: foundKnowledge.id,
		due: formatStoredDateTime(result.card.due),
	});

	const localChangeTimestamp = await markLocalChange(db);
	await appendSyncDebugEvent(db, "review.submit.local_change_marked", {
		knowledgeId: foundKnowledge.id,
		timestamp: localChangeTimestamp,
	});

	return {
		knowledgeId: foundKnowledge.id,
		rating: input.rating,
		now,
		previousDue,
		nextDue: isKnowledgeDue(
			{
				due: formatStoredDateTime(result.card.due),
				deleted: foundKnowledge.deleted,
				suspended: foundKnowledge.suspended,
			},
			now,
		),
		card: result.card,
		log: result.log,
	};
};

export const undoPreviousReview = async ({
	db,
	targetType,
	targetId,
}: {
	db: DrizzleInstance;
	targetType: ReviewTargetType;
	targetId: string;
}) => {
	const candidate = await getLatestReviewUndoCandidate(db);
	if (!candidate) {
		return {
			status: "none" as const,
		};
	}

	const isAvailable = await targetContainsKnowledge({
		db,
		targetType,
		targetId,
		knowledgeId: candidate.knowledgeId,
	});

	if (!isAvailable) {
		return {
			status: "not_available" as const,
			knowledgeId: candidate.knowledgeId,
		};
	}

	const nowIso = formatStoredDateTime(new Date());

	await db.transaction(async (tx) => {
		const transactionDb = tx as DrizzleInstance;

		await transactionDb
			.update(knowledge)
			.set({
				due: candidate.due,
				stability: candidate.stability,
				difficulty: candidate.difficulty,
				elapsedDays: candidate.elapsedDays,
				scheduledDays: candidate.scheduledDays,
				learningSteps: candidate.learningSteps,
				reps: candidate.reps,
				lapses: candidate.lapses,
				state: candidate.state,
				lastReview: candidate.lastReview,
			})
			.where(eq(knowledge.id, candidate.knowledgeId));

		await transactionDb
			.update(reviewLog)
			.set({
				deleted: true,
				updatedAt: nowIso,
			})
			.where(eq(reviewLog.id, candidate.reviewLogId));

		await transactionDb
			.update(reviewUndo)
			.set({
				undone: true,
				updatedAt: nowIso,
			})
			.where(eq(reviewUndo.id, candidate.id));
	});

	const localChangeTimestamp = await markLocalChange(db);
	await appendSyncDebugEvent(db, "review.undo", {
		targetType,
		targetId,
		knowledgeId: candidate.knowledgeId,
		reviewLogId: candidate.reviewLogId,
		timestamp: localChangeTimestamp,
	});

	return {
		status: "undone" as const,
		knowledgeId: candidate.knowledgeId,
	};
};

export const intervalLabelFromDates = (target: Date, now: Date) => {
	const diffMs = target.getTime() - now.getTime();
	const minutes = Math.max(0, Math.round(diffMs / 60000));

	if (minutes < 60) {
		return `${minutes || 0}m`;
	}

	const hours = diffMs / 3600000;
	if (hours < 24) {
		return `${Math.round(hours)}h`;
	}

	const days = diffMs / 86400000;
	if (days < 30) {
		return `${Math.round(days)}d`;
	}

	const months = days / 30;
	if (months < 12) {
		return `${Math.round(months)}mo`;
	}

	const years = months / 12;
	return `${Math.round(years)}y`;
};

export const getReviewTypeLabel = (reviewType: ReviewType | string | null | undefined) => {
	if (HIDDEN_REVIEW_TYPES.includes(reviewType as (typeof HIDDEN_REVIEW_TYPES)[number])) {
		return "Review";
	}

	switch (reviewType) {
		case "Front-Back":
			return "Front / Back";
		case "Back-Front":
			return "Back / Front";
		case "Pitch":
			return "Pitch";
		case "Stroke":
			return "Stroke";
		case "Tone":
			return "Tone";
		case "Listening":
			return "Listening";
		default:
			return reviewType ?? "Review";
	}
};
