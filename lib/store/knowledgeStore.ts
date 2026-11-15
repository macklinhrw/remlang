import {
	and,
	desc,
	eq,
	inArray,
	isNull,
	or,
	sql,
	type SQL,
} from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { getEntryDetail, type EntryDetailResult } from "@/lib/database/lexicon";
import {
	cards,
	decks,
	knowledge,
	type ReviewType,
} from "@/lib/database/schema";
import { generateId } from "@/lib/id";
import {
	DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
	type KnowledgeDefinitionConfig,
	buildKnowledgeConfigSignature,
	getDefaultKnowledgeDefinitionConfig,
	getKnowledgeDefinitionTexts,
	getNextKnowledgeConfigLabel,
	normalizeKnowledgeDefinitionConfig,
	serializeKnowledgeDefinitionConfig,
} from "@/lib/knowledge/config";
import {
	normalizeKnowledgePitchAccentOverride,
	type KnowledgePitchAccentOverride,
} from "@/lib/japanesePitchAccent";
import { refreshDecksStore, syncPrimaryDeckLinkedDecks } from "@/lib/store/decksStore";
import { markLocalChange } from "@/lib/sync/settings";

export type KnowledgeBrowserItem = {
	id: string;
	front: string;
	pronunciation: string | null;
	definitions: string;
	reviewType: string;
	configLabel: string | null;
	suspended: boolean | null;
	updatedAt: string | null;
	linkedCardCount: number;
	linkedDeckCount: number;
};

export type KnowledgeBrowserPage = {
	items: KnowledgeBrowserItem[];
	totalCount: number;
	page: number;
	pageSize: number;
};

export type KnowledgeUsageDeck = {
	deckId: string;
	deckName: string;
	cardCount: number;
	primaryDeckId: string | null;
};

export type KnowledgeDetailResult = {
	knowledge: typeof knowledge.$inferSelect;
	entryDetail: EntryDetailResult | null;
	usageByDeck: KnowledgeUsageDeck[];
	linkedCardCount: number;
	linkedDeckCount: number;
};

type KnowledgeEditableDraft = {
	front: string;
	definitions: string;
	sourceDefinitions: string | null;
	pronunciation: string | null;
	wordId: string | null;
	entryId: string | null;
	focus: string | null;
	showFocus: boolean | null;
	focusAllowsDuplicates: boolean | null;
	note: string | null;
	tags: string | null;
	primaryPitchAccentDictionaryId: string | null;
	primaryPitchAccentReading: string | null;
	primaryPitchAccentAccentNumber: number | null;
	primaryPitchAccentIsCustom: boolean | null;
	configSignature: string;
	definitionConfig: string | null;
	reviewType: string;
	suspended: boolean;
};

const DEFAULT_PAGE_SIZE = 25;

const trimOrNull = (value: string | null | undefined) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
};

const coalesceUpdatedAt = sql`coalesce(${knowledge.updatedAt}, ${knowledge.createdAt})`;

const buildDanglingKnowledgeWhere = (languageId: string) =>
	and(
		eq(knowledge.deleted, false),
		sql`not exists (
			select 1
			from cards as any_cards
			where any_cards.knowledge_id = ${knowledge.id}
		)`,
		sql`(
			exists (
				select 1
				from entries as dangling_entries
				where dangling_entries.id = ${knowledge.entryId}
					and dangling_entries.language_id = ${languageId}
			)
			or exists (
				select 1
				from words as dangling_words
				inner join dictionaries as dangling_dictionaries
					on dangling_dictionaries.id = dangling_words.dictionary_id
				where dangling_words.id = ${knowledge.wordId}
					and dangling_dictionaries.language_id = ${languageId}
			)
		)`,
	);

const buildKnowledgeBrowserWhere = (languageId: string, query?: string | null) => {
	const conditions: SQL[] = [
		eq(decks.languageId, languageId),
		eq(decks.deleted, false),
		eq(cards.deleted, false),
		eq(knowledge.deleted, false),
	];

	const normalizedQuery = query?.trim().toLowerCase();
	if (normalizedQuery) {
		const likePattern = `%${normalizedQuery}%`;
		conditions.push(
			or(
				sql`lower(${knowledge.front}) like ${likePattern}`,
				sql`lower(coalesce(${knowledge.pronunciation}, '')) like ${likePattern}`,
				sql`lower(${knowledge.definitions}) like ${likePattern}`,
			)!,
		);
	}

	return and(...conditions);
};

const toImpactSummary = (usageRows: KnowledgeUsageDeck[]) => ({
	linkedCardCount: usageRows.reduce((total, row) => total + Number(row.cardCount ?? 0), 0),
	linkedDeckCount: usageRows.length,
});

const buildEntryKnowledgeDraft = (
	sourceKnowledge: typeof knowledge.$inferSelect,
	entry: EntryDetailResult,
	config?: KnowledgeDefinitionConfig | null,
) => {
	const normalizedConfig = normalizeKnowledgeDefinitionConfig(entry, config);
	const front = entry.canonicalForm ?? entry.forms[0]?.text ?? sourceKnowledge.front;
	const definitions = getKnowledgeDefinitionTexts(entry, normalizedConfig).join("\n").trim();

	return {
		front,
		definitions: definitions || "No definition available.",
		pronunciation: entry.canonicalReading ?? null,
		configSignature: buildKnowledgeConfigSignature(entry, normalizedConfig),
		definitionConfig: serializeKnowledgeDefinitionConfig(entry, normalizedConfig),
	};
};

const buildKnowledgeDraft = ({
	sourceKnowledge,
	entryDetail,
	config,
	note,
	tags,
	pitchAccentOverride,
	suspended,
}: {
	sourceKnowledge: typeof knowledge.$inferSelect;
	entryDetail: EntryDetailResult | null;
	config?: KnowledgeDefinitionConfig | null;
	note?: string | null;
	tags?: string | null;
	pitchAccentOverride?: KnowledgePitchAccentOverride | null;
	suspended?: boolean;
}): KnowledgeEditableDraft => {
	const entryBackedValues =
		entryDetail && sourceKnowledge.entryId
			? buildEntryKnowledgeDraft(
					sourceKnowledge,
					entryDetail,
					config ?? getDefaultKnowledgeDefinitionConfig(entryDetail),
				)
			: {
					front: sourceKnowledge.front,
					definitions: sourceKnowledge.definitions,
					pronunciation: sourceKnowledge.pronunciation,
					configSignature:
						sourceKnowledge.configSignature ?? DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
					definitionConfig: sourceKnowledge.definitionConfig,
				};
	const normalizedPitchAccentOverride = normalizeKnowledgePitchAccentOverride(
		pitchAccentOverride ?? sourceKnowledge,
	);

	return {
		front: entryBackedValues.front,
		definitions: entryBackedValues.definitions,
		sourceDefinitions: sourceKnowledge.sourceDefinitions,
		pronunciation: entryBackedValues.pronunciation,
		wordId: sourceKnowledge.wordId,
		entryId: sourceKnowledge.entryId,
		focus: sourceKnowledge.focus,
		showFocus: sourceKnowledge.showFocus,
		focusAllowsDuplicates: sourceKnowledge.focusAllowsDuplicates,
		note: trimOrNull(note) ?? null,
		tags: trimOrNull(tags) ?? null,
		primaryPitchAccentDictionaryId:
			normalizedPitchAccentOverride.primaryPitchAccentDictionaryId,
		primaryPitchAccentReading: normalizedPitchAccentOverride.primaryPitchAccentReading,
		primaryPitchAccentAccentNumber:
			normalizedPitchAccentOverride.primaryPitchAccentAccentNumber,
		primaryPitchAccentIsCustom:
			normalizedPitchAccentOverride.primaryPitchAccentIsCustom,
		configSignature: entryBackedValues.configSignature,
		definitionConfig: entryBackedValues.definitionConfig,
		reviewType: sourceKnowledge.reviewType,
		suspended: suspended ?? Boolean(sourceKnowledge.suspended),
	};
};

const isKnowledgeEquivalentToDraft = (
	row: typeof knowledge.$inferSelect,
	draft: KnowledgeEditableDraft,
) =>
	row.deleted !== true &&
	row.entryId === draft.entryId &&
	row.reviewType === draft.reviewType &&
	row.front === draft.front &&
	row.definitions === draft.definitions &&
	(row.sourceDefinitions ?? null) === draft.sourceDefinitions &&
	(row.pronunciation ?? null) === draft.pronunciation &&
	(row.configSignature ?? DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE) === draft.configSignature &&
	(row.definitionConfig ?? null) === draft.definitionConfig &&
	(row.note ?? null) === draft.note &&
	(row.tags ?? null) === draft.tags &&
	(row.primaryPitchAccentDictionaryId ?? null) === draft.primaryPitchAccentDictionaryId &&
	(row.primaryPitchAccentReading ?? null) === draft.primaryPitchAccentReading &&
	(row.primaryPitchAccentAccentNumber ?? null) === draft.primaryPitchAccentAccentNumber &&
	(typeof row.primaryPitchAccentIsCustom === "boolean"
		? row.primaryPitchAccentIsCustom
		: null) === draft.primaryPitchAccentIsCustom &&
	Boolean(row.suspended) === Boolean(draft.suspended);

const findEquivalentKnowledge = async ({
	db,
	sourceKnowledge,
	draft,
}: {
	db: DrizzleInstance;
	sourceKnowledge: typeof knowledge.$inferSelect;
	draft: KnowledgeEditableDraft;
}) => {
	const candidates =
		draft.entryId !== null
			? await db.query.knowledge.findMany({
					where: and(
						eq(knowledge.entryId, draft.entryId),
						eq(knowledge.reviewType, draft.reviewType as ReviewType),
						eq(knowledge.deleted, false),
					),
				})
			: await db.query.knowledge.findMany({
					where: and(
						isNull(knowledge.entryId),
						eq(knowledge.reviewType, draft.reviewType as ReviewType),
						eq(knowledge.deleted, false),
						eq(knowledge.front, draft.front),
					),
				});

	return (
		candidates.find(
			(candidate) =>
				candidate.id !== sourceKnowledge.id &&
				isKnowledgeEquivalentToDraft(candidate, draft),
		) ?? null
	);
};

const syncAffectedPrimaryDecksForKnowledge = async ({
	db,
	knowledgeId,
	reviewType,
}: {
	db: DrizzleInstance;
	knowledgeId: string;
	reviewType: string;
}) => {
	const deckRows = await db
		.select({
			id: decks.id,
			primaryDeckId: decks.primaryDeckId,
			sourceReviewType: decks.sourceReviewType,
		})
		.from(cards)
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(
			and(
				eq(cards.knowledgeId, knowledgeId),
				eq(cards.deleted, false),
				eq(decks.deleted, false),
			),
		);

	const primaryDeckIds = [
		...new Set(
			deckRows
				.filter(
					(deck) =>
						!deck.primaryDeckId && deck.sourceReviewType === reviewType,
				)
				.map((deck) => deck.id),
		),
	];

	for (const primaryDeckId of primaryDeckIds) {
		await syncPrimaryDeckLinkedDecks(db, primaryDeckId);
	}
};

const syncOriginPrimaryDeckIfNeeded = async ({
	db,
	originCard,
	reviewType,
}: {
	db: DrizzleInstance;
	originCard: typeof cards.$inferSelect & {
		deck: Pick<typeof decks.$inferSelect, "id" | "languageId" | "primaryDeckId" | "sourceReviewType">;
	};
	reviewType: string;
}) => {
	if (
		!originCard.deck.primaryDeckId &&
		originCard.deck.sourceReviewType === reviewType
	) {
		await syncPrimaryDeckLinkedDecks(db, originCard.deck.id);
	}
};

const getNextConfigLabelForDraft = async ({
	db,
	sourceKnowledge,
}: {
	db: DrizzleInstance;
	sourceKnowledge: typeof knowledge.$inferSelect;
}) => {
	if (!sourceKnowledge.entryId) {
		return sourceKnowledge.configLabel ?? null;
	}

	const siblings = await db.query.knowledge.findMany({
		where: and(
			eq(knowledge.entryId, sourceKnowledge.entryId),
			eq(knowledge.reviewType, sourceKnowledge.reviewType as ReviewType),
		),
		columns: {
			configLabel: true,
		},
	});

	return getNextKnowledgeConfigLabel(siblings.map((item) => item.configLabel));
};

export const getKnowledgeBrowserPage = async (
	db: DrizzleInstance,
	input: {
		languageId: string;
		query?: string | null;
		page?: number;
		pageSize?: number;
	},
): Promise<KnowledgeBrowserPage> => {
	const pageSize = Math.max(1, input.pageSize ?? DEFAULT_PAGE_SIZE);
	const page = Math.max(1, input.page ?? 1);
	const offset = (page - 1) * pageSize;
	const whereClause = buildKnowledgeBrowserWhere(input.languageId, input.query);

	const [countRow] = await db
		.select({
			totalCount: sql<number>`count(distinct ${knowledge.id})`,
		})
		.from(knowledge)
		.innerJoin(cards, eq(cards.knowledgeId, knowledge.id))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(whereClause);

	const items = await db
		.select({
			id: knowledge.id,
			front: knowledge.front,
			pronunciation: knowledge.pronunciation,
			definitions: knowledge.definitions,
			reviewType: knowledge.reviewType,
			configLabel: knowledge.configLabel,
			suspended: knowledge.suspended,
			updatedAt: knowledge.updatedAt,
			linkedCardCount: sql<number>`count(distinct ${cards.id})`,
			linkedDeckCount: sql<number>`count(distinct ${cards.deckId})`,
		})
		.from(knowledge)
		.innerJoin(cards, eq(cards.knowledgeId, knowledge.id))
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(whereClause)
		.groupBy(
			knowledge.id,
			knowledge.front,
			knowledge.pronunciation,
			knowledge.definitions,
			knowledge.reviewType,
			knowledge.configLabel,
			knowledge.suspended,
			knowledge.updatedAt,
			knowledge.createdAt,
		)
		.orderBy(desc(coalesceUpdatedAt), desc(knowledge.createdAt))
		.limit(pageSize)
		.offset(offset);

	return {
		items: items.map((item) => ({
			...item,
			linkedCardCount: Number(item.linkedCardCount ?? 0),
			linkedDeckCount: Number(item.linkedDeckCount ?? 0),
		})),
		totalCount: Number(countRow?.totalCount ?? 0),
		page,
		pageSize,
	};
};

export const getKnowledgeDetail = async (
	db: DrizzleInstance,
	input: {
		knowledgeId: string;
		languageId?: string | null;
	},
): Promise<KnowledgeDetailResult | null> => {
	const foundKnowledge = await db.query.knowledge.findFirst({
		where: and(eq(knowledge.id, input.knowledgeId), eq(knowledge.deleted, false)),
	});

	if (!foundKnowledge) {
		return null;
	}

	const usageConditions: SQL[] = [
		eq(cards.knowledgeId, foundKnowledge.id),
		eq(cards.deleted, false),
		eq(decks.deleted, false),
	];
	if (input.languageId) {
		usageConditions.push(eq(decks.languageId, input.languageId));
	}

	const usageQuery = db
		.select({
			deckId: decks.id,
			deckName: decks.name,
			primaryDeckId: decks.primaryDeckId,
			cardCount: sql<number>`count(distinct ${cards.id})`,
		})
		.from(cards)
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(and(...usageConditions))
		.groupBy(decks.id, decks.name, decks.primaryDeckId)
		.orderBy(decks.name);

	const [usageByDeck, entryDetail] = await Promise.all([
		usageQuery,
		foundKnowledge.entryId ? getEntryDetail(db, foundKnowledge.entryId) : Promise.resolve(null),
	]);

	if (input.languageId && usageByDeck.length === 0) {
		return null;
	}

	const normalizedUsage = usageByDeck.map((row) => ({
		...row,
		cardCount: Number(row.cardCount ?? 0),
	}));
	const impact = toImpactSummary(normalizedUsage);

	return {
		knowledge: foundKnowledge,
		entryDetail,
		usageByDeck: normalizedUsage,
		...impact,
	};
};

export const updateKnowledgeInPlace = async (
	db: DrizzleInstance,
	input: {
		knowledgeId: string;
		languageId?: string | null;
		config?: KnowledgeDefinitionConfig | null;
		note?: string | null;
		tags?: string | null;
		pitchAccentOverride?: KnowledgePitchAccentOverride | null;
		suspended?: boolean;
	},
) => {
	const existing = await getKnowledgeDetail(db, {
		knowledgeId: input.knowledgeId,
		languageId: input.languageId,
	});
	if (!existing) {
		return { status: "missing_knowledge" as const };
	}

	const draft = buildKnowledgeDraft({
		sourceKnowledge: existing.knowledge,
		entryDetail: existing.entryDetail,
		config: input.config,
		note: input.note,
		tags: input.tags,
		pitchAccentOverride: input.pitchAccentOverride,
		suspended: input.suspended,
	});

	await db
		.update(knowledge)
		.set({
			front: draft.front,
			definitions: draft.definitions,
			pronunciation: draft.pronunciation,
			note: draft.note,
			tags: draft.tags,
			primaryPitchAccentDictionaryId: draft.primaryPitchAccentDictionaryId,
			primaryPitchAccentReading: draft.primaryPitchAccentReading,
			primaryPitchAccentAccentNumber: draft.primaryPitchAccentAccentNumber,
			primaryPitchAccentIsCustom: draft.primaryPitchAccentIsCustom,
			configSignature: draft.configSignature,
			definitionConfig: draft.definitionConfig,
			suspended: draft.suspended,
		})
		.where(eq(knowledge.id, existing.knowledge.id));

	await syncAffectedPrimaryDecksForKnowledge({
		db,
		knowledgeId: existing.knowledge.id,
		reviewType: existing.knowledge.reviewType,
	});
	await markLocalChange(db);
	if (input.languageId) {
		await refreshDecksStore(db, input.languageId);
	}

	return {
		status: "updated" as const,
		knowledgeId: existing.knowledge.id,
		linkedCardCount: existing.linkedCardCount,
		linkedDeckCount: existing.linkedDeckCount,
	};
};

export const forkKnowledgeForCard = async (
	db: DrizzleInstance,
	input: {
		knowledgeId: string;
		cardId: string;
		languageId?: string | null;
		config?: KnowledgeDefinitionConfig | null;
		note?: string | null;
		tags?: string | null;
		pitchAccentOverride?: KnowledgePitchAccentOverride | null;
		suspended?: boolean;
	},
) => {
	const [sourceKnowledge, originCard] = await Promise.all([
		db.query.knowledge.findFirst({
			where: and(eq(knowledge.id, input.knowledgeId), eq(knowledge.deleted, false)),
		}),
		db.query.cards.findFirst({
			where: and(eq(cards.id, input.cardId), eq(cards.deleted, false)),
			with: {
				deck: {
					columns: {
						id: true,
						languageId: true,
						primaryDeckId: true,
						sourceReviewType: true,
					},
				},
			},
		}),
	]);

	if (!sourceKnowledge) {
		return { status: "missing_knowledge" as const };
	}
	if (!originCard) {
		return { status: "missing_card" as const };
	}
	if (originCard.knowledgeId !== sourceKnowledge.id) {
		return { status: "card_mismatch" as const };
	}
	if (originCard.deck.primaryDeckId) {
		return {
			status: "managed_by_primary" as const,
			primaryDeckId: originCard.deck.primaryDeckId,
		};
	}
	if (input.languageId && originCard.deck.languageId !== input.languageId) {
		return { status: "language_mismatch" as const };
	}

	const entryDetail = sourceKnowledge.entryId
		? await getEntryDetail(db, sourceKnowledge.entryId)
		: null;
	const draft = buildKnowledgeDraft({
		sourceKnowledge,
		entryDetail,
		config: input.config,
		note: input.note,
		tags: input.tags,
		pitchAccentOverride: input.pitchAccentOverride,
		suspended: input.suspended,
	});

	const equivalentKnowledge = await findEquivalentKnowledge({
		db,
		sourceKnowledge,
		draft,
	});

	if (equivalentKnowledge) {
		const existingDeckCard = await db.query.cards.findFirst({
			where: and(
				eq(cards.deckId, originCard.deckId),
				eq(cards.knowledgeId, equivalentKnowledge.id),
				eq(cards.deleted, false),
			),
		});

		if (existingDeckCard && existingDeckCard.id !== originCard.id) {
			return {
				status: "card_already_exists" as const,
				existingKnowledgeId: equivalentKnowledge.id,
				existingCardId: existingDeckCard.id,
			};
		}

		await db
			.update(cards)
			.set({
				knowledgeId: equivalentKnowledge.id,
			})
			.where(eq(cards.id, originCard.id));

		await syncOriginPrimaryDeckIfNeeded({
			db,
			originCard,
			reviewType: sourceKnowledge.reviewType,
		});
		await markLocalChange(db);
		if (input.languageId) {
			await refreshDecksStore(db, input.languageId);
		}

		return {
			status: "linked_existing" as const,
			knowledgeId: equivalentKnowledge.id,
			cardId: originCard.id,
		};
	}

	const nextConfigLabel = await getNextConfigLabelForDraft({
		db,
		sourceKnowledge,
	});
	const [insertedKnowledge] = await db
		.insert(knowledge)
		.values({
			id: generateId(),
			front: draft.front,
			definitions: draft.definitions,
			sourceDefinitions: draft.sourceDefinitions,
			pronunciation: draft.pronunciation,
			wordId: draft.wordId,
			entryId: draft.entryId,
			focus: draft.focus,
			showFocus: draft.showFocus ?? false,
			focusAllowsDuplicates: draft.focusAllowsDuplicates ?? true,
			note: draft.note,
			tags: draft.tags,
			primaryPitchAccentDictionaryId: draft.primaryPitchAccentDictionaryId,
			primaryPitchAccentReading: draft.primaryPitchAccentReading,
			primaryPitchAccentAccentNumber: draft.primaryPitchAccentAccentNumber,
			primaryPitchAccentIsCustom: draft.primaryPitchAccentIsCustom,
			configSignature: draft.configSignature,
			definitionConfig: draft.definitionConfig,
			configLabel: nextConfigLabel,
			due: sourceKnowledge.due,
			stability: sourceKnowledge.stability,
			difficulty: sourceKnowledge.difficulty,
			elapsedDays: sourceKnowledge.elapsedDays,
			scheduledDays: sourceKnowledge.scheduledDays,
			learningSteps: sourceKnowledge.learningSteps,
			reps: sourceKnowledge.reps,
			lapses: sourceKnowledge.lapses,
			state: sourceKnowledge.state,
			lastReview: sourceKnowledge.lastReview,
			reviewType: draft.reviewType,
			deleted: false,
			suspended: draft.suspended,
		})
		.returning();

	if (!insertedKnowledge) {
		return { status: "missing_knowledge" as const };
	}

	await db
		.update(cards)
		.set({
			knowledgeId: insertedKnowledge.id,
		})
		.where(eq(cards.id, originCard.id));

	await syncOriginPrimaryDeckIfNeeded({
		db,
		originCard,
		reviewType: sourceKnowledge.reviewType,
	});
	await markLocalChange(db);
	if (input.languageId) {
		await refreshDecksStore(db, input.languageId);
	}

	return {
		status: "copied" as const,
		knowledgeId: insertedKnowledge.id,
		cardId: originCard.id,
	};
};

export const trashKnowledge = async (
	db: DrizzleInstance,
	input: {
		knowledgeId: string;
		languageId?: string | null;
	},
) => {
	const existing = await getKnowledgeDetail(db, {
		knowledgeId: input.knowledgeId,
		languageId: input.languageId,
	});

	if (!existing) {
		return { status: "missing_knowledge" as const };
	}

	const affectedPrimaryDeckRows = await db
		.select({
			id: decks.id,
		})
		.from(cards)
		.innerJoin(decks, eq(decks.id, cards.deckId))
		.where(
			and(
				eq(cards.knowledgeId, existing.knowledge.id),
				eq(cards.deleted, false),
				eq(decks.deleted, false),
				isNull(decks.primaryDeckId),
				eq(decks.sourceReviewType, existing.knowledge.reviewType as ReviewType),
			),
		);
	const affectedPrimaryDeckIds = [...new Set(affectedPrimaryDeckRows.map((deck) => deck.id))];

	const deletedAt = new Date().toISOString();

	await db
		.update(cards)
		.set({
			deleted: true,
			deletedAt,
		})
		.where(and(eq(cards.knowledgeId, existing.knowledge.id), eq(cards.deleted, false)));
	await db
		.update(knowledge)
		.set({
			deleted: true,
		})
		.where(eq(knowledge.id, existing.knowledge.id));

	for (const primaryDeckId of [...new Set(affectedPrimaryDeckIds)]) {
		await syncPrimaryDeckLinkedDecks(db, primaryDeckId);
	}

	await markLocalChange(db, deletedAt);
	if (input.languageId) {
		await refreshDecksStore(db, input.languageId);
	}

	return {
		status: "trashed" as const,
		knowledgeId: existing.knowledge.id,
		linkedCardCount: existing.linkedCardCount,
		linkedDeckCount: existing.linkedDeckCount,
	};
};

export const getDanglingKnowledgeCount = async (
	db: DrizzleInstance,
	languageId: string,
) => {
	const [countRow] = await db
		.select({
			totalCount: sql<number>`count(*)`,
		})
		.from(knowledge)
		.where(buildDanglingKnowledgeWhere(languageId));

	return Number(countRow?.totalCount ?? 0);
};

export const trashDanglingKnowledge = async (
	db: DrizzleInstance,
	input: {
		languageId: string;
	},
) => {
	const danglingRows = await db
		.select({
			id: knowledge.id,
		})
		.from(knowledge)
		.where(buildDanglingKnowledgeWhere(input.languageId));

	if (danglingRows.length === 0) {
		return {
			status: "none_found" as const,
			count: 0,
		};
	}

	await db
		.update(knowledge)
		.set({
			deleted: true,
		})
		.where(
			inArray(
				knowledge.id,
				danglingRows.map((row) => row.id),
			),
		);

	await markLocalChange(db);
	await refreshDecksStore(db, input.languageId);

	return {
		status: "trashed" as const,
		count: danglingRows.length,
	};
};
