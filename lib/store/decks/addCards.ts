/** Adding dictionary entries and premade-deck items to a deck. */
import { and, eq, isNull } from "drizzle-orm";
import { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { getEntryDetail } from "@/lib/database/lexicon";
import { cards, decks, knowledge } from "@/lib/database/schema";
import { generateId } from "@/lib/id";
import {
	DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
	type KnowledgeDefinitionConfig,
	getNextKnowledgeConfigLabel,
} from "@/lib/knowledge/config";
import type { PremadeDeckItem } from "@/lib/premadeDecks/types";
import { markLocalChange } from "@/lib/sync/settings";
import {
	buildKnowledgePayload,
	buildPremadeKnowledgePayload,
	supportsReviewTypeForEntry,
} from "./knowledgePayload";
import { syncPrimaryDeckLinkedDecks } from "./linkedDecks";

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
