/** Linked decks: a primary deck mirrored into other review types, kept in sync card by card. */
import { and, eq, inArray } from "drizzle-orm";
import { DrizzleInstance } from "@/lib/database/DrizzleContext";
import {
	cardLinks,
	cards,
	deckLinks,
	decks,
	knowledge,
	knowledgeLinks,
} from "@/lib/database/schema";
import { generateId } from "@/lib/id";
import { markLocalChange } from "@/lib/sync/settings";
import {
	buildMirroredKnowledgeValues,
	createReviewTypeSupportResolver,
	resolveLinkedDeckName,
} from "./knowledgePayload";
import { getDeckDetail } from "./queries";
import { refreshDecksStore } from "./store";
import type { DeckCardListItem } from "./types";

const ensureMirroredKnowledge = async ({
	db,
	deckLinkRow,
	sourceKnowledge,
	existingKnowledgeLink,
}: {
	db: DrizzleInstance;
	deckLinkRow: typeof deckLinks.$inferSelect;
	sourceKnowledge: typeof knowledge.$inferSelect;
	existingKnowledgeLink: typeof knowledgeLinks.$inferSelect | null;
}) => {
	const mirroredValues = buildMirroredKnowledgeValues({
		sourceKnowledge,
		targetReviewType: deckLinkRow.targetReviewType,
	});

	if (!existingKnowledgeLink) {
		const mirroredKnowledgeId = generateId();
		await db.insert(knowledge).values({
			id: mirroredKnowledgeId,
			...mirroredValues,
		});
		const insertedLink = await db
			.insert(knowledgeLinks)
			.values({
				id: generateId(),
				deckLinkId: deckLinkRow.id,
				sourceKnowledgeId: sourceKnowledge.id,
				mirroredKnowledgeId,
			})
			.returning();

		return {
			mirroredKnowledgeId,
			knowledgeLink: insertedLink[0] ?? null,
		};
	}

	const mirroredKnowledge = await db.query.knowledge.findFirst({
		where: eq(knowledge.id, existingKnowledgeLink.mirroredKnowledgeId),
	});

	if (!mirroredKnowledge) {
		const mirroredKnowledgeId = generateId();
		await db.insert(knowledge).values({
			id: mirroredKnowledgeId,
			...mirroredValues,
		});
		await db
			.update(knowledgeLinks)
			.set({
				mirroredKnowledgeId,
			})
			.where(eq(knowledgeLinks.id, existingKnowledgeLink.id));

		return {
			mirroredKnowledgeId,
			knowledgeLink: {
				...existingKnowledgeLink,
				mirroredKnowledgeId,
			},
		};
	}

	await db
		.update(knowledge)
		.set(mirroredValues)
		.where(eq(knowledge.id, existingKnowledgeLink.mirroredKnowledgeId));

	return {
		mirroredKnowledgeId: existingKnowledgeLink.mirroredKnowledgeId,
		knowledgeLink: existingKnowledgeLink,
	};
};

const ensureMirroredCard = async ({
	db,
	deckLinkRow,
	sourceCard,
	mirroredKnowledgeId,
	existingCardLink,
}: {
	db: DrizzleInstance;
	deckLinkRow: typeof deckLinks.$inferSelect;
	sourceCard: DeckCardListItem;
	mirroredKnowledgeId: string;
	existingCardLink: typeof cardLinks.$inferSelect | null;
}) => {
	if (!existingCardLink) {
		const mirroredCardId = generateId();
		await db.insert(cards).values({
			id: mirroredCardId,
			deckId: deckLinkRow.linkedDeckId,
			knowledgeId: mirroredKnowledgeId,
			note: sourceCard.note ?? null,
			tags: sourceCard.tags ?? null,
			deleted: false,
			deletedAt: null,
		});
		await db.insert(cardLinks).values({
			id: generateId(),
			deckLinkId: deckLinkRow.id,
			sourceCardId: sourceCard.id,
			mirroredCardId,
		});
		return;
	}

	const mirroredCard = await db.query.cards.findFirst({
		where: eq(cards.id, existingCardLink.mirroredCardId),
	});

	if (!mirroredCard) {
		const mirroredCardId = generateId();
		await db.insert(cards).values({
			id: mirroredCardId,
			deckId: deckLinkRow.linkedDeckId,
			knowledgeId: mirroredKnowledgeId,
			note: sourceCard.note ?? null,
			tags: sourceCard.tags ?? null,
			deleted: false,
			deletedAt: null,
		});
		await db
			.update(cardLinks)
			.set({
				mirroredCardId,
			})
			.where(eq(cardLinks.id, existingCardLink.id));
		return;
	}

	await db
		.update(cards)
		.set({
			deckId: deckLinkRow.linkedDeckId,
			knowledgeId: mirroredKnowledgeId,
			note: sourceCard.note ?? null,
			tags: sourceCard.tags ?? null,
			deleted: false,
			deletedAt: null,
		})
		.where(eq(cards.id, existingCardLink.mirroredCardId));
};

const deleteMirroredCard = async ({
	db,
	cardLinkRow,
	deletedAt,
}: {
	db: DrizzleInstance;
	cardLinkRow: typeof cardLinks.$inferSelect;
	deletedAt: string;
}) => {
	await db
		.update(cards)
		.set({
			deleted: true,
			deletedAt,
		})
		.where(eq(cards.id, cardLinkRow.mirroredCardId));
};

export const syncPrimaryDeckLinkedDecks = async (
	db: DrizzleInstance,
	primaryDeckId: string,
) => {
	const primaryDeck = await db.query.decks.findFirst({
		where: eq(decks.id, primaryDeckId),
	});

	if (!primaryDeck || primaryDeck.primaryDeckId || !primaryDeck.sourceReviewType) {
		return;
	}

	const linkRows = await db.query.deckLinks.findMany({
		where: eq(deckLinks.primaryDeckId, primaryDeck.id),
	});

	if (linkRows.length === 0) {
		return;
	}
	const supportsTargetReviewType = createReviewTypeSupportResolver(db);

	const sourceCards = await db.query.cards.findMany({
		where: eq(cards.deckId, primaryDeck.id),
		with: {
			knowledge: true,
		},
	});
	const deckLinkIds = linkRows.map((row) => row.id);
	const [allCardLinks, allKnowledgeLinks] = await Promise.all([
		db.query.cardLinks.findMany({
			where: inArray(cardLinks.deckLinkId, deckLinkIds),
		}),
		db.query.knowledgeLinks.findMany({
			where: inArray(knowledgeLinks.deckLinkId, deckLinkIds),
		}),
	]);
	const deletedAt = new Date().toISOString();

	for (const deckLinkRow of linkRows) {
		const cardLinkBySourceCardId = new Map(
			allCardLinks
				.filter((row) => row.deckLinkId === deckLinkRow.id)
				.map((row) => [row.sourceCardId, row]),
		);
		const knowledgeLinkBySourceKnowledgeId = new Map(
			allKnowledgeLinks
				.filter((row) => row.deckLinkId === deckLinkRow.id)
				.map((row) => [row.sourceKnowledgeId, row]),
		);

		for (const sourceCard of sourceCards) {
			const sourceKnowledge = sourceCard.knowledge;
			const targetReviewTypeSupported = sourceKnowledge
				? await supportsTargetReviewType({
						reviewType: deckLinkRow.targetReviewType,
						sourceKnowledge,
					})
				: false;
			const eligible =
				Boolean(sourceKnowledge) &&
				!sourceCard.deleted &&
				!sourceKnowledge.deleted &&
				sourceKnowledge.reviewType === primaryDeck.sourceReviewType &&
				targetReviewTypeSupported;
			const existingCardLink = cardLinkBySourceCardId.get(sourceCard.id) ?? null;

			if (!eligible || !sourceKnowledge) {
				if (existingCardLink) {
					await deleteMirroredCard({
						db,
						cardLinkRow: existingCardLink,
						deletedAt,
					});
				}
				continue;
			}

			const existingKnowledgeLink =
				knowledgeLinkBySourceKnowledgeId.get(sourceKnowledge.id) ?? null;
			const { mirroredKnowledgeId } = await ensureMirroredKnowledge({
				db,
				deckLinkRow,
				sourceKnowledge,
				existingKnowledgeLink,
			});
			await ensureMirroredCard({
				db,
				deckLinkRow,
				sourceCard,
				mirroredKnowledgeId,
				existingCardLink,
			});
		}
	}
};

export const createLinkedDeck = async (
	db: DrizzleInstance,
	input: {
		primaryDeckId: string;
		sourceReviewType: string;
		targetReviewType: string;
		name?: string;
	},
) => {
	const primaryDeck = await db.query.decks.findFirst({
		where: and(eq(decks.id, input.primaryDeckId), eq(decks.deleted, false)),
	});

	if (!primaryDeck) {
		return { status: "missing_deck" as const };
	}

	if (primaryDeck.primaryDeckId) {
		return {
			status: "managed_by_primary" as const,
			primaryDeckId: primaryDeck.primaryDeckId,
		};
	}

	if (input.sourceReviewType === input.targetReviewType) {
		return { status: "same_review_type" as const };
	}

	if (input.targetReviewType === "Pitch") {
		const sourceCards = await db.query.cards.findMany({
			where: eq(cards.deckId, primaryDeck.id),
			with: {
				knowledge: true,
			},
		});
		const supportsTargetReviewType = createReviewTypeSupportResolver(db);
		let hasPitchEligibleSource = false;

		for (const sourceCard of sourceCards) {
			const sourceKnowledge = sourceCard.knowledge;
			if (
				!sourceKnowledge ||
				sourceCard.deleted ||
				sourceKnowledge.deleted ||
				sourceKnowledge.reviewType !== input.sourceReviewType
			) {
				continue;
			}

			if (
				await supportsTargetReviewType({
					reviewType: input.targetReviewType,
					sourceKnowledge,
				})
			) {
				hasPitchEligibleSource = true;
				break;
			}
		}

		if (!hasPitchEligibleSource) {
			return { status: "pitch_not_supported" as const };
		}
	}

	const existingLinks = await db.query.deckLinks.findMany({
		where: eq(deckLinks.primaryDeckId, primaryDeck.id),
	});
	const existingLink = existingLinks.find(
		(row) => row.targetReviewType === input.targetReviewType,
	);
	if (existingLink) {
		const existingLinkedDeck = await db.query.decks.findFirst({
			where: eq(decks.id, existingLink.linkedDeckId),
		});

		if (existingLinkedDeck?.deleted) {
			await db
				.update(decks)
				.set({
					deleted: false,
					deletedAt: null,
				})
				.where(eq(decks.id, existingLinkedDeck.id));
			await db
				.update(cards)
				.set({
					deleted: false,
					deletedAt: null,
				})
				.where(eq(cards.deckId, existingLinkedDeck.id));
			await db
				.update(decks)
				.set({
					sourceReviewType: input.sourceReviewType,
				})
				.where(eq(decks.id, primaryDeck.id));
			await syncPrimaryDeckLinkedDecks(db, primaryDeck.id);
			await markLocalChange(db);
			await refreshDecksStore(db, primaryDeck.languageId ?? undefined);

			const linkedDeck = await getDeckDetail(
				db,
				existingLinkedDeck.id,
				primaryDeck.languageId ?? undefined,
			);

			return {
				status: "restored" as const,
				linkedDeck,
			};
		}

		const linkedDeck = existingLinkedDeck
			? await getDeckDetail(
					db,
					existingLinkedDeck.id,
					primaryDeck.languageId ?? undefined,
				)
			: null;

		return {
			status: "exists" as const,
			linkedDeck,
		};
	}

	const linkedDeckId = generateId();
	await db.insert(decks).values({
		id: linkedDeckId,
		name: input.name ?? resolveLinkedDeckName(primaryDeck.name, input.targetReviewType),
		languageId: primaryDeck.languageId,
		visibility: primaryDeck.visibility,
		isStarred: false,
		folderId: primaryDeck.folderId,
		primaryDeckId: primaryDeck.id,
	});
	await db
		.update(decks)
		.set({
			sourceReviewType: input.sourceReviewType,
		})
		.where(eq(decks.id, primaryDeck.id));
	await db.insert(deckLinks).values({
		id: generateId(),
		primaryDeckId: primaryDeck.id,
		linkedDeckId,
		targetReviewType: input.targetReviewType,
	});
	await syncPrimaryDeckLinkedDecks(db, primaryDeck.id);
	await markLocalChange(db);
	await refreshDecksStore(db, primaryDeck.languageId ?? undefined);

	const linkedDeck = await getDeckDetail(db, linkedDeckId, primaryDeck.languageId ?? undefined);

	return {
		status: "created" as const,
		linkedDeck,
	};
};
