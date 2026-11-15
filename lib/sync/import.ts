import { eq } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import {
	appSettings,
	cardLinks,
	cards,
	deckLinks,
	decks,
	decksFolders,
	knowledge,
	knowledgeLinks,
	reviewLog,
	reviewUndo,
} from "@/lib/database/schema";
import {
	applyPermanentDeletes,
	type PermanentDeleteRecord,
} from "@/lib/sync/permanentDeletes";

const IMPORT_CHUNK_SIZE = 100;

const yieldToUi = () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});

const chunkArray = <T,>(items: T[], size: number) => {
	const chunks: T[][] = [];
	for (let index = 0; index < items.length; index += size) {
		chunks.push(items.slice(index, index + size));
	}
	return chunks;
};

type SyncDeckFolderRecord = {
	id: string;
	name: string;
	languageId: string | null;
	parentId: string | null;
	newCardsPaused?: boolean;
	createdAt: string | null;
	updatedAt: string | null;
	deletedAt?: string | null;
};

type SyncDeckRecord = {
	id: string;
	name: string;
	visibility: string;
	isStarred: boolean;
	folderId: string | null;
	languageId: string | null;
	sourceReviewType: string | null;
	primaryDeckId: string | null;
	newCardsPaused?: boolean;
	createdAt: string | null;
	updatedAt: string | null;
	deletedAt?: string | null;
};

type SyncDeckLinkRecord = {
	id: string;
	primaryDeckId: string;
	linkedDeckId: string;
	targetReviewType: string;
	createdAt: string | null;
	updatedAt: string | null;
};

type SyncAppSettingRecord = {
	key: string;
	value: string | null;
	updatedAt: string | null;
};

type SyncPermanentDeleteRecord = {
	id: string;
	entityType: PermanentDeleteRecord["entityType"];
	entityId: string;
	deletedAt: string;
};

type SyncKnowledgeRecord = {
	id: string;
	front: string;
	definitions: string;
	sourceDefinitions?: string | null;
	pronunciation: string | null;
	wordId: string | null;
	entryId: string | null;
	focus: string | null;
	showFocus: boolean;
	focusAllowsDuplicates: boolean;
	note: string | null;
	tags: string | null;
	primaryPitchAccentDictionaryId?: string | null;
	primaryPitchAccentReading?: string | null;
	primaryPitchAccentAccentNumber?: number | null;
	primaryPitchAccentIsCustom?: boolean | null;
	configSignature: string;
	definitionConfig: Record<string, unknown> | null;
	configLabel: string | null;
	due: string;
	stability: number;
	difficulty: number;
	elapsedDays: number;
	scheduledDays: number;
	learningSteps: number;
	reps: number;
	lapses: number;
	state: string;
	lastReview: string;
	reviewType: string;
	deleted: boolean;
	suspended: boolean;
	createdAt: string | null;
	updatedAt: string | null;
	deletedAt?: string | null;
};

type SyncCardRecord = {
	id: string;
	deckId: string;
	knowledgeId: string;
	note: string | null;
	tags: string | null;
	createdAt: string | null;
	updatedAt: string | null;
	deletedAt?: string | null;
};

type SyncKnowledgeLinkRecord = {
	id: string;
	deckLinkId: string;
	sourceKnowledgeId: string;
	mirroredKnowledgeId: string;
	createdAt: string | null;
	updatedAt: string | null;
};

type SyncCardLinkRecord = {
	id: string;
	deckLinkId: string;
	sourceCardId: string;
	mirroredCardId: string;
	createdAt: string | null;
	updatedAt: string | null;
};

type SyncReviewLogRecord = {
	id: string;
	knowledgeId: string;
	rating: string | null;
	review: string;
	due: string;
	stability: number;
	difficulty: number;
	elapsedDays: number;
	scheduledDays: number;
	learningSteps: number;
	state: string;
	lastElapsedDays: number;
	durationMs?: number | null;
	deleted: boolean;
	createdAt: string | null;
	updatedAt: string | null;
};

type SyncReviewUndoRecord = {
	id: string;
	knowledgeId: string;
	reviewLogId: string;
	due: string;
	stability: number;
	difficulty: number;
	elapsedDays: number;
	scheduledDays: number;
	learningSteps: number;
	reps: number;
	lapses: number;
	state: string;
	lastReview: string;
	undone: boolean;
	invalidated: boolean;
	createdAt: string | null;
	updatedAt: string | null;
};

export interface SyncPullPayload {
	deckFolders: SyncDeckFolderRecord[];
	decks: SyncDeckRecord[];
	deckLinks: SyncDeckLinkRecord[];
	appSettings: SyncAppSettingRecord[];
	permanentDeletes: SyncPermanentDeleteRecord[];
	knowledge: SyncKnowledgeRecord[];
	cards: SyncCardRecord[];
	knowledgeLinks: SyncKnowledgeLinkRecord[];
	cardLinks: SyncCardLinkRecord[];
	reviewLogs: SyncReviewLogRecord[];
	reviewUndos: SyncReviewUndoRecord[];
}

const toStoredValue = (value: string | null | undefined) => value ?? null;

export const importPulledSyncData = async (
	db: DrizzleInstance,
	payload: SyncPullPayload,
	options?: {
		onProgress?: (progress: { label: string; completed: number; total: number }) => void;
	},
) => {
	const totalItems =
		payload.deckFolders.length +
		payload.decks.length +
		payload.deckLinks.length +
		payload.appSettings.length +
		payload.permanentDeletes.length +
		payload.knowledge.length +
		payload.cards.length +
		payload.knowledgeLinks.length +
		payload.cardLinks.length +
		payload.reviewLogs.length +
		payload.reviewUndos.length;
	let completedItems = 0;
	options?.onProgress?.({
		label: "Import",
		completed: 0,
		total: Math.max(1, totalItems),
	});

	const processChunks = async <T,>(
		items: T[],
		handler: (transactionDb: DrizzleInstance, item: T) => Promise<void>,
	) => {
		for (const chunk of chunkArray(items, IMPORT_CHUNK_SIZE)) {
			await db.transaction(async (tx) => {
				const transactionDb = tx as DrizzleInstance;
				for (const item of chunk) {
					await handler(transactionDb, item);
				}
			});
			completedItems += chunk.length;
			options?.onProgress?.({
				label: "Import",
				completed: Math.min(completedItems, Math.max(1, totalItems)),
				total: Math.max(1, totalItems),
			});
			await yieldToUi();
		}
	};

	await processChunks(payload.deckFolders, async (transactionDb, folder) => {
		await transactionDb
			.insert(decksFolders)
			.values({
				id: folder.id,
				name: folder.name,
				languageId: folder.languageId,
				parentId: folder.parentId,
				newCardsPaused: Boolean(folder.newCardsPaused),
				deleted: Boolean(folder.deletedAt),
				deletedAt: toStoredValue(folder.deletedAt),
				createdAt: toStoredValue(folder.createdAt),
				updatedAt: toStoredValue(folder.updatedAt),
			})
			.onConflictDoUpdate({
				target: decksFolders.id,
				set: {
					name: folder.name,
					languageId: folder.languageId,
					parentId: folder.parentId,
					newCardsPaused: Boolean(folder.newCardsPaused),
					deleted: Boolean(folder.deletedAt),
					deletedAt: toStoredValue(folder.deletedAt),
					createdAt: toStoredValue(folder.createdAt),
					updatedAt: toStoredValue(folder.updatedAt),
				},
			});
	});

	await processChunks(payload.decks, async (transactionDb, deck) => {
		await transactionDb
			.insert(decks)
			.values({
				id: deck.id,
				name: deck.name,
				visibility: deck.visibility,
				isStarred: deck.isStarred,
				folderId: deck.folderId,
				languageId: deck.languageId,
				sourceReviewType: deck.sourceReviewType,
				primaryDeckId: deck.primaryDeckId,
				newCardsPaused: Boolean(deck.newCardsPaused),
				deleted: Boolean(deck.deletedAt),
				deletedAt: toStoredValue(deck.deletedAt),
				createdAt: toStoredValue(deck.createdAt),
				updatedAt: toStoredValue(deck.updatedAt),
			})
			.onConflictDoUpdate({
				target: decks.id,
				set: {
					name: deck.name,
					visibility: deck.visibility,
					isStarred: deck.isStarred,
					folderId: deck.folderId,
					languageId: deck.languageId,
					sourceReviewType: deck.sourceReviewType,
					primaryDeckId: deck.primaryDeckId,
					newCardsPaused: Boolean(deck.newCardsPaused),
					deleted: Boolean(deck.deletedAt),
					deletedAt: toStoredValue(deck.deletedAt),
					createdAt: toStoredValue(deck.createdAt),
					updatedAt: toStoredValue(deck.updatedAt),
				},
			});
	});

	await processChunks(payload.deckLinks, async (transactionDb, link) => {
		await transactionDb
			.insert(deckLinks)
			.values({
				id: link.id,
				primaryDeckId: link.primaryDeckId,
				linkedDeckId: link.linkedDeckId,
				targetReviewType: link.targetReviewType,
				createdAt: toStoredValue(link.createdAt),
				updatedAt: toStoredValue(link.updatedAt),
			})
			.onConflictDoUpdate({
				target: deckLinks.id,
				set: {
					primaryDeckId: link.primaryDeckId,
					linkedDeckId: link.linkedDeckId,
					targetReviewType: link.targetReviewType,
					createdAt: toStoredValue(link.createdAt),
					updatedAt: toStoredValue(link.updatedAt),
				},
			});
	});

	await processChunks(payload.appSettings, async (transactionDb, setting) => {
		await transactionDb
			.insert(appSettings)
			.values({
				key: setting.key,
				value: setting.value,
				updatedAt: toStoredValue(setting.updatedAt),
			})
			.onConflictDoUpdate({
				target: appSettings.key,
				set: {
					value: setting.value,
					updatedAt: toStoredValue(setting.updatedAt),
				},
			});
	});

	await processChunks(payload.knowledge, async (transactionDb, item) => {
		await transactionDb
			.insert(knowledge)
			.values({
				id: item.id,
				front: item.front,
				definitions: item.definitions,
				sourceDefinitions: item.sourceDefinitions ?? null,
				pronunciation: item.pronunciation,
				wordId: item.wordId,
				entryId: item.entryId,
				focus: item.focus,
				showFocus: item.showFocus,
				focusAllowsDuplicates: item.focusAllowsDuplicates,
				note: item.note,
				tags: item.tags,
				primaryPitchAccentDictionaryId:
					item.primaryPitchAccentDictionaryId ?? null,
				primaryPitchAccentReading: item.primaryPitchAccentReading ?? null,
				primaryPitchAccentAccentNumber:
					item.primaryPitchAccentAccentNumber ?? null,
				primaryPitchAccentIsCustom:
					item.primaryPitchAccentIsCustom ?? null,
				configSignature: item.configSignature,
				definitionConfig: item.definitionConfig
					? JSON.stringify(item.definitionConfig)
					: null,
				configLabel: item.configLabel,
				due: item.due,
				stability: item.stability,
				difficulty: item.difficulty,
				elapsedDays: item.elapsedDays,
				scheduledDays: item.scheduledDays,
				learningSteps: item.learningSteps,
				reps: item.reps,
				lapses: item.lapses,
				state: item.state,
				lastReview: item.lastReview,
				reviewType: item.reviewType,
				deleted: item.deleted || Boolean(item.deletedAt),
				suspended: item.suspended,
				createdAt: toStoredValue(item.createdAt),
				updatedAt: toStoredValue(item.updatedAt),
			})
			.onConflictDoUpdate({
				target: knowledge.id,
				set: {
					front: item.front,
					definitions: item.definitions,
					sourceDefinitions: item.sourceDefinitions ?? null,
					pronunciation: item.pronunciation,
					wordId: item.wordId,
					entryId: item.entryId,
					focus: item.focus,
					showFocus: item.showFocus,
					focusAllowsDuplicates: item.focusAllowsDuplicates,
					note: item.note,
					tags: item.tags,
					primaryPitchAccentDictionaryId:
						item.primaryPitchAccentDictionaryId ?? null,
					primaryPitchAccentReading: item.primaryPitchAccentReading ?? null,
					primaryPitchAccentAccentNumber:
						item.primaryPitchAccentAccentNumber ?? null,
					primaryPitchAccentIsCustom:
						item.primaryPitchAccentIsCustom ?? null,
					configSignature: item.configSignature,
					definitionConfig: item.definitionConfig
						? JSON.stringify(item.definitionConfig)
						: null,
					configLabel: item.configLabel,
					due: item.due,
					stability: item.stability,
					difficulty: item.difficulty,
					elapsedDays: item.elapsedDays,
					scheduledDays: item.scheduledDays,
					learningSteps: item.learningSteps,
					reps: item.reps,
					lapses: item.lapses,
					state: item.state,
					lastReview: item.lastReview,
					reviewType: item.reviewType,
					deleted: item.deleted || Boolean(item.deletedAt),
					suspended: item.suspended,
					createdAt: toStoredValue(item.createdAt),
					updatedAt: toStoredValue(item.updatedAt),
				},
			});
	});

	await processChunks(payload.cards, async (transactionDb, card) => {
		await transactionDb
			.insert(cards)
			.values({
				id: card.id,
				deckId: card.deckId,
				knowledgeId: card.knowledgeId,
				note: card.note,
				tags: card.tags,
				deleted: Boolean(card.deletedAt),
				deletedAt: toStoredValue(card.deletedAt),
				createdAt: toStoredValue(card.createdAt),
				updatedAt: toStoredValue(card.updatedAt),
			})
			.onConflictDoUpdate({
				target: cards.id,
				set: {
					deckId: card.deckId,
					knowledgeId: card.knowledgeId,
					note: card.note,
					tags: card.tags,
					deleted: Boolean(card.deletedAt),
					deletedAt: toStoredValue(card.deletedAt),
					createdAt: toStoredValue(card.createdAt),
					updatedAt: toStoredValue(card.updatedAt),
				},
			});
	});

	await processChunks(payload.knowledgeLinks, async (transactionDb, item) => {
		await transactionDb
			.insert(knowledgeLinks)
			.values({
				id: item.id,
				deckLinkId: item.deckLinkId,
				sourceKnowledgeId: item.sourceKnowledgeId,
				mirroredKnowledgeId: item.mirroredKnowledgeId,
				createdAt: toStoredValue(item.createdAt),
				updatedAt: toStoredValue(item.updatedAt),
			})
			.onConflictDoUpdate({
				target: knowledgeLinks.id,
				set: {
					deckLinkId: item.deckLinkId,
					sourceKnowledgeId: item.sourceKnowledgeId,
					mirroredKnowledgeId: item.mirroredKnowledgeId,
					createdAt: toStoredValue(item.createdAt),
					updatedAt: toStoredValue(item.updatedAt),
				},
			});
	});

	await processChunks(payload.cardLinks, async (transactionDb, item) => {
		await transactionDb
			.insert(cardLinks)
			.values({
				id: item.id,
				deckLinkId: item.deckLinkId,
				sourceCardId: item.sourceCardId,
				mirroredCardId: item.mirroredCardId,
				createdAt: toStoredValue(item.createdAt),
				updatedAt: toStoredValue(item.updatedAt),
			})
			.onConflictDoUpdate({
				target: cardLinks.id,
				set: {
					deckLinkId: item.deckLinkId,
					sourceCardId: item.sourceCardId,
					mirroredCardId: item.mirroredCardId,
					createdAt: toStoredValue(item.createdAt),
					updatedAt: toStoredValue(item.updatedAt),
				},
			});
	});

	await processChunks(payload.reviewLogs, async (transactionDb, item) => {
		await transactionDb
			.insert(reviewLog)
			.values({
				id: item.id,
				knowledgeId: item.knowledgeId,
				rating: item.rating,
				review: item.review,
				due: item.due,
				stability: item.stability,
				difficulty: item.difficulty,
				elapsedDays: item.elapsedDays,
				scheduledDays: item.scheduledDays,
				learningSteps: item.learningSteps,
				state: item.state,
				lastElapsedDays: item.lastElapsedDays,
				durationMs: item.durationMs ?? null,
				deleted: item.deleted,
			})
			.onConflictDoUpdate({
				target: reviewLog.id,
				set: {
					knowledgeId: item.knowledgeId,
					rating: item.rating,
					review: item.review,
					due: item.due,
					stability: item.stability,
					difficulty: item.difficulty,
					elapsedDays: item.elapsedDays,
					scheduledDays: item.scheduledDays,
					learningSteps: item.learningSteps,
					state: item.state,
					lastElapsedDays: item.lastElapsedDays,
					durationMs: item.durationMs ?? null,
					deleted: item.deleted,
				},
			});
	});

	await processChunks(payload.reviewUndos, async (transactionDb, item) => {
		await transactionDb
			.insert(reviewUndo)
			.values({
				id: item.id,
				knowledgeId: item.knowledgeId,
				reviewLogId: item.reviewLogId,
				due: item.due,
				stability: item.stability,
				difficulty: item.difficulty,
				elapsedDays: item.elapsedDays,
				scheduledDays: item.scheduledDays,
				learningSteps: item.learningSteps,
				reps: item.reps,
				lapses: item.lapses,
				state: item.state,
				lastReview: item.lastReview,
				undone: item.undone,
				invalidated: item.invalidated,
				createdAt: toStoredValue(item.createdAt),
				updatedAt: toStoredValue(item.updatedAt),
			})
			.onConflictDoUpdate({
				target: reviewUndo.id,
				set: {
					knowledgeId: item.knowledgeId,
					reviewLogId: item.reviewLogId,
					due: item.due,
					stability: item.stability,
					difficulty: item.difficulty,
					elapsedDays: item.elapsedDays,
					scheduledDays: item.scheduledDays,
					learningSteps: item.learningSteps,
					reps: item.reps,
					lapses: item.lapses,
					state: item.state,
					lastReview: item.lastReview,
					undone: item.undone,
					invalidated: item.invalidated,
					createdAt: toStoredValue(item.createdAt),
					updatedAt: toStoredValue(item.updatedAt),
				},
			});
	});

	await processChunks(payload.permanentDeletes, async (transactionDb, item) => {
		await applyPermanentDeletes(transactionDb, [
			{
				id: item.id,
				entityType: item.entityType,
				entityId: item.entityId,
				deletedAt: toStoredValue(item.deletedAt) ?? new Date().toISOString(),
			},
		]);
	});

	return {
		deckFolders: payload.deckFolders.filter((item) => !item.deletedAt).length,
		decks: payload.decks.filter((item) => !item.deletedAt).length,
		deckLinks: payload.deckLinks.length,
		permanentDeletes: payload.permanentDeletes.length,
		knowledge: payload.knowledge.length,
		cards: payload.cards.filter((item) => !item.deletedAt).length,
		knowledgeLinks: payload.knowledgeLinks.length,
		cardLinks: payload.cardLinks.length,
		reviewLogs: payload.reviewLogs.length,
		reviewUndos: payload.reviewUndos.length,
	};
};
