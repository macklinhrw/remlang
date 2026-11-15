export const PREMADE_DECK_BOOKS = [
	"tobira-1",
	"tobira-1-counting",
	"tobira-2",
	"tobira-2-counting",
] as const;

export type PremadeDeckBook = (typeof PREMADE_DECK_BOOKS)[number];
export type PremadeDeckSource = "tobira";

export const getPremadeBookLabel = (book: PremadeDeckBook) => {
	switch (book) {
		case "tobira-1":
			return "Tobira 1 Vocabulary";
		case "tobira-1-counting":
			return "Tobira 1 Counting Words";
		case "tobira-2":
			return "Tobira 2 Vocabulary";
		case "tobira-2-counting":
			return "Tobira 2 Counting Words";
	}
};

export const inferPremadeBookFromDeckId = (deckId: string): PremadeDeckBook | null => {
	if (deckId.startsWith("tobira-1-counting-")) {
		return "tobira-1-counting";
	}
	if (deckId.startsWith("tobira-2-counting-")) {
		return "tobira-2-counting";
	}
	if (deckId.startsWith("tobira-1-")) {
		return "tobira-1";
	}
	if (deckId.startsWith("tobira-2-")) {
		return "tobira-2";
	}

	return null;
};

export const getPremadeBookSortOrder = (book: PremadeDeckBook) => {
	switch (book) {
		case "tobira-1":
			return 0;
		case "tobira-1-counting":
			return 1;
		case "tobira-2":
			return 2;
		case "tobira-2-counting":
			return 3;
	}
};

export type PremadeDictionaryLink = {
	entryId: string;
	senseIds: string[];
	usesAllSenses: boolean;
	matchStatus:
		| "linked_exact"
		| "linked_all_senses"
		| "linked_local_all_senses"
		| "unlinked";
	matchMethod:
		| "llm_candidate_selection"
		| "deterministic_exact_match"
		| "none";
};

export type PremadeMatchStatus = NonNullable<PremadeDictionaryLink["matchStatus"]>;
export type PremadeMatchMethod = NonNullable<PremadeDictionaryLink["matchMethod"]>;

export type PremadeDeckRecord = {
	id: string;
	slug: string;
	name: string;
	book: PremadeDeckBook;
	lesson: number;
	languageId: string;
	source: PremadeDeckSource;
	isPublished: boolean;
	createdAt: string;
	updatedAt: string;
};

export type PremadeDeckItemRecord = {
	id: string;
	premadeDeckId: string;
	sortOrder: number;
	sourceTag: string;
	kana: string | null;
	kanji: string | null;
	english: string;
	front: string;
	pronunciation: string | null;
	sourceDefinitions: string;
	dictionaryEntryId: string | null;
	dictionarySenseIds: string[];
	usesAllSenses: boolean;
	matchStatus: PremadeMatchStatus | null;
	matchMethod: PremadeMatchMethod | null;
	createdAt: string;
	updatedAt: string;
};

export type PremadeDeckTombstone = Pick<
	PremadeDeckRecord,
	"id" | "slug" | "name" | "book" | "lesson" | "languageId" | "source" | "createdAt" | "updatedAt"
> & {
	isPublished: boolean;
	deletedAt: string | null;
};

export type PremadeDeckItemTombstone = Omit<PremadeDeckItemRecord, "matchStatus" | "matchMethod"> & {
	matchStatus: PremadeMatchStatus | null;
	matchMethod: PremadeMatchMethod | null;
	deletedAt: string | null;
};

export type PremadePullResponse = {
	ok: true;
	serverTime: string;
	cursor: string;
	hasMore: boolean;
	premadeDecks: PremadeDeckTombstone[];
	premadeItems: PremadeDeckItemTombstone[];
};

export type PremadeListResponse = {
	ok: true;
	premadeDecks: PremadeDeckRecord[];
};

export type PremadeDeckItem = {
	id: string;
	sourceTag: string;
	kana: string | null;
	kanji: string | null;
	english: string;
	front: string;
	pronunciation: string | null;
	sourceDefinitions: string;
	dictionaryLink: PremadeDictionaryLink | null;
};

export type PremadeDeckFile = {
	deck: {
		id: string;
		book: PremadeDeckBook;
		lesson: number;
		name: string;
		languageId: "lang_ja";
		source: "tobira";
	};
	list: PremadeDeckItem[];
};
