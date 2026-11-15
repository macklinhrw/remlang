/** Deck and folder creation, moves and review-limit settings. */
import { and, eq, inArray, isNull } from "drizzle-orm";
import { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { cards, decks, decksFolders } from "@/lib/database/schema";
import { generateId } from "@/lib/id";
import { normalizeReviewLimitSettings } from "@/lib/review/reviewLimits";
import { createPermanentDeleteRecord, upsertPermanentDeletes } from "@/lib/sync/permanentDeletes";
import { markLocalChange } from "@/lib/sync/settings";
import { syncPrimaryDeckLinkedDecks } from "./linkedDecks";
import { refreshDecksStore } from "./store";
import { getDeckCascadeIds, getFolderCascadeDeckIds } from "./trash";
import type { DeckListItem } from "./types";

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
