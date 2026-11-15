/** Per-deck and per-folder card and due counts. */
import { and, eq, inArray } from "drizzle-orm";
import { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { cards, deckLinks, decks, decksFolders, knowledge } from "@/lib/database/schema";
import { getDeckAvailableDueCount, getFolderAvailableDueCount } from "@/lib/review/fsrs";
import type { DeckListItem, LinkedDeckListItem } from "./types";

export const sortByName = <T extends { name: string }>(rows: T[]) =>
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

export const getFolderStats = async ({
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

export const withDeckStats = async (
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

export const getLinkedDeckSummaries = async (
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
