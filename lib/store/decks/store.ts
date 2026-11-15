/** Observable deck-list snapshot used by the UI (Legend State), and its refresh logic. */
import { observable } from "@legendapp/state";
import { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { decks } from "@/lib/database/schema";
import { getDeckCollectionItems, getDecks } from "./queries";

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
