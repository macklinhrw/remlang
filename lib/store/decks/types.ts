/** Row and view types shared by the deck store modules. */
import { cards, decks, decksFolders, knowledge } from "@/lib/database/schema";

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
