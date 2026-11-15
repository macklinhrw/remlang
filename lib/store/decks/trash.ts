/** Soft delete, restore and permanent delete (with sync tombstones) for decks and folders. */
import { and, eq, inArray, or } from "drizzle-orm";
import { DrizzleInstance } from "@/lib/database/DrizzleContext";
import {
	cardLinks,
	cards,
	deckLinks,
	decks,
	decksFolders,
	knowledge,
	knowledgeLinks,
} from "@/lib/database/schema";
import { createPermanentDeleteRecord, upsertPermanentDeletes } from "@/lib/sync/permanentDeletes";
import { markLocalChange } from "@/lib/sync/settings";
import { syncPrimaryDeckLinkedDecks } from "./linkedDecks";
import { refreshDecksStore } from "./store";

export const getDeckCascadeIds = async (db: DrizzleInstance, primaryDeckId: string) => {
	const linkRows = await db.query.deckLinks.findMany({
		where: eq(deckLinks.primaryDeckId, primaryDeckId),
	});
	return [primaryDeckId, ...linkRows.map((row) => row.linkedDeckId)];
};

export const getFolderCascadeDeckIds = async (
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
