/**
 * Deck store: public API for decks, folders, linked decks and trash.
 * Implementation lives in ./decks/*; this file only re-exports it.
 */
export type {
	DeckCardListItem,
	DeckCollectionListItem,
	DeckDetailResult,
	DeckFolderListItem,
	DeckListItem,
	DeckRole,
	DeletedDeckFolderListItem,
	DeletedDeckListItem,
	DeletedTrashSnapshot,
	LinkedDeckListItem,
	PrimaryDeckSummary,
} from "./decks/types";
export { createLinkedDeck, syncPrimaryDeckLinkedDecks } from "./decks/linkedDecks";
export { emptyTrash, restoreDeck, restoreDeckFolder, trashDeck } from "./decks/trash";
export {
	getDeckCollectionItems,
	getDeckDetail,
	getDeckFolders,
	getDecks,
	getDeletedDeckFolders,
	getDeletedDecks,
	getDeletedTrashSnapshot,
} from "./decks/queries";
export {
	createDeck,
	createDeckFolder,
	deleteDeckFolder,
	deleteDeckFolderAndChildren,
	setDeckFolder,
	setDeckNewCardsPaused,
	setDeckReviewLimits,
	setDeckSourceReviewType,
	setFolderNewCardsPaused,
	setFolderReviewLimits,
} from "./decks/mutations";
export { addEntryToDeck, addPremadeItemToDeck } from "./decks/addCards";
export { decks$, refreshDecksStore } from "./decks/store";
export type {
	DeckCollectionResult,
	DeckCollectionResultItem,
	DeckResult,
	DecksResult,
} from "./decks/store";
