import { observable } from "@legendapp/state";
import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { getEntryDetail, type EntryDetailResult } from "@/lib/database/lexicon";
import {
	cardLinks,
	cards,
	deckLinks,
	decks,
	decksFolders,
	knowledge,
	knowledgeLinks,
	type ReviewType,
} from "@/lib/database/schema";
import { generateId } from "@/lib/id";
import {
	DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
	type KnowledgeDefinitionConfig,
	buildKnowledgeConfigSignature,
	getDefaultKnowledgeDefinitionConfig,
	getGlossKey,
	getKnowledgeDefinitionTexts,
	getNextKnowledgeConfigLabel,
	serializeKnowledgeDefinitionConfig,
} from "@/lib/knowledge/config";
import type { PremadeDeckItem } from "@/lib/premadeDecks/types";
import {
	getDeckAvailableDueCount,
	getFolderAvailableDueCount,
	getReviewTypeLabel,
} from "@/lib/review/fsrs";
import { hasPitchAccentReviewSupport } from "@/lib/review/pitchEligibility";
import { normalizeReviewLimitSettings } from "@/lib/review/reviewLimits";
import { hasStrokeEligibleCharacters } from "@/lib/review/strokeEligibility";
import {
	createPermanentDeleteRecord,
	upsertPermanentDeletes,
} from "@/lib/sync/permanentDeletes";
import { markLocalChange } from "@/lib/sync/settings";

export type DeckRole = "normal" | "primary" | "linked";

export type DeckListItem = typeof decks.$inferSelect & {
	cardCount: number;
	dueCount: number;
	lastReviewedAt: string | null;
	hasActiveLinkedDecks: boolean;
};

export type DeckCardListItem = typeof cards.$inferSelect & {
	knowledge: typeof knowledge.$inferSelect | null;
};

export type LinkedDeckListItem = DeckListItem & {
	targetReviewType: string;
};

export type PrimaryDeckSummary = Pick<
	typeof decks.$inferSelect,
	"id" | "name" | "sourceReviewType"
>;

export type DeckDetailResult = DeckListItem & {
	cards: DeckCardListItem[];
	role: DeckRole;
	primaryDeck: PrimaryDeckSummary | null;
	linkedDecks: LinkedDeckListItem[];
};

export type DeletedDeckListItem = typeof decks.$inferSelect & {
	deletedCardCount: number;
};

export type DeletedDeckFolderListItem = typeof decksFolders.$inferSelect & {
	childDeckCount: number;
	deletedCardCount: number;
	decks: DeletedDeckListItem[];
};

export type DeletedTrashSnapshot = {
	folders: DeletedDeckFolderListItem[];
	decks: DeletedDeckListItem[];
};

export type DeckFolderListItem = typeof decksFolders.$inferSelect & {
	childDeckCount: number;
	cardCount: number;
	dueCount: number;
	lastReviewedAt: string | null;
	decks: DeckListItem[];
};

export type DeckCollectionListItem =
	| {
			kind: "folder";
			id: string;
			name: string;
			cardCount: number;
			dueCount: number;
			folder: DeckFolderListItem;
	  }
	| {
			kind: "deck";
			id: string;
			name: string;
			cardCount: number;
			dueCount: number;
			deck: DeckListItem;
	  };

const buildKnowledgePayload = (
	entry: EntryDetailResult,
	config?: KnowledgeDefinitionConfig | null,
) => {
	const front = entry.canonicalForm ?? entry.forms[0]?.text ?? entry.id;
	const definitions = getKnowledgeDefinitionTexts(entry, config).join("\n");

	return {
		front,
		definitions: definitions || "No definition available.",
		sourceDefinitions: null,
		pronunciation: entry.canonicalReading ?? null,
		configSignature: buildKnowledgeConfigSignature(entry, config),
		definitionConfig: serializeKnowledgeDefinitionConfig(entry, config),
	};
};

const buildKnowledgeConfigFromSenseIds = (
	entry: EntryDetailResult,
	senseIds: string[],
): KnowledgeDefinitionConfig | null => {
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

const trimOrNull = (value: string | null | undefined) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
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

const buildMirroredKnowledgeValues = ({
	sourceKnowledge,
	targetReviewType,
}: {
	sourceKnowledge: typeof knowledge.$inferSelect;
	targetReviewType: string;
}) => ({
	front: sourceKnowledge.front,
	definitions: sourceKnowledge.definitions,
	sourceDefinitions: sourceKnowledge.sourceDefinitions,
	pronunciation: sourceKnowledge.pronunciation,
	wordId: sourceKnowledge.wordId,
	entryId: sourceKnowledge.entryId,
	focus: sourceKnowledge.focus,
	showFocus: sourceKnowledge.showFocus,
	focusAllowsDuplicates: sourceKnowledge.focusAllowsDuplicates,
	note: sourceKnowledge.note,
	tags: sourceKnowledge.tags,
	primaryPitchAccentDictionaryId: sourceKnowledge.primaryPitchAccentDictionaryId,
	primaryPitchAccentReading: sourceKnowledge.primaryPitchAccentReading,
	primaryPitchAccentAccentNumber: sourceKnowledge.primaryPitchAccentAccentNumber,
	primaryPitchAccentIsCustom: sourceKnowledge.primaryPitchAccentIsCustom,
	configSignature: sourceKnowledge.configSignature ?? DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
	definitionConfig: sourceKnowledge.definitionConfig,
	configLabel: sourceKnowledge.configLabel,
	reviewType: targetReviewType,
	deleted: false,
	suspended: sourceKnowledge.suspended ?? false,
});

const resolveLinkedDeckName = (primaryDeckName: string, targetReviewType: string) =>
	`${primaryDeckName} · ${getReviewTypeLabel(targetReviewType as ReviewType)}`;

const supportsStrokeReviewType = (front: string) => hasStrokeEligibleCharacters(front);

const supportsReviewTypeForEntry = ({
	reviewType,
	entry,
	front,
}: {
	reviewType: string;
	entry: EntryDetailResult | null;
	front: string;
}) => {
	if (reviewType === "Stroke") {
		return supportsStrokeReviewType(front);
	}

	if (reviewType === "Pitch") {
		return hasPitchAccentReviewSupport(entry);
	}

	return true;
};

const createReviewTypeSupportResolver = (db: DrizzleInstance) => {
	const pitchSupportByEntryId = new Map<string, Promise<boolean> | boolean>();

	return async ({
		reviewType,
		sourceKnowledge,
	}: {
		reviewType: string;
		sourceKnowledge: typeof knowledge.$inferSelect;
	}) => {
		if (reviewType === "Stroke") {
			return supportsStrokeReviewType(sourceKnowledge.front);
		}

		if (reviewType !== "Pitch") {
			return true;
		}

		if (!sourceKnowledge.entryId) {
			return false;
		}

		const cached = pitchSupportByEntryId.get(sourceKnowledge.entryId);
		if (cached !== undefined) {
			return await cached;
		}

		const nextSupport = getEntryDetail(db, sourceKnowledge.entryId)
			.then((entry) => hasPitchAccentReviewSupport(entry))
			.catch(() => false);
		pitchSupportByEntryId.set(sourceKnowledge.entryId, nextSupport);
		const resolvedSupport = await nextSupport;
		pitchSupportByEntryId.set(sourceKnowledge.entryId, resolvedSupport);
		return resolvedSupport;
	};
};

const sortByName = <T extends { name: string }>(rows: T[]) =>
	[...rows].sort((left, right) =>
		left.name.localeCompare(right.name, undefined, {
			numeric: true,
			sensitivity: "base",
		}),
	);

const getDeckStatsByDeckId = async (
	db: DrizzleInstance,
	deckRows: (typeof decks.$inferSelect)[],
) => {
	if (deckRows.length === 0) {
		return new Map<string, { cardCount: number; dueCount: number; lastReviewedAt: string | null }>();
	}

	const deckIds = deckRows.map((deck) => deck.id);
	const dueCountByDeckId = new Map(
		await Promise.all(
			deckRows.map(async (deck) => [
				deck.id,
				await getDeckAvailableDueCount({
					db,
					deck,
					languageId: deck.languageId ?? undefined,
				}),
			] as const),
		),
	);

	const deckCards = await db.query.cards.findMany({
		where: and(inArray(cards.deckId, deckIds), eq(cards.deleted, false)),
		with: {
			knowledge: true,
		},
	});

	const statsByDeckId = new Map<
		string,
		{ cardCount: number; dueCount: number; lastReviewedAt: string | null }
	>();

	for (const deck of deckRows) {
		const deckId = deck.id;
		statsByDeckId.set(deckId, {
			cardCount: 0,
			dueCount: dueCountByDeckId.get(deckId) ?? 0,
			lastReviewedAt: null,
		});
	}

	for (const card of deckCards) {
		const stats = statsByDeckId.get(card.deckId);
		if (!stats) {
			continue;
		}

		stats.cardCount += 1;
		const item = card.knowledge;
		if (!item || item.deleted || item.suspended) {
			continue;
		}

		if (!stats.lastReviewedAt || item.lastReview > stats.lastReviewedAt) {
			stats.lastReviewedAt = item.lastReview;
		}
	}

	return statsByDeckId;
};

const getFolderStats = async ({
	db,
	folder,
	childDecks,
	languageId,
}: {
	db: DrizzleInstance;
	folder: typeof decksFolders.$inferSelect;
	childDecks: DeckListItem[];
	languageId?: string;
}) => {
	const deckIds = childDecks.map((deck) => deck.id);
	if (deckIds.length === 0) {
		return {
			cardCount: 0,
			dueCount: 0,
			lastReviewedAt: null,
		};
	}

	const deckCards = await db.query.cards.findMany({
		where: and(inArray(cards.deckId, deckIds), eq(cards.deleted, false)),
		with: {
			knowledge: true,
		},
	});

	const uniqueKnowledge = new Map<string, typeof knowledge.$inferSelect>();
	for (const card of deckCards) {
		if (!card.knowledge || card.knowledge.deleted) {
			continue;
		}

		if (!uniqueKnowledge.has(card.knowledge.id)) {
			uniqueKnowledge.set(card.knowledge.id, card.knowledge);
		}
	}

	const dueCount = await getFolderAvailableDueCount({
		db,
		folder,
		childDecks,
		languageId: languageId ?? childDecks[0]?.languageId ?? undefined,
	});
	let lastReviewedAt: string | null = null;

	for (const item of uniqueKnowledge.values()) {
		if (item.lastReview && (!lastReviewedAt || item.lastReview > lastReviewedAt)) {
			lastReviewedAt = item.lastReview;
		}
	}

	return {
		cardCount: uniqueKnowledge.size,
		dueCount,
		lastReviewedAt,
	};
};

const withDeckStats = async (
	db: DrizzleInstance,
	deckRows: (typeof decks.$inferSelect)[],
): Promise<DeckListItem[]> => {
	const primaryDeckIds = deckRows
		.filter((deck) => !deck.primaryDeckId)
		.map((deck) => deck.id);
	const [linkedDeckRows, statsByDeck] = await Promise.all([
		primaryDeckIds.length > 0
			? db.query.decks.findMany({
					where: and(
						inArray(decks.primaryDeckId, primaryDeckIds),
						eq(decks.deleted, false),
					),
				})
			: Promise.resolve([]),
		getDeckStatsByDeckId(
			db,
			deckRows,
		),
	]);
	const activeLinkedCountByDeckId = new Map<string, number>();
	for (const primaryDeckId of primaryDeckIds) {
		activeLinkedCountByDeckId.set(primaryDeckId, 0);
	}
	for (const row of linkedDeckRows) {
		if (!row.primaryDeckId) {
			continue;
		}
		activeLinkedCountByDeckId.set(
			row.primaryDeckId,
			(activeLinkedCountByDeckId.get(row.primaryDeckId) ?? 0) + 1,
		);
	}

	return deckRows.map((deck) => ({
		...deck,
		cardCount: statsByDeck.get(deck.id)?.cardCount ?? 0,
		dueCount: statsByDeck.get(deck.id)?.dueCount ?? 0,
		lastReviewedAt: statsByDeck.get(deck.id)?.lastReviewedAt ?? null,
		hasActiveLinkedDecks: (activeLinkedCountByDeckId.get(deck.id) ?? 0) > 0,
	}));
};

const getLinkedDeckSummaries = async (
	db: DrizzleInstance,
	primaryDeckId: string,
): Promise<LinkedDeckListItem[]> => {
	const linkRows = await db.query.deckLinks.findMany({
		where: eq(deckLinks.primaryDeckId, primaryDeckId),
	});

	if (linkRows.length === 0) {
		return [];
	}

	const linkedDeckIds = linkRows.map((row) => row.linkedDeckId);
	const linkedDeckRows = await db.query.decks.findMany({
		where: and(inArray(decks.id, linkedDeckIds), eq(decks.deleted, false)),
	});
	const linkedDecksWithStats = await withDeckStats(db, linkedDeckRows);
	const targetReviewTypeByDeckId = new Map(
		linkRows.map((row) => [row.linkedDeckId, row.targetReviewType]),
	);

	return linkedDecksWithStats.map((deck) => ({
		...deck,
		targetReviewType: targetReviewTypeByDeckId.get(deck.id) ?? "Front-Back",
	}));
};

const ensureMirroredKnowledge = async ({
	db,
	deckLinkRow,
	sourceKnowledge,
	existingKnowledgeLink,
}: {
	db: DrizzleInstance;
	deckLinkRow: typeof deckLinks.$inferSelect;
	sourceKnowledge: typeof knowledge.$inferSelect;
	existingKnowledgeLink: typeof knowledgeLinks.$inferSelect | null;
}) => {
	const mirroredValues = buildMirroredKnowledgeValues({
		sourceKnowledge,
		targetReviewType: deckLinkRow.targetReviewType,
	});

	if (!existingKnowledgeLink) {
		const mirroredKnowledgeId = generateId();
		await db.insert(knowledge).values({
			id: mirroredKnowledgeId,
			...mirroredValues,
		});
		const insertedLink = await db
			.insert(knowledgeLinks)
			.values({
				id: generateId(),
				deckLinkId: deckLinkRow.id,
				sourceKnowledgeId: sourceKnowledge.id,
				mirroredKnowledgeId,
			})
			.returning();

		return {
			mirroredKnowledgeId,
			knowledgeLink: insertedLink[0] ?? null,
		};
	}

	const mirroredKnowledge = await db.query.knowledge.findFirst({
		where: eq(knowledge.id, existingKnowledgeLink.mirroredKnowledgeId),
	});

	if (!mirroredKnowledge) {
		const mirroredKnowledgeId = generateId();
		await db.insert(knowledge).values({
			id: mirroredKnowledgeId,
			...mirroredValues,
		});
		await db
			.update(knowledgeLinks)
			.set({
				mirroredKnowledgeId,
			})
			.where(eq(knowledgeLinks.id, existingKnowledgeLink.id));

		return {
			mirroredKnowledgeId,
			knowledgeLink: {
				...existingKnowledgeLink,
				mirroredKnowledgeId,
			},
		};
	}

	await db
		.update(knowledge)
		.set(mirroredValues)
		.where(eq(knowledge.id, existingKnowledgeLink.mirroredKnowledgeId));

	return {
		mirroredKnowledgeId: existingKnowledgeLink.mirroredKnowledgeId,
		knowledgeLink: existingKnowledgeLink,
	};
};

const ensureMirroredCard = async ({
	db,
	deckLinkRow,
	sourceCard,
	mirroredKnowledgeId,
	existingCardLink,
}: {
	db: DrizzleInstance;
	deckLinkRow: typeof deckLinks.$inferSelect;
	sourceCard: DeckCardListItem;
	mirroredKnowledgeId: string;
	existingCardLink: typeof cardLinks.$inferSelect | null;
}) => {
	if (!existingCardLink) {
		const mirroredCardId = generateId();
		await db.insert(cards).values({
			id: mirroredCardId,
			deckId: deckLinkRow.linkedDeckId,
			knowledgeId: mirroredKnowledgeId,
			note: sourceCard.note ?? null,
			tags: sourceCard.tags ?? null,
			deleted: false,
			deletedAt: null,
		});
		await db.insert(cardLinks).values({
			id: generateId(),
			deckLinkId: deckLinkRow.id,
			sourceCardId: sourceCard.id,
			mirroredCardId,
		});
		return;
	}

	const mirroredCard = await db.query.cards.findFirst({
		where: eq(cards.id, existingCardLink.mirroredCardId),
	});

	if (!mirroredCard) {
		const mirroredCardId = generateId();
		await db.insert(cards).values({
			id: mirroredCardId,
			deckId: deckLinkRow.linkedDeckId,
			knowledgeId: mirroredKnowledgeId,
			note: sourceCard.note ?? null,
			tags: sourceCard.tags ?? null,
			deleted: false,
			deletedAt: null,
		});
		await db
			.update(cardLinks)
			.set({
				mirroredCardId,
			})
			.where(eq(cardLinks.id, existingCardLink.id));
		return;
	}

	await db
		.update(cards)
		.set({
			deckId: deckLinkRow.linkedDeckId,
			knowledgeId: mirroredKnowledgeId,
			note: sourceCard.note ?? null,
			tags: sourceCard.tags ?? null,
			deleted: false,
			deletedAt: null,
		})
		.where(eq(cards.id, existingCardLink.mirroredCardId));
};

const deleteMirroredCard = async ({
	db,
	cardLinkRow,
	deletedAt,
}: {
	db: DrizzleInstance;
	cardLinkRow: typeof cardLinks.$inferSelect;
	deletedAt: string;
}) => {
	await db
		.update(cards)
		.set({
			deleted: true,
			deletedAt,
		})
		.where(eq(cards.id, cardLinkRow.mirroredCardId));
};

export const syncPrimaryDeckLinkedDecks = async (
	db: DrizzleInstance,
	primaryDeckId: string,
) => {
	const primaryDeck = await db.query.decks.findFirst({
		where: eq(decks.id, primaryDeckId),
	});

	if (!primaryDeck || primaryDeck.primaryDeckId || !primaryDeck.sourceReviewType) {
		return;
	}

	const linkRows = await db.query.deckLinks.findMany({
		where: eq(deckLinks.primaryDeckId, primaryDeck.id),
	});

	if (linkRows.length === 0) {
		return;
	}
	const supportsTargetReviewType = createReviewTypeSupportResolver(db);

	const sourceCards = await db.query.cards.findMany({
		where: eq(cards.deckId, primaryDeck.id),
		with: {
			knowledge: true,
		},
	});
	const deckLinkIds = linkRows.map((row) => row.id);
	const [allCardLinks, allKnowledgeLinks] = await Promise.all([
		db.query.cardLinks.findMany({
			where: inArray(cardLinks.deckLinkId, deckLinkIds),
		}),
		db.query.knowledgeLinks.findMany({
			where: inArray(knowledgeLinks.deckLinkId, deckLinkIds),
		}),
	]);
	const deletedAt = new Date().toISOString();

	for (const deckLinkRow of linkRows) {
		const cardLinkBySourceCardId = new Map(
			allCardLinks
				.filter((row) => row.deckLinkId === deckLinkRow.id)
				.map((row) => [row.sourceCardId, row]),
		);
		const knowledgeLinkBySourceKnowledgeId = new Map(
			allKnowledgeLinks
				.filter((row) => row.deckLinkId === deckLinkRow.id)
				.map((row) => [row.sourceKnowledgeId, row]),
		);

		for (const sourceCard of sourceCards) {
			const sourceKnowledge = sourceCard.knowledge;
			const targetReviewTypeSupported = sourceKnowledge
				? await supportsTargetReviewType({
						reviewType: deckLinkRow.targetReviewType,
						sourceKnowledge,
					})
				: false;
			const eligible =
				Boolean(sourceKnowledge) &&
				!sourceCard.deleted &&
				!sourceKnowledge.deleted &&
				sourceKnowledge.reviewType === primaryDeck.sourceReviewType &&
				targetReviewTypeSupported;
			const existingCardLink = cardLinkBySourceCardId.get(sourceCard.id) ?? null;

			if (!eligible || !sourceKnowledge) {
				if (existingCardLink) {
					await deleteMirroredCard({
						db,
						cardLinkRow: existingCardLink,
						deletedAt,
					});
				}
				continue;
			}

			const existingKnowledgeLink =
				knowledgeLinkBySourceKnowledgeId.get(sourceKnowledge.id) ?? null;
			const { mirroredKnowledgeId } = await ensureMirroredKnowledge({
				db,
				deckLinkRow,
				sourceKnowledge,
				existingKnowledgeLink,
			});
			await ensureMirroredCard({
				db,
				deckLinkRow,
				sourceCard,
				mirroredKnowledgeId,
				existingCardLink,
			});
		}
	}
};

const getDeckCascadeIds = async (db: DrizzleInstance, primaryDeckId: string) => {
	const linkRows = await db.query.deckLinks.findMany({
		where: eq(deckLinks.primaryDeckId, primaryDeckId),
	});
	return [primaryDeckId, ...linkRows.map((row) => row.linkedDeckId)];
};

const getFolderCascadeDeckIds = async (
	db: DrizzleInstance,
	folderId: string,
	includeDeleted = false,
) => {
	const folderDecks = await db.query.decks.findMany({
		where: includeDeleted
			? eq(decks.folderId, folderId)
			: and(eq(decks.folderId, folderId), eq(decks.deleted, false)),
	});
	const cascadeDeckIds = new Set<string>();

	for (const deck of folderDecks.filter((item) => !item.primaryDeckId)) {
		for (const deckId of await getDeckCascadeIds(db, deck.id)) {
			cascadeDeckIds.add(deckId);
		}
	}

	for (const deck of folderDecks.filter((item) => item.primaryDeckId)) {
		cascadeDeckIds.add(deck.id);
	}

	return [...cascadeDeckIds];
};

export const getDecks = async (
	db: DrizzleInstance,
	languageId?: string,
): Promise<DeckListItem[]> => {
	const deckRows = await db.query.decks.findMany({
		where: languageId
			? and(eq(decks.languageId, languageId), eq(decks.deleted, false))
			: eq(decks.deleted, false),
	});
	return withDeckStats(db, deckRows);
};

export const getDeckFolders = async (
	db: DrizzleInstance,
	languageId?: string,
	deckRows?: DeckListItem[],
): Promise<DeckFolderListItem[]> => {
	const [resolvedDeckRows, folderRows] = await Promise.all([
		deckRows ? Promise.resolve(deckRows) : getDecks(db, languageId),
		db.query.decksFolders.findMany({
			where: and(isNull(decksFolders.parentId), eq(decksFolders.deleted, false)),
		}),
	]);

	const sortedFolders = sortByName(folderRows);
	return Promise.all(
		sortedFolders.map(async (folder) => {
			const childDecks = sortByName(
				resolvedDeckRows.filter((deck) => deck.folderId === folder.id),
			);
			if (languageId) {
				const matchesLanguage =
					folder.languageId === languageId ||
					(folder.languageId === null && childDecks.length > 0);
				if (!matchesLanguage) {
					return null;
				}
			}
			const stats = await getFolderStats({
				db,
				folder,
				childDecks,
				languageId,
			});

			return {
				...folder,
				...stats,
				childDeckCount: childDecks.length,
				decks: childDecks,
			};
		}),
	).then((rows) => rows.filter((row): row is DeckFolderListItem => Boolean(row)));
};

export const getDeckCollectionItems = async (
	db: DrizzleInstance,
	languageId?: string,
	deckRows?: DeckListItem[],
): Promise<DeckCollectionListItem[]> => {
	const resolvedDeckRows = sortByName(deckRows ?? (await getDecks(db, languageId)));
	const folders = await getDeckFolders(db, languageId, resolvedDeckRows);
	const rootDecks = resolvedDeckRows.filter((deck) => deck.folderId === null);

	return [
		...folders.map(
			(folder) =>
				({
					kind: "folder",
					id: folder.id,
					name: folder.name,
					cardCount: folder.cardCount,
					dueCount: folder.dueCount,
					folder,
				}) satisfies DeckCollectionListItem,
		),
		...rootDecks.map(
			(deck) =>
				({
					kind: "deck",
					id: deck.id,
					name: deck.name,
					cardCount: deck.cardCount,
					dueCount: deck.dueCount,
					deck,
				}) satisfies DeckCollectionListItem,
		),
	];
};

export const getDeletedDecks = async (
	db: DrizzleInstance,
	languageId?: string,
): Promise<DeletedDeckListItem[]> => {
	const snapshot = await getDeletedTrashSnapshot(db, languageId);
	return snapshot.decks;
};

export const getDeletedTrashSnapshot = async (
	db: DrizzleInstance,
	languageId?: string,
): Promise<DeletedTrashSnapshot> => {
	const [folderRows, deckRows] = await Promise.all([
		db.query.decksFolders.findMany({
			where: eq(decksFolders.deleted, true),
			orderBy: [desc(decksFolders.deletedAt), desc(decksFolders.updatedAt)],
		}),
		db.query.decks.findMany({
			where: languageId
				? and(eq(decks.languageId, languageId), eq(decks.deleted, true))
				: eq(decks.deleted, true),
			orderBy: [desc(decks.deletedAt), desc(decks.updatedAt)],
		}),
	]);

	const deletedCardRows =
		deckRows.length > 0
			? await db.query.cards.findMany({
					where: and(
						inArray(
							cards.deckId,
							deckRows.map((deck) => deck.id),
						),
						eq(cards.deleted, true),
					),
				})
			: [];
	const deletedCardCountByDeck = new Map<string, number>();
	for (const deck of deckRows) {
		deletedCardCountByDeck.set(deck.id, 0);
	}
	for (const card of deletedCardRows) {
		deletedCardCountByDeck.set(
			card.deckId,
			(deletedCardCountByDeck.get(card.deckId) ?? 0) + 1,
		);
	}

	const deletedDecks = deckRows.map((deck) => ({
		...deck,
		deletedCardCount: deletedCardCountByDeck.get(deck.id) ?? 0,
	}));

	const deletedFolderIds = new Set(folderRows.map((folder) => folder.id));
	const visibleDeckRows = deletedDecks.filter(
		(deck) => !deck.folderId || !deletedFolderIds.has(deck.folderId),
	);

	const folders = folderRows
		.map((folder) => {
			const childDecks = sortByName(
				deletedDecks.filter((deck) => deck.folderId === folder.id),
			);
			if (languageId) {
				const matchesLanguage =
					folder.languageId === languageId ||
					(folder.languageId === null && childDecks.length > 0);
				if (!matchesLanguage) {
					return null;
				}
			}

			return {
				...folder,
				childDeckCount: childDecks.length,
				deletedCardCount: childDecks.reduce(
					(total, deck) => total + deck.deletedCardCount,
					0,
				),
				decks: childDecks,
			};
		})
		.filter((row): row is DeletedDeckFolderListItem => Boolean(row));

	return {
		folders,
		decks: visibleDeckRows,
	};
};

export const getDeletedDeckFolders = async (
	db: DrizzleInstance,
	languageId?: string,
): Promise<DeletedDeckFolderListItem[]> => {
	const snapshot = await getDeletedTrashSnapshot(db, languageId);
	return snapshot.folders;
};

export const getDeckDetail = async (
	db: DrizzleInstance,
	deckId: string,
	languageId?: string,
): Promise<DeckDetailResult | null> => {
	const deck = await db.query.decks.findFirst({
		where: languageId
			? and(eq(decks.id, deckId), eq(decks.languageId, languageId), eq(decks.deleted, false))
			: and(eq(decks.id, deckId), eq(decks.deleted, false)),
	});

	if (!deck) {
		return null;
	}

	const deckCards = await db.query.cards.findMany({
		where: and(eq(cards.deckId, deckId), eq(cards.deleted, false)),
		with: {
			knowledge: true,
		},
	});
	const [linkedDecks, primaryDeck, dueCount] = await Promise.all([
		deck.primaryDeckId ? Promise.resolve([]) : getLinkedDeckSummaries(db, deck.id),
		deck.primaryDeckId
			? db.query.decks.findFirst({
					where: eq(decks.id, deck.primaryDeckId),
					columns: {
						id: true,
						name: true,
						sourceReviewType: true,
					},
				})
			: Promise.resolve(null),
		getDeckAvailableDueCount({
			db,
			deck,
			languageId: deck.languageId ?? languageId ?? undefined,
		}),
	]);
	const role: DeckRole = deck.primaryDeckId
		? "linked"
		: linkedDecks.length > 0
			? "primary"
			: "normal";

		return {
			...deck,
			cardCount: deckCards.length,
			dueCount,
		lastReviewedAt:
			deckCards
				.map((card) => card.knowledge?.lastReview ?? null)
				.filter((value): value is string => Boolean(value))
				.sort()
				.at(-1) ?? null,
		hasActiveLinkedDecks: linkedDecks.length > 0,
		cards: deckCards,
		role,
		primaryDeck: primaryDeck ?? null,
		linkedDecks,
	};
};

export const createDeck = async (
	db: DrizzleInstance,
	values: typeof decks.$inferInsert,
) => {
	try {
		const result = await db.insert(decks).values(values).returning();
		if (!result[0]) return undefined;
		await markLocalChange(db);
		return {
			...result[0],
			cardCount: 0,
			dueCount: 0,
			lastReviewedAt: null,
			hasActiveLinkedDecks: false,
		} satisfies DeckListItem;
	} catch (e) {
		console.log("Error on creating deck:", e);
	}
};

export const createDeckFolder = async (
	db: DrizzleInstance,
	input: {
		id?: string;
		name: string;
		languageId?: string | null;
	},
) => {
	const name = input.name.trim();
	if (!name) {
		return { status: "invalid_name" as const };
	}

	const result = await db
		.insert(decksFolders)
		.values({
			id: input.id ?? generateId(),
			name,
			languageId: input.languageId ?? null,
			parentId: null,
			deleted: false,
			deletedAt: null,
		})
		.returning();
	await markLocalChange(db);
	await refreshDecksStore(db, input.languageId ?? undefined);

	return {
		status: "created" as const,
		folder: result[0]
			? {
					...result[0],
					childDeckCount: 0,
					cardCount: 0,
					dueCount: 0,
					lastReviewedAt: null,
					decks: [],
				}
			: null,
	};
};

export const deleteDeckFolder = async (
	db: DrizzleInstance,
	input: {
		folderId: string;
		languageId?: string | null;
	},
) => {
	const folder = await db.query.decksFolders.findFirst({
		where: and(
			eq(decksFolders.id, input.folderId),
			isNull(decksFolders.parentId),
			eq(decksFolders.deleted, false),
		),
	});

	if (!folder) {
		return { status: "missing_folder" as const };
	}

	await db.transaction(async (tx) => {
		const transactionDb = tx as DrizzleInstance;

		await transactionDb
			.update(decks)
			.set({
				folderId: null,
			})
			.where(eq(decks.folderId, folder.id));

		await transactionDb.delete(decksFolders).where(eq(decksFolders.id, folder.id));
		const deletedAt = await markLocalChange(transactionDb);
		await upsertPermanentDeletes(transactionDb, [
			createPermanentDeleteRecord({
				entityType: "deckFolder",
				entityId: folder.id,
				deletedAt,
			}),
		]);
	});

	await refreshDecksStore(db, input.languageId ?? undefined);

	return {
		status: "deleted" as const,
	};
};

export const deleteDeckFolderAndChildren = async (
	db: DrizzleInstance,
	input: {
		folderId: string;
		languageId?: string | null;
	},
) => {
	const folder = await db.query.decksFolders.findFirst({
		where: and(
			eq(decksFolders.id, input.folderId),
			isNull(decksFolders.parentId),
			eq(decksFolders.deleted, false),
		),
	});

	if (!folder) {
		return { status: "missing_folder" as const };
	}

	const deckIds = await getFolderCascadeDeckIds(db, folder.id);
	const deletedAt = new Date().toISOString();

	if (deckIds.length > 0) {
		await db
			.update(decks)
			.set({
				deleted: true,
				deletedAt,
			})
			.where(inArray(decks.id, deckIds));

		await db
			.update(cards)
			.set({
				deleted: true,
				deletedAt,
			})
			.where(and(inArray(cards.deckId, deckIds), eq(cards.deleted, false)));
	}

	await db
		.update(decksFolders)
		.set({
			deleted: true,
			deletedAt,
		})
		.where(eq(decksFolders.id, folder.id));
	await markLocalChange(db, deletedAt);
	await refreshDecksStore(db, input.languageId ?? undefined);

	return {
		status: "deleted" as const,
		deletedDeckCount: deckIds.length,
	};
};

export const setDeckFolder = async (
	db: DrizzleInstance,
	input: {
		deckId: string;
		folderId: string | null;
	},
) => {
	const deck = await db.query.decks.findFirst({
		where: eq(decks.id, input.deckId),
	});

	if (!deck || deck.deleted) {
		return { status: "missing_deck" as const };
	}

	if (deck.primaryDeckId) {
		return {
			status: "managed_by_primary" as const,
			primaryDeckId: deck.primaryDeckId,
		};
	}

	if (input.folderId) {
		const folder = await db.query.decksFolders.findFirst({
			where: and(
				eq(decksFolders.id, input.folderId),
				isNull(decksFolders.parentId),
				eq(decksFolders.deleted, false),
			),
		});

		if (!folder) {
			return { status: "missing_folder" as const };
		}
	}

	const deckIds = await getDeckCascadeIds(db, deck.id);
	await db
		.update(decks)
		.set({
			folderId: input.folderId,
		})
		.where(inArray(decks.id, deckIds));
	await markLocalChange(db);
	await refreshDecksStore(db, deck.languageId ?? undefined);

	return {
		status: "updated" as const,
		folderId: input.folderId,
	};
};

export const setDeckSourceReviewType = async (
	db: DrizzleInstance,
	input: {
		deckId: string;
		sourceReviewType: string;
	},
) => {
	const deck = await db.query.decks.findFirst({
		where: eq(decks.id, input.deckId),
	});

	if (!deck) {
		return { status: "missing_deck" as const };
	}

	if (deck.primaryDeckId) {
		return {
			status: "managed_by_primary" as const,
			primaryDeckId: deck.primaryDeckId,
		};
	}

	await db
		.update(decks)
		.set({
			sourceReviewType: input.sourceReviewType,
		})
		.where(eq(decks.id, deck.id));
	await syncPrimaryDeckLinkedDecks(db, deck.id);
	await markLocalChange(db);
	await refreshDecksStore(db, deck.languageId ?? undefined);

	return {
		status: "updated" as const,
		sourceReviewType: input.sourceReviewType,
	};
};

export const setDeckReviewLimits = async (
	db: DrizzleInstance,
	input: {
		deckId: string;
		newLimitEnabled: boolean;
		newLimit: number | null;
		totalLimitEnabled: boolean;
		totalLimit: number | null;
	},
) => {
	const deck = await db.query.decks.findFirst({
		where: eq(decks.id, input.deckId),
	});

	if (!deck) {
		return { status: "missing_deck" as const };
	}

	if (deck.primaryDeckId) {
		return {
			status: "managed_by_primary" as const,
			primaryDeckId: deck.primaryDeckId,
		};
	}

	const normalized = normalizeReviewLimitSettings({
		newLimitEnabled: input.newLimitEnabled,
		newLimit: input.newLimit,
		totalLimitEnabled: input.totalLimitEnabled,
		totalLimit: input.totalLimit,
	});

	await db
		.update(decks)
		.set({
			dailyNewLimitEnabled: normalized.newLimitEnabled,
			dailyNewLimit: normalized.newLimit,
			dailyReviewLimitEnabled: normalized.totalLimitEnabled,
			dailyReviewLimit: normalized.totalLimit,
		})
		.where(eq(decks.id, deck.id));
	await markLocalChange(db);
	await refreshDecksStore(db, deck.languageId ?? undefined);

	return {
		status: "updated" as const,
		limits: normalized,
	};
};

export const setDeckNewCardsPaused = async (
	db: DrizzleInstance,
	input: {
		deckId: string;
		paused: boolean;
	},
) => {
	const deck = await db.query.decks.findFirst({
		where: eq(decks.id, input.deckId),
	});

	if (!deck) {
		return { status: "missing_deck" as const };
	}

	if (deck.primaryDeckId) {
		return {
			status: "managed_by_primary" as const,
			primaryDeckId: deck.primaryDeckId,
		};
	}

	await db
		.update(decks)
		.set({
			newCardsPaused: input.paused,
		})
		.where(eq(decks.id, deck.id));
	await markLocalChange(db);
	await refreshDecksStore(db, deck.languageId ?? undefined);

	return {
		status: "updated" as const,
		paused: input.paused,
	};
};

export const setFolderNewCardsPaused = async (
	db: DrizzleInstance,
	input: {
		folderId: string;
		languageId?: string | null;
		paused: boolean;
	},
) => {
	const folder = await db.query.decksFolders.findFirst({
		where: and(
			eq(decksFolders.id, input.folderId),
			isNull(decksFolders.parentId),
			eq(decksFolders.deleted, false),
		),
	});

	if (!folder) {
		return { status: "missing_folder" as const };
	}

	await db
		.update(decksFolders)
		.set({
			newCardsPaused: input.paused,
		})
		.where(eq(decksFolders.id, folder.id));
	await markLocalChange(db);
	await refreshDecksStore(db, input.languageId ?? undefined);

	return {
		status: "updated" as const,
		paused: input.paused,
	};
};

export const setFolderReviewLimits = async (
	db: DrizzleInstance,
	input: {
		folderId: string;
		languageId?: string | null;
		newLimitEnabled: boolean;
		newLimit: number | null;
		totalLimitEnabled: boolean;
		totalLimit: number | null;
	},
) => {
	const folder = await db.query.decksFolders.findFirst({
		where: and(
			eq(decksFolders.id, input.folderId),
			isNull(decksFolders.parentId),
			eq(decksFolders.deleted, false),
		),
	});

	if (!folder) {
		return { status: "missing_folder" as const };
	}

	const normalized = normalizeReviewLimitSettings({
		newLimitEnabled: input.newLimitEnabled,
		newLimit: input.newLimit,
		totalLimitEnabled: input.totalLimitEnabled,
		totalLimit: input.totalLimit,
	});

	await db
		.update(decksFolders)
		.set({
			dailyNewLimitEnabled: normalized.newLimitEnabled,
			dailyNewLimit: normalized.newLimit,
			dailyReviewLimitEnabled: normalized.totalLimitEnabled,
			dailyReviewLimit: normalized.totalLimit,
		})
		.where(eq(decksFolders.id, folder.id));
	await markLocalChange(db);
	await refreshDecksStore(db, input.languageId ?? undefined);

	return {
		status: "updated" as const,
		limits: normalized,
	};
};

export const createLinkedDeck = async (
	db: DrizzleInstance,
	input: {
		primaryDeckId: string;
		sourceReviewType: string;
		targetReviewType: string;
		name?: string;
	},
) => {
	const primaryDeck = await db.query.decks.findFirst({
		where: and(eq(decks.id, input.primaryDeckId), eq(decks.deleted, false)),
	});

	if (!primaryDeck) {
		return { status: "missing_deck" as const };
	}

	if (primaryDeck.primaryDeckId) {
		return {
			status: "managed_by_primary" as const,
			primaryDeckId: primaryDeck.primaryDeckId,
		};
	}

	if (input.sourceReviewType === input.targetReviewType) {
		return { status: "same_review_type" as const };
	}

	if (input.targetReviewType === "Pitch") {
		const sourceCards = await db.query.cards.findMany({
			where: eq(cards.deckId, primaryDeck.id),
			with: {
				knowledge: true,
			},
		});
		const supportsTargetReviewType = createReviewTypeSupportResolver(db);
		let hasPitchEligibleSource = false;

		for (const sourceCard of sourceCards) {
			const sourceKnowledge = sourceCard.knowledge;
			if (
				!sourceKnowledge ||
				sourceCard.deleted ||
				sourceKnowledge.deleted ||
				sourceKnowledge.reviewType !== input.sourceReviewType
			) {
				continue;
			}

			if (
				await supportsTargetReviewType({
					reviewType: input.targetReviewType,
					sourceKnowledge,
				})
			) {
				hasPitchEligibleSource = true;
				break;
			}
		}

		if (!hasPitchEligibleSource) {
			return { status: "pitch_not_supported" as const };
		}
	}

	const existingLinks = await db.query.deckLinks.findMany({
		where: eq(deckLinks.primaryDeckId, primaryDeck.id),
	});
	const existingLink = existingLinks.find(
		(row) => row.targetReviewType === input.targetReviewType,
	);
	if (existingLink) {
		const existingLinkedDeck = await db.query.decks.findFirst({
			where: eq(decks.id, existingLink.linkedDeckId),
		});

		if (existingLinkedDeck?.deleted) {
			await db
				.update(decks)
				.set({
					deleted: false,
					deletedAt: null,
				})
				.where(eq(decks.id, existingLinkedDeck.id));
			await db
				.update(cards)
				.set({
					deleted: false,
					deletedAt: null,
				})
				.where(eq(cards.deckId, existingLinkedDeck.id));
			await db
				.update(decks)
				.set({
					sourceReviewType: input.sourceReviewType,
				})
				.where(eq(decks.id, primaryDeck.id));
			await syncPrimaryDeckLinkedDecks(db, primaryDeck.id);
			await markLocalChange(db);
			await refreshDecksStore(db, primaryDeck.languageId ?? undefined);

			const linkedDeck = await getDeckDetail(
				db,
				existingLinkedDeck.id,
				primaryDeck.languageId ?? undefined,
			);

			return {
				status: "restored" as const,
				linkedDeck,
			};
		}

		const linkedDeck = existingLinkedDeck
			? await getDeckDetail(
					db,
					existingLinkedDeck.id,
					primaryDeck.languageId ?? undefined,
				)
			: null;

		return {
			status: "exists" as const,
			linkedDeck,
		};
	}

	const linkedDeckId = generateId();
	await db.insert(decks).values({
		id: linkedDeckId,
		name: input.name ?? resolveLinkedDeckName(primaryDeck.name, input.targetReviewType),
		languageId: primaryDeck.languageId,
		visibility: primaryDeck.visibility,
		isStarred: false,
		folderId: primaryDeck.folderId,
		primaryDeckId: primaryDeck.id,
	});
	await db
		.update(decks)
		.set({
			sourceReviewType: input.sourceReviewType,
		})
		.where(eq(decks.id, primaryDeck.id));
	await db.insert(deckLinks).values({
		id: generateId(),
		primaryDeckId: primaryDeck.id,
		linkedDeckId,
		targetReviewType: input.targetReviewType,
	});
	await syncPrimaryDeckLinkedDecks(db, primaryDeck.id);
	await markLocalChange(db);
	await refreshDecksStore(db, primaryDeck.languageId ?? undefined);

	const linkedDeck = await getDeckDetail(db, linkedDeckId, primaryDeck.languageId ?? undefined);

	return {
		status: "created" as const,
		linkedDeck,
	};
};

export const addEntryToDeck = async (
	db: DrizzleInstance,
	values: {
		deckId: string;
		entryId: string;
		config?: KnowledgeDefinitionConfig | null;
		reviewType?: string;
	},
) => {
	let localMutationCommitted = false;
	const deck = await db.query.decks.findFirst({
		where: and(eq(decks.id, values.deckId), eq(decks.deleted, false)),
	});
	if (!deck) {
		return { status: "missing_deck" as const };
	}
	if (deck.primaryDeckId) {
		return {
			status: "managed_by_primary" as const,
			primaryDeckId: deck.primaryDeckId,
		};
	}

	const entry = await getEntryDetail(db, values.entryId);
	if (!entry) {
		return { status: "missing_entry" as const };
	}
	if (deck.languageId && deck.languageId !== entry.languageId) {
		return { status: "language_mismatch" as const };
	}

	const resolvedReviewType = values.reviewType ?? "Front-Back";
	const knowledgePayload = buildKnowledgePayload(entry, values.config);
	if (
		!supportsReviewTypeForEntry({
			reviewType: resolvedReviewType,
			entry,
			front: knowledgePayload.front,
		})
	) {
		if (resolvedReviewType === "Stroke") {
			return { status: "stroke_not_supported" as const };
		}

		if (resolvedReviewType === "Pitch") {
			return { status: "pitch_not_supported" as const };
		}
	}
	const siblingKnowledge = await db.query.knowledge.findMany({
		where: and(
			eq(knowledge.entryId, values.entryId),
			eq(knowledge.reviewType, resolvedReviewType),
		),
	});

	const matchingKnowledge = siblingKnowledge.find(
		(item) =>
			(item.configSignature ?? DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE) ===
			knowledgePayload.configSignature,
	);

	let knowledgeId = matchingKnowledge?.id;
	let knowledgeLabel = matchingKnowledge?.configLabel ?? null;
	if (
		matchingKnowledge &&
		(!matchingKnowledge.configSignature ||
			!matchingKnowledge.definitionConfig ||
			!matchingKnowledge.configLabel)
	) {
		const nextLabel =
			matchingKnowledge.configLabel ??
			getNextKnowledgeConfigLabel(siblingKnowledge.map((item) => item.configLabel));
		await db
			.update(knowledge)
			.set({
				configSignature: knowledgePayload.configSignature,
				definitionConfig: knowledgePayload.definitionConfig,
				configLabel: nextLabel,
			})
			.where(eq(knowledge.id, matchingKnowledge.id));
		knowledgeLabel = nextLabel;
		localMutationCommitted = true;
	}

	if (!knowledgeId) {
		const configLabel = getNextKnowledgeConfigLabel(
			siblingKnowledge.map((item) => item.configLabel),
		);
		const insertedKnowledge = await db
			.insert(knowledge)
			.values({
				id: generateId(),
				entryId: values.entryId,
				front: knowledgePayload.front,
				definitions: knowledgePayload.definitions,
				sourceDefinitions: knowledgePayload.sourceDefinitions,
				pronunciation: knowledgePayload.pronunciation,
				configSignature: knowledgePayload.configSignature,
				definitionConfig: knowledgePayload.definitionConfig,
				configLabel,
				reviewType: resolvedReviewType,
			})
			.returning();

		knowledgeId = insertedKnowledge[0]?.id;
		knowledgeLabel = insertedKnowledge[0]?.configLabel ?? configLabel;
		localMutationCommitted = true;
	}

	if (!knowledgeId) {
		return { status: "missing_entry" as const };
	}

	const existingCard = await db.query.cards.findFirst({
		where: and(
			eq(cards.deckId, values.deckId),
			eq(cards.knowledgeId, knowledgeId),
			eq(cards.deleted, false),
		),
	});

	if (existingCard) {
		if (deck.sourceReviewType === resolvedReviewType) {
			await syncPrimaryDeckLinkedDecks(db, deck.id);
			localMutationCommitted = true;
		}
		if (localMutationCommitted) {
			await markLocalChange(db);
		}
		return {
			status: "exists" as const,
			knowledgeId,
			cardId: existingCard.id,
			configLabel: knowledgeLabel,
		};
	}

	const insertedCard = await db
		.insert(cards)
		.values({
			id: generateId(),
			deckId: values.deckId,
			knowledgeId,
		})
		.returning();
	localMutationCommitted = true;

	if (deck.sourceReviewType === resolvedReviewType) {
		await syncPrimaryDeckLinkedDecks(db, deck.id);
	}

	if (localMutationCommitted) {
		await markLocalChange(db);
	}

	return {
		status: "added" as const,
		knowledgeId,
		cardId: insertedCard[0]?.id ?? null,
		configLabel: knowledgeLabel,
	};
};

export const addPremadeItemToDeck = async (
	db: DrizzleInstance,
	values: {
		deckId: string;
		item: PremadeDeckItem;
		reviewType?: string;
	},
) => {
	let localMutationCommitted = false;
	const deck = await db.query.decks.findFirst({
		where: and(eq(decks.id, values.deckId), eq(decks.deleted, false)),
	});
	if (!deck) {
		return { status: "missing_deck" as const };
	}
	if (deck.primaryDeckId) {
		return {
			status: "managed_by_primary" as const,
			primaryDeckId: deck.primaryDeckId,
		};
	}

	const resolvedReviewType = values.reviewType ?? "Front-Back";
	const linkedEntryId = values.item.dictionaryLink?.entryId ?? null;
	const entry = linkedEntryId ? await getEntryDetail(db, linkedEntryId) : null;
	if (entry && deck.languageId && deck.languageId !== entry.languageId) {
		return { status: "language_mismatch" as const };
	}

	const knowledgePayload = buildPremadeKnowledgePayload({
		item: values.item,
		entry,
	});
	if (
		!supportsReviewTypeForEntry({
			reviewType: resolvedReviewType,
			entry,
			front: knowledgePayload.front,
		})
	) {
		if (resolvedReviewType === "Stroke") {
			return { status: "stroke_not_supported" as const };
		}

		if (resolvedReviewType === "Pitch") {
			return { status: "pitch_not_supported" as const };
		}
	}

	let matchingKnowledge =
		knowledgePayload.entryId !== null
			? (
					await db.query.knowledge.findMany({
						where: and(
							eq(knowledge.entryId, knowledgePayload.entryId),
							eq(knowledge.reviewType, resolvedReviewType),
						),
					})
				).find(
					(item) =>
						(item.configSignature ?? DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE) ===
						knowledgePayload.configSignature,
				) ?? null
			: await db.query.knowledge.findFirst({
					where: and(
						isNull(knowledge.entryId),
						eq(knowledge.reviewType, resolvedReviewType),
						eq(knowledge.front, knowledgePayload.front),
						eq(knowledge.definitions, knowledgePayload.definitions),
						knowledgePayload.sourceDefinitions
							? eq(knowledge.sourceDefinitions, knowledgePayload.sourceDefinitions)
							: isNull(knowledge.sourceDefinitions),
						knowledgePayload.pronunciation
							? eq(knowledge.pronunciation, knowledgePayload.pronunciation)
							: isNull(knowledge.pronunciation),
					),
				});

	let knowledgeId = matchingKnowledge?.id ?? null;
	let knowledgeLabel = matchingKnowledge?.configLabel ?? null;

	if (matchingKnowledge) {
		const nextUpdates: Partial<typeof knowledge.$inferInsert> = {};
		if (knowledgePayload.entryId && !matchingKnowledge.entryId) {
			nextUpdates.entryId = knowledgePayload.entryId;
		}
		if (knowledgePayload.sourceDefinitions && !matchingKnowledge.sourceDefinitions) {
			nextUpdates.sourceDefinitions = knowledgePayload.sourceDefinitions;
		}
		if (Object.keys(nextUpdates).length > 0) {
			await db.update(knowledge).set(nextUpdates).where(eq(knowledge.id, matchingKnowledge.id));
			localMutationCommitted = true;
			matchingKnowledge = {
				...matchingKnowledge,
				...nextUpdates,
			};
		}
	}

	if (!knowledgeId) {
		const siblingLabels =
			knowledgePayload.entryId !== null
				? (
						await db.query.knowledge.findMany({
							where: and(
								eq(knowledge.entryId, knowledgePayload.entryId),
								eq(knowledge.reviewType, resolvedReviewType),
							),
						})
					).map((item) => item.configLabel)
				: [];
		const configLabel = getNextKnowledgeConfigLabel(siblingLabels);
		const insertedKnowledge = await db
			.insert(knowledge)
			.values({
				id: generateId(),
				entryId: knowledgePayload.entryId,
				front: knowledgePayload.front,
				definitions: knowledgePayload.definitions,
				sourceDefinitions: knowledgePayload.sourceDefinitions,
				pronunciation: knowledgePayload.pronunciation,
				configSignature: knowledgePayload.configSignature,
				definitionConfig: knowledgePayload.definitionConfig,
				configLabel,
				reviewType: resolvedReviewType,
			})
			.returning();

		knowledgeId = insertedKnowledge[0]?.id ?? null;
		knowledgeLabel = insertedKnowledge[0]?.configLabel ?? configLabel;
		localMutationCommitted = true;
	}

	if (!knowledgeId) {
		return { status: "missing_entry" as const };
	}

	const existingCard = await db.query.cards.findFirst({
		where: and(
			eq(cards.deckId, values.deckId),
			eq(cards.knowledgeId, knowledgeId),
			eq(cards.deleted, false),
		),
	});

	if (existingCard) {
		if (deck.sourceReviewType === resolvedReviewType) {
			await syncPrimaryDeckLinkedDecks(db, deck.id);
			localMutationCommitted = true;
		}
		if (localMutationCommitted) {
			await markLocalChange(db);
		}
		return {
			status: "exists" as const,
			knowledgeId,
			cardId: existingCard.id,
			configLabel: knowledgeLabel,
		};
	}

	const insertedCard = await db
		.insert(cards)
		.values({
			id: generateId(),
			deckId: values.deckId,
			knowledgeId,
		})
		.returning();
	localMutationCommitted = true;

	if (deck.sourceReviewType === resolvedReviewType) {
		await syncPrimaryDeckLinkedDecks(db, deck.id);
	}

	if (localMutationCommitted) {
		await markLocalChange(db);
	}

	return {
		status: "added" as const,
		knowledgeId,
		cardId: insertedCard[0]?.id ?? null,
		configLabel: knowledgeLabel,
	};
};

export const trashDeck = async (db: DrizzleInstance, deckId: string) => {
	const deck = await db.query.decks.findFirst({
		where: eq(decks.id, deckId),
	});

	if (!deck) {
		return { status: "missing_deck" as const };
	}

	if (deck.deleted) {
		return { status: "already_deleted" as const };
	}

	const deletedAt = new Date().toISOString();
	const deckIds = deck.primaryDeckId ? [deck.id] : await getDeckCascadeIds(db, deck.id);

	await db
		.update(decks)
		.set({
			deleted: true,
			deletedAt,
		})
		.where(inArray(decks.id, deckIds));

	await db
		.update(cards)
		.set({
			deleted: true,
			deletedAt,
		})
		.where(and(inArray(cards.deckId, deckIds), eq(cards.deleted, false)));

	await markLocalChange(db, deletedAt);
	await refreshDecksStore(db, deck.languageId ?? undefined);

	return {
		status: "trashed" as const,
		deletedAt,
	};
};

export const restoreDeck = async (db: DrizzleInstance, deckId: string) => {
	const deck = await db.query.decks.findFirst({
		where: eq(decks.id, deckId),
	});

	if (!deck) {
		return { status: "missing_deck" as const };
	}

	if (!deck.deleted) {
		return { status: "not_deleted" as const };
	}

	const restoredAt = new Date().toISOString();
	const deckIds = deck.primaryDeckId ? [deck.id] : await getDeckCascadeIds(db, deck.id);

	await db
		.update(decks)
		.set({
			deleted: false,
			deletedAt: null,
		})
		.where(inArray(decks.id, deckIds));

	await db
		.update(cards)
		.set({
			deleted: false,
			deletedAt: null,
		})
		.where(and(inArray(cards.deckId, deckIds), eq(cards.deleted, true)));
	if (deck.primaryDeckId) {
		await syncPrimaryDeckLinkedDecks(db, deck.primaryDeckId);
	} else {
		await syncPrimaryDeckLinkedDecks(db, deck.id);
	}

	await markLocalChange(db, restoredAt);
	await refreshDecksStore(db, deck.languageId ?? undefined);

	return {
		status: "restored" as const,
		restoredAt,
	};
};

export const restoreDeckFolder = async (
	db: DrizzleInstance,
	folderId: string,
) => {
	const folder = await db.query.decksFolders.findFirst({
		where: eq(decksFolders.id, folderId),
	});

	if (!folder) {
		return { status: "missing_folder" as const };
	}

	if (!folder.deleted) {
		return { status: "not_deleted" as const };
	}

	const restoredAt = new Date().toISOString();
	const deckIds = await getFolderCascadeDeckIds(db, folder.id, true);
	const folderDecks = await db.query.decks.findMany({
		where: eq(decks.folderId, folder.id),
	});
	const primaryDeckIds = [...new Set(folderDecks.map((deck) => deck.primaryDeckId ?? deck.id))];
	const refreshLanguageId =
		folder.languageId ?? folderDecks.find((deck) => Boolean(deck.languageId))?.languageId ?? undefined;

	await db
		.update(decksFolders)
		.set({
			deleted: false,
			deletedAt: null,
		})
		.where(eq(decksFolders.id, folder.id));

	if (deckIds.length > 0) {
		await db
			.update(decks)
			.set({
				deleted: false,
				deletedAt: null,
			})
			.where(inArray(decks.id, deckIds));

		await db
			.update(cards)
			.set({
				deleted: false,
				deletedAt: null,
			})
			.where(and(inArray(cards.deckId, deckIds), eq(cards.deleted, true)));
	}

	for (const primaryDeckId of primaryDeckIds) {
		await syncPrimaryDeckLinkedDecks(db, primaryDeckId);
	}

	await markLocalChange(db, restoredAt);
	await refreshDecksStore(db, refreshLanguageId);

	return {
		status: "restored" as const,
		restoredAt,
		restoredDeckCount: deckIds.length,
	};
};

export const emptyTrash = async (
	db: DrizzleInstance,
	languageId?: string,
) => {
	const [deletedDeckRows, deletedFolderRows] = await Promise.all([
		db.query.decks.findMany({
			where: languageId
				? and(eq(decks.languageId, languageId), eq(decks.deleted, true))
				: eq(decks.deleted, true),
		}),
		db.query.decksFolders.findMany({
			where: eq(decksFolders.deleted, true),
		}),
	]);
	const scopedDeletedFolderRows = deletedFolderRows.filter(
		(folder) =>
			!languageId ||
			folder.languageId === languageId ||
			(folder.languageId === null &&
				deletedDeckRows.some((deck) => deck.folderId === folder.id)),
	);

	if (deletedDeckRows.length === 0 && scopedDeletedFolderRows.length === 0) {
		return {
			status: "empty" as const,
			deletedFolderCount: 0,
			deletedDeckCount: 0,
		};
	}

	const deckIds = deletedDeckRows.map((deck) => deck.id);
	const folderIds = scopedDeletedFolderRows.map((folder) => folder.id);
	const deckLinkRows =
		deckIds.length > 0
			? await db.query.deckLinks.findMany({
					where: or(
						inArray(deckLinks.primaryDeckId, deckIds),
						inArray(deckLinks.linkedDeckId, deckIds),
					),
				})
			: [];
	const deckLinkIds = deckLinkRows.map((row) => row.id);
	const [knowledgeLinkRows, cardLinkRows] =
		deckLinkIds.length > 0
			? await Promise.all([
					db.query.knowledgeLinks.findMany({
						where: inArray(knowledgeLinks.deckLinkId, deckLinkIds),
					}),
					db.query.cardLinks.findMany({
						where: inArray(cardLinks.deckLinkId, deckLinkIds),
					}),
				])
			: [[], []];
	const knowledgeLinkIds = knowledgeLinkRows.map((row) => row.id);
	const cardLinkIds = cardLinkRows.map((row) => row.id);
	const cardRows =
		deckIds.length > 0
			? await db.query.cards.findMany({
					where: inArray(cards.deckId, deckIds),
				})
			: [];
	const cardIds = cardRows.map((card) => card.id);
	const knowledgeIds = [...new Set(cardRows.map((card) => card.knowledgeId))];
	const remainingCards = knowledgeIds.length > 0
		? await db.query.cards.findMany({
				where: inArray(cards.knowledgeId, knowledgeIds),
				columns: {
					id: true,
					knowledgeId: true,
				},
			})
		: [];
	const referencedKnowledgeIds = new Set(
		remainingCards
			.filter((card) => !cardIds.includes(card.id))
			.map((card) => card.knowledgeId),
	);
	const orphanKnowledgeIds = knowledgeIds.filter(
		(knowledgeId) => !referencedKnowledgeIds.has(knowledgeId),
	);

	await db.transaction(async (tx) => {
		const transactionDb = tx as DrizzleInstance;

		if (deckLinkIds.length > 0) {
			await transactionDb
				.delete(cardLinks)
				.where(inArray(cardLinks.deckLinkId, deckLinkIds));
			await transactionDb
				.delete(knowledgeLinks)
				.where(inArray(knowledgeLinks.deckLinkId, deckLinkIds));
			await transactionDb.delete(deckLinks).where(inArray(deckLinks.id, deckLinkIds));
		}

		if (cardIds.length > 0) {
			await transactionDb.delete(cards).where(inArray(cards.id, cardIds));
		}

		if (deckIds.length > 0) {
			await transactionDb.delete(decks).where(inArray(decks.id, deckIds));
		}

		if (folderIds.length > 0) {
			await transactionDb
				.delete(decksFolders)
				.where(inArray(decksFolders.id, folderIds));
		}

		if (orphanKnowledgeIds.length > 0) {
			await transactionDb
				.delete(knowledge)
				.where(inArray(knowledge.id, orphanKnowledgeIds));
		}

		const permanentlyDeletedAt = await markLocalChange(transactionDb);
		await upsertPermanentDeletes(transactionDb, [
			...folderIds.map((folderId) =>
				createPermanentDeleteRecord({
					entityType: "deckFolder",
					entityId: folderId,
					deletedAt: permanentlyDeletedAt,
				}),
			),
			...deckIds.map((deckId) =>
				createPermanentDeleteRecord({
					entityType: "deck",
					entityId: deckId,
					deletedAt: permanentlyDeletedAt,
				}),
			),
			...deckLinkIds.map((deckLinkId) =>
				createPermanentDeleteRecord({
					entityType: "deckLink",
					entityId: deckLinkId,
					deletedAt: permanentlyDeletedAt,
				}),
			),
			...knowledgeLinkIds.map((knowledgeLinkId) =>
				createPermanentDeleteRecord({
					entityType: "knowledgeLink",
					entityId: knowledgeLinkId,
					deletedAt: permanentlyDeletedAt,
				}),
			),
			...cardLinkIds.map((cardLinkId) =>
				createPermanentDeleteRecord({
					entityType: "cardLink",
					entityId: cardLinkId,
					deletedAt: permanentlyDeletedAt,
				}),
			),
			...cardIds.map((cardId) =>
				createPermanentDeleteRecord({
					entityType: "card",
					entityId: cardId,
					deletedAt: permanentlyDeletedAt,
				}),
			),
			...orphanKnowledgeIds.map((knowledgeId) =>
				createPermanentDeleteRecord({
					entityType: "knowledge",
					entityId: knowledgeId,
					deletedAt: permanentlyDeletedAt,
				}),
			),
		]);
	});

	await refreshDecksStore(db, languageId);

	return {
		status: "emptied" as const,
		deletedFolderCount: folderIds.length,
		deletedDeckCount: deckIds.length,
	};
};

export type DecksResult = Awaited<ReturnType<typeof getDecks>>;
export type DeckResult = DecksResult[number];
export type DeckCollectionResult = Awaited<ReturnType<typeof getDeckCollectionItems>>;
export type DeckCollectionResultItem = DeckCollectionResult[number];

let decksRefreshRequestId = 0;

const normalizeDeckStoreLanguageId = (languageId?: string | null) => languageId ?? null;

const bumpDecksRevision = () => {
	decks$.revision.set(decks$.revision.peek() + 1);
};

export const refreshDecksStore = async (
	db: DrizzleInstance,
	languageId?: string,
) => {
	const requestId = ++decksRefreshRequestId;
	const normalizedLanguageId = normalizeDeckStoreLanguageId(languageId);
	decks$.isRefreshing.set(true);
	decks$.refreshError.set(null);

	try {
		const nextDecks = await getDecks(db, languageId);
		const nextCollections = await getDeckCollectionItems(db, languageId, nextDecks);
		if (requestId === decksRefreshRequestId) {
			decks$.replaceAll({
				decks: nextDecks,
				collections: nextCollections,
				languageId: normalizedLanguageId,
			});
		}
		return nextDecks;
	} catch (error) {
		if (requestId === decksRefreshRequestId) {
			decks$.refreshError.set("Unable to load decks.");
		}
		throw error;
	} finally {
		if (requestId === decksRefreshRequestId) {
			decks$.isRefreshing.set(false);
		}
	}
};

const updateDeckReviewCounts = ({
	previousDue,
	nextDue,
	reviewedAt,
	affectedDeckIds,
}: {
	previousDue: boolean;
	nextDue: boolean;
	reviewedAt: string;
	affectedDeckIds: string[];
}) => {
	if (affectedDeckIds.length === 0 || previousDue === nextDue) {
		if (affectedDeckIds.length === 0) return;
	}

	const affectedDeckIdSet = new Set(affectedDeckIds);
	const delta = previousDue === nextDue ? 0 : previousDue ? -1 : 1;

	decks$.decks.set(
		decks$.decks.get().map((deck) => {
			if (!affectedDeckIdSet.has(deck.id)) {
				return deck;
			}

			return {
				...deck,
				dueCount: Math.max(0, deck.dueCount + delta),
				lastReviewedAt:
					!deck.lastReviewedAt || reviewedAt > deck.lastReviewedAt
						? reviewedAt
						: deck.lastReviewedAt,
			};
		}),
	);
	bumpDecksRevision();
};

interface DeckStore {
	revision: number;
	decks: DecksResult;
	collections: DeckCollectionResult;
	hasLoadedSnapshot: boolean;
	snapshotLanguageId: string | null;
	isRefreshing: boolean;
	refreshError: string | null;
	addDeck: (newDeck: DeckResult) => void;
	replaceAll: (snapshot: {
		decks: DecksResult;
		collections: DeckCollectionResult;
		languageId: string | null;
	}) => void;
	invalidate: () => void;
	applyKnowledgeReview: (input: {
		previousDue: boolean;
		nextDue: boolean;
		reviewedAt: string;
		affectedDeckIds: string[];
	}) => void;
}

export const decks$ = observable<DeckStore>({
	revision: 0,
	decks: [],
	collections: [],
	hasLoadedSnapshot: false,
	snapshotLanguageId: null,
	isRefreshing: false,
	refreshError: null,
	addDeck: (newDeck) => {
		const newDeckLanguageId = normalizeDeckStoreLanguageId(newDeck.languageId);
		const hasLoadedSnapshot = decks$.hasLoadedSnapshot.peek();
		const snapshotLanguageId = decks$.snapshotLanguageId.peek();
		if (hasLoadedSnapshot && snapshotLanguageId !== newDeckLanguageId) {
			return;
		}

		decks$.decks.push(newDeck);
		decks$.collections.push({
			kind: "deck",
			id: newDeck.id,
			name: newDeck.name,
			cardCount: newDeck.cardCount,
			dueCount: newDeck.dueCount,
			deck: newDeck,
		});
		decks$.hasLoadedSnapshot.set(true);
		decks$.snapshotLanguageId.set(newDeckLanguageId);
		decks$.refreshError.set(null);
		bumpDecksRevision();
	},
	replaceAll: (snapshot) => {
		decks$.decks.set(snapshot.decks);
		decks$.collections.set(snapshot.collections);
		decks$.hasLoadedSnapshot.set(true);
		decks$.snapshotLanguageId.set(snapshot.languageId);
		decks$.refreshError.set(null);
		bumpDecksRevision();
	},
	invalidate: () => bumpDecksRevision(),
	applyKnowledgeReview: (input) => updateDeckReviewCounts(input),
});
