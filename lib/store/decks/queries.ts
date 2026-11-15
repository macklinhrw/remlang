/** Read side: deck lists, folder lists, collections and deck detail. */
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { cards, decks, decksFolders } from "@/lib/database/schema";
import { getDeckAvailableDueCount } from "@/lib/review/fsrs";
import { getFolderStats, getLinkedDeckSummaries, sortByName, withDeckStats } from "./stats";
import type {
	DeckCollectionListItem,
	DeckDetailResult,
	DeckFolderListItem,
	DeckListItem,
	DeckRole,
	DeletedDeckFolderListItem,
	DeletedDeckListItem,
	DeletedTrashSnapshot,
} from "./types";

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
