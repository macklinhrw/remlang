import * as React from "react";
import { observable } from "@legendapp/state";
import { useSelector } from "@legendapp/state/react";
import { and, eq } from "drizzle-orm";
import type { DrizzleInstance } from "@/lib/database/DrizzleContext";
import { cards } from "@/lib/database/schema";
import {
	REVIEW_GRADES,
	REVIEW_SESSION_BUCKET_SIZE,
	type DeckReviewSession,
	type FolderReviewSession,
	type KnowledgeReviewPreview,
	type ReviewUndoAvailability,
	type ReviewSession,
	formatStoredDateTime,
	getDeckReviewSession,
	getFolderReviewSession,
	getReviewUndoAvailability,
	previewKnowledgeReview,
	submitKnowledgeReview,
	undoPreviousReview,
} from "@/lib/review/fsrs";
import { decks$, refreshDecksStore } from "@/lib/store/decksStore";

type ReviewGrade = (typeof REVIEW_GRADES)[number];
type ReviewTargetType = "deck" | "folder";

interface DeckReviewState {
	targetType: ReviewTargetType | null;
	targetId: string | null;
	languageId: string | null;
	session: ReviewSession | null;
	isLoading: boolean;
	isAnswerVisible: boolean;
	preview: KnowledgeReviewPreview | null;
	isSubmitting: boolean;
	isUndoing: boolean;
	isRefreshingSession: boolean;
	reviewedCount: number;
	reviewedNewCount: number;
	errorMessage: string | null;
	undoErrorMessage: string | null;
	canUndoPreviousReview: boolean;
	undoKnowledgeId: string | null;
	lastUndoContext: {
		knowledgeId: string;
		deckId: string;
		wasNew: boolean;
		targetType: ReviewTargetType;
		targetId: string;
		languageId: string | null;
	} | null;
}

const defaults: DeckReviewState = {
	targetType: null,
	targetId: null,
	languageId: null,
	session: null,
	isLoading: true,
	isAnswerVisible: false,
	preview: null,
	isSubmitting: false,
	isUndoing: false,
	isRefreshingSession: false,
	reviewedCount: 0,
	reviewedNewCount: 0,
	errorMessage: null,
	undoErrorMessage: null,
	canUndoPreviousReview: false,
	undoKnowledgeId: null,
	lastUndoContext: null,
};

export const deckReview$ = observable<DeckReviewState>(defaults);

let reviewLoadRequestId = 0;
let timedKnowledgeId: string | null = null;
let cardShownAt = 0;

const startCardTimer = (knowledgeId: string | null) => {
	if (knowledgeId === timedKnowledgeId) return;
	timedKnowledgeId = knowledgeId;
	cardShownAt = knowledgeId ? Date.now() : 0;
};

const isClosedResourceError = (error: unknown) =>
	error instanceof Error &&
	/error code|closed resource|access to closed resource|prepareSync/i.test(error.message);

const resetProgress = () => {
	deckReview$.reviewedCount.set(0);
	deckReview$.reviewedNewCount.set(0);
	deckReview$.lastUndoContext.set(null);
	deckReview$.isAnswerVisible.set(false);
	deckReview$.preview.set(null);
	deckReview$.undoErrorMessage.set(null);
	startCardTimer(null);
};

const scheduleBackgroundTask = (task: () => void) => {
	if (typeof globalThis.requestIdleCallback === "function") {
		globalThis.requestIdleCallback(() => {
			task();
		});
		return;
	}

	setTimeout(task, 32);
};

const clearSessionState = ({
	targetType,
	targetId,
	languageId,
}: {
	targetType: ReviewTargetType | null;
	targetId: string | null;
	languageId: string | null;
}) => {
	deckReview$.set({
		...defaults,
		targetType,
		targetId,
		languageId,
		isLoading: false,
	});
};

const applyUndoAvailability = (availability: ReviewUndoAvailability) => {
	deckReview$.canUndoPreviousReview.set(availability.isAvailable);
	deckReview$.undoKnowledgeId.set(availability.knowledgeId);
};

const loadUndoAvailability = async ({
	db,
	targetType,
	targetId,
}: {
	db: DrizzleInstance;
	targetType: ReviewTargetType;
	targetId: string | null;
}) => {
	try {
		const availability = await getReviewUndoAvailability({
			db,
			targetType,
			targetId,
		});
		if (
			deckReview$.targetType.peek() === targetType &&
			deckReview$.targetId.peek() === targetId
		) {
			applyUndoAvailability(availability);
		}
		return availability;
	} catch (error) {
		console.error("Failed to load review undo availability.", error);
		if (
			deckReview$.targetType.peek() === targetType &&
			deckReview$.targetId.peek() === targetId
		) {
			applyUndoAvailability({
				isAvailable: false,
				knowledgeId: null,
			});
		}
		return {
			isAvailable: false,
			knowledgeId: null,
		};
	}
};

const fetchReviewSessionSnapshot = async ({
	db,
	targetType,
	targetId,
	languageId,
}: {
	db: DrizzleInstance;
	targetType: ReviewTargetType;
	targetId: string;
	languageId?: string | null;
}) =>
	targetType === "deck"
		? await getDeckReviewSession(db, targetId, languageId ?? undefined, {
				limit: REVIEW_SESSION_BUCKET_SIZE,
			})
		: await getFolderReviewSession(db, targetId, languageId ?? undefined, {
				limit: REVIEW_SESSION_BUCKET_SIZE,
			});

const mergeSessionKeepingCurrentCard = ({
	freshSession,
	preserveVisibleCard,
}: {
	freshSession: ReviewSession | null;
	preserveVisibleCard: boolean;
}) => {
	if (!freshSession || !preserveVisibleCard) {
		return freshSession;
	}

	const currentSession = deckReview$.session.peek();
	const currentCard = currentSession?.cards[0] ?? null;
	if (
		!currentSession ||
		!currentCard ||
		currentSession.target.type !== freshSession.target.type ||
		currentSession.target.id !== freshSession.target.id
	) {
		return freshSession;
	}

	const hasCurrentCard = freshSession.cards.some(
		(card) => card.knowledge.id === currentCard.knowledge.id,
	);
	const cards = [
		currentCard,
		...freshSession.cards.filter(
			(card) => card.knowledge.id !== currentCard.knowledge.id,
		),
	].slice(0, REVIEW_SESSION_BUCKET_SIZE);
	const dueCount = freshSession.dueCount + (hasCurrentCard ? 0 : 1);

	return {
		...freshSession,
		cards,
		dueCount,
		totalCards: dueCount,
	};
};

const loadReviewSession = async ({
	db,
	targetType,
	targetId,
	languageId,
	showSpinner = false,
	indicateRefresh = false,
	resetProgressState = true,
	preserveVisibleCard = false,
}: {
	db: DrizzleInstance;
	targetType: ReviewTargetType;
	targetId: string | null;
	languageId?: string | null;
	showSpinner?: boolean;
	indicateRefresh?: boolean;
	resetProgressState?: boolean;
	preserveVisibleCard?: boolean;
}) => {
	const requestId = ++reviewLoadRequestId;
	const previousTargetType = deckReview$.targetType.peek();
	const previousTargetId = deckReview$.targetId.peek();
	const previousLanguageId = deckReview$.languageId.peek();
	const targetChanged =
		previousTargetType !== targetType ||
		previousTargetId !== targetId ||
		previousLanguageId !== (languageId ?? null);

	deckReview$.targetType.set(targetType);
	deckReview$.targetId.set(targetId);
	deckReview$.languageId.set(languageId ?? null);

	if (!targetId) {
		clearSessionState({
			targetType,
			targetId,
			languageId: languageId ?? null,
		});
		return null;
	}

	if (resetProgressState) {
		resetProgress();
	}

	if (targetChanged) {
		deckReview$.session.set(null);
		deckReview$.preview.set(null);
		deckReview$.isAnswerVisible.set(false);
		deckReview$.undoErrorMessage.set(null);
		deckReview$.canUndoPreviousReview.set(false);
		deckReview$.undoKnowledgeId.set(null);
		deckReview$.isLoading.set(true);
	}

	if (showSpinner) {
		deckReview$.isLoading.set(true);
	}
	if (indicateRefresh) {
		deckReview$.isRefreshingSession.set(true);
	}
	deckReview$.errorMessage.set(null);

	try {
		const freshSession = await fetchReviewSessionSnapshot({
			db,
			targetType,
			targetId,
			languageId,
		});
		if (
			requestId !== reviewLoadRequestId ||
			deckReview$.targetType.peek() !== targetType ||
			deckReview$.targetId.peek() !== targetId ||
			deckReview$.languageId.peek() !== (languageId ?? null)
		) {
			return freshSession;
		}

		const nextSession = mergeSessionKeepingCurrentCard({
			freshSession,
			preserveVisibleCard,
		});
		deckReview$.session.set(nextSession);
		startCardTimer(nextSession?.cards[0]?.knowledge.id ?? null);
		scheduleDeckReviewPreviewLoad({
			db,
			knowledgeId: nextSession?.cards[0]?.knowledge.id ?? null,
		});
		void loadUndoAvailability({
			db,
			targetType,
			targetId,
		});
		return nextSession;
	} catch (error) {
		if (!isClosedResourceError(error)) {
			console.error("Failed to load review session.", error);
		}
		if (
			requestId === reviewLoadRequestId &&
			deckReview$.targetType.peek() === targetType &&
			deckReview$.targetId.peek() === targetId
		) {
			if (!isClosedResourceError(error)) {
				deckReview$.errorMessage.set("Unable to load the review queue.");
			}
			applyUndoAvailability({
				isAvailable: false,
				knowledgeId: null,
			});
		}
		return null;
	} finally {
		if (
			requestId === reviewLoadRequestId &&
			deckReview$.targetType.peek() === targetType &&
			deckReview$.targetId.peek() === targetId
		) {
			deckReview$.isLoading.set(false);
			deckReview$.isRefreshingSession.set(false);
		}
	}
};

export const loadDeckReviewSession = async ({
	db,
	deckId,
	languageId,
	showSpinner = false,
	indicateRefresh = false,
	resetProgressState = true,
	preserveVisibleCard = false,
}: {
	db: DrizzleInstance;
	deckId: string | null;
	languageId?: string | null;
	showSpinner?: boolean;
	indicateRefresh?: boolean;
	resetProgressState?: boolean;
	preserveVisibleCard?: boolean;
}) =>
	loadReviewSession({
		db,
		targetType: "deck",
		targetId: deckId,
		languageId,
		showSpinner,
		indicateRefresh,
		resetProgressState,
		preserveVisibleCard,
	}) as Promise<DeckReviewSession | null>;

export const loadFolderReviewSession = async ({
	db,
	folderId,
	languageId,
	showSpinner = false,
	indicateRefresh = false,
	resetProgressState = true,
	preserveVisibleCard = false,
}: {
	db: DrizzleInstance;
	folderId: string | null;
	languageId?: string | null;
	showSpinner?: boolean;
	indicateRefresh?: boolean;
	resetProgressState?: boolean;
	preserveVisibleCard?: boolean;
}) =>
	loadReviewSession({
		db,
		targetType: "folder",
		targetId: folderId,
		languageId,
		showSpinner,
		indicateRefresh,
		resetProgressState,
		preserveVisibleCard,
	}) as Promise<FolderReviewSession | null>;

export const loadDeckReviewPreview = async ({
	db,
	knowledgeId,
}: {
	db: DrizzleInstance;
	knowledgeId: string | null;
}) => {
	if (!knowledgeId) {
		deckReview$.preview.set(null);
		return null;
	}

	try {
		const result = await previewKnowledgeReview(db, knowledgeId);
		const currentCard = deckReview$.session.peek()?.cards[0] ?? null;
		if (currentCard?.knowledge.id === knowledgeId) {
			deckReview$.preview.set(result);
		}
		return result;
	} catch (error) {
		console.error("Failed to load review preview.", error);
		const currentCard = deckReview$.session.peek()?.cards[0] ?? null;
		if (currentCard?.knowledge.id === knowledgeId) {
			deckReview$.preview.set(null);
		}
		return null;
	}
};

const scheduleDeckReviewPreviewLoad = ({
	db,
	knowledgeId,
}: {
	db: DrizzleInstance;
	knowledgeId: string | null;
}) => {
	deckReview$.preview.set(null);
	if (!knowledgeId) {
		return;
	}

	void loadDeckReviewPreview({
		db,
		knowledgeId,
	});
};

// Refill the 10-card session bucket only when it runs low instead of after
// every grade — the full queue rebuild walks the whole due backlog and is the
// main source of frame drops while advancing to the next card.
const REVIEW_SESSION_REFILL_THRESHOLD = 3;

const applyReviewToDecksStore = async ({
	db,
	knowledgeId,
	fallbackDeckId,
	result,
}: {
	db: DrizzleInstance;
	knowledgeId: string;
	fallbackDeckId: string;
	result: NonNullable<Awaited<ReturnType<typeof submitKnowledgeReview>>>;
}) => {
	try {
		const rows = await db
			.select({ deckId: cards.deckId })
			.from(cards)
			.where(and(eq(cards.knowledgeId, knowledgeId), eq(cards.deleted, false)));
		const affectedDeckIds =
			rows.length > 0
				? [...new Set(rows.map((row) => row.deckId))]
				: [fallbackDeckId];
		decks$.applyKnowledgeReview({
			previousDue: result.previousDue,
			nextDue: result.nextDue,
			reviewedAt: formatStoredDateTime(result.log.review),
			affectedDeckIds,
		});
	} catch (error) {
		console.error("Failed to apply review to decks store.", error);
	}
};

const decrementReviewedProgress = ({ wasNew }: { wasNew: boolean }) => {
	deckReview$.reviewedCount.set(Math.max(0, deckReview$.reviewedCount.peek() - 1));
	if (wasNew) {
		deckReview$.reviewedNewCount.set(
			Math.max(0, deckReview$.reviewedNewCount.peek() - 1),
		);
	}
};

export const submitDeckReviewRating = async ({
	db,
	rating,
}: {
	db: DrizzleInstance;
	rating: ReviewGrade;
}) => {
	const currentCard = deckReview$.session.peek()?.cards[0] ?? null;
	const targetType = deckReview$.targetType.peek();
	const targetId = deckReview$.targetId.peek();
	const languageId = deckReview$.languageId.peek();
	if (!currentCard || !targetType || !targetId || deckReview$.isSubmitting.peek()) {
		return null;
	}

	deckReview$.isSubmitting.set(true);
	deckReview$.errorMessage.set(null);
	deckReview$.undoErrorMessage.set(null);

	try {
		const durationMs = timedKnowledgeId === currentCard.knowledge.id && cardShownAt > 0
			? Math.max(0, Date.now() - cardShownAt)
			: null;
		const result = await submitKnowledgeReview(db, {
			knowledgeId: currentCard.knowledge.id,
			rating,
			durationMs,
		});

		if (!result) {
			throw new Error("Review submission returned no result.");
		}

		const currentSession = deckReview$.session.peek();
		let remainingCardCount = 0;
		if (currentSession) {
			const nextCards = currentSession.cards.slice(1);
			remainingCardCount = nextCards.length;
			const nextDueCount = Math.max(currentSession.dueCount - 1, 0);
			deckReview$.session.set({
				...currentSession,
				cards: nextCards,
				dueCount: nextDueCount,
				totalCards: nextDueCount,
			});
			startCardTimer(nextCards[0]?.knowledge.id ?? null);
			scheduleDeckReviewPreviewLoad({
				db,
				knowledgeId: nextCards[0]?.knowledge.id ?? null,
			});
		}

		deckReview$.reviewedCount.set(deckReview$.reviewedCount.peek() + 1);
		deckReview$.reviewedNewCount.set(
			deckReview$.reviewedNewCount.peek() + (currentCard.knowledge.state === "New" ? 1 : 0),
		);
		deckReview$.isAnswerVisible.set(false);
		deckReview$.preview.set(null);
		deckReview$.lastUndoContext.set({
			knowledgeId: currentCard.knowledge.id,
			deckId: currentCard.deckId,
			wasNew: currentCard.knowledge.state === "New",
			targetType,
			targetId,
			languageId,
		});
		deckReview$.canUndoPreviousReview.set(true);
		deckReview$.undoKnowledgeId.set(currentCard.knowledge.id);

		scheduleBackgroundTask(() => {
			void applyReviewToDecksStore({
				db,
				knowledgeId: currentCard.knowledge.id,
				fallbackDeckId: currentCard.deckId,
				result,
			});

			if (remainingCardCount > REVIEW_SESSION_REFILL_THRESHOLD) {
				return;
			}

			void loadReviewSession({
				db,
				targetType,
				targetId,
				languageId,
				showSpinner: false,
				indicateRefresh: true,
				resetProgressState: false,
				preserveVisibleCard: true,
			});
			void refreshDecksStore(db, languageId ?? undefined).catch((error) => {
				console.error("Failed to refresh decks store after review submit.", error);
			});
		});

		return result;
	} catch (error) {
		console.error("Failed to submit review.", error);
		deckReview$.errorMessage.set("Unable to save that review.");
		return null;
	} finally {
		deckReview$.isSubmitting.set(false);
	}
};

export const undoPreviousDeckReview = async ({
	db,
}: {
	db: DrizzleInstance;
}) => {
	const targetType = deckReview$.targetType.peek();
	const targetId = deckReview$.targetId.peek();
	const languageId = deckReview$.languageId.peek();

	if (
		!targetType ||
		!targetId ||
		deckReview$.isUndoing.peek() ||
		deckReview$.isSubmitting.peek()
	) {
		return null;
	}

	deckReview$.isUndoing.set(true);
	deckReview$.undoErrorMessage.set(null);
	deckReview$.errorMessage.set(null);

	try {
		const sessionUndoContext = deckReview$.lastUndoContext.peek();
		const result = await undoPreviousReview({
			db,
			targetType,
			targetId,
		});

		if (result.status !== "undone") {
			deckReview$.undoErrorMessage.set("Nothing to undo in this review.");
			await loadUndoAvailability({
				db,
				targetType,
				targetId,
			});
			return result;
		}

		await refreshDecksStore(db, languageId ?? undefined);

		const canPreserveProgress =
			sessionUndoContext?.knowledgeId === result.knowledgeId &&
			sessionUndoContext.targetType === targetType &&
			sessionUndoContext.targetId === targetId &&
			sessionUndoContext.languageId === languageId;

		if (canPreserveProgress && sessionUndoContext) {
			decrementReviewedProgress({
				wasNew: sessionUndoContext.wasNew,
			});
			deckReview$.lastUndoContext.set(null);
			await loadReviewSession({
				db,
				targetType,
				targetId,
				languageId,
				showSpinner: false,
				indicateRefresh: false,
				resetProgressState: false,
			});
		} else {
			resetProgress();
			await loadReviewSession({
				db,
				targetType,
				targetId,
				languageId,
				showSpinner: false,
				indicateRefresh: false,
				resetProgressState: true,
			});
		}

		await loadUndoAvailability({
			db,
			targetType,
			targetId,
		});

		return result;
	} catch (error) {
		console.error("Failed to undo review.", error);
		deckReview$.undoErrorMessage.set("Unable to undo that review.");
		return null;
	} finally {
		deckReview$.isUndoing.set(false);
	}
};

export const revealDeckReviewAnswer = () => {
	deckReview$.isAnswerVisible.set(true);
};

export const useDeckReviewSession = ({
	db,
	deckId,
	languageId,
}: {
	db: DrizzleInstance;
	deckId: string | null;
	languageId?: string | null;
}) => {
	const state = useSelector(() => {
		const targetType = deckReview$.targetType.get();
		const targetId = deckReview$.targetId.get();
		const currentLanguageId = deckReview$.languageId.get();
		const rawSession = deckReview$.session.get();
		const hasMatchingTarget =
			targetType === "deck" &&
			targetId === deckId &&
			currentLanguageId === (languageId ?? null) &&
			rawSession?.target.type === "deck" &&
			rawSession.target.id === deckId;
		const session = hasMatchingTarget ? rawSession : null;
		const baseIsLoading = deckReview$.isLoading.get();
		const reviewedCount = deckReview$.reviewedCount.get();
		const currentCard = session?.cards[0] ?? null;
		const dueCount = session?.dueCount ?? 0;
		const reviewCount = reviewedCount + dueCount;
		const remainingCount = currentCard ? Math.max(dueCount - 1, 0) : 0;

		return {
			targetType,
			targetId,
			languageId: currentLanguageId,
			hasMatchingTarget,
			session,
			isLoading: baseIsLoading || (deckId !== null && !hasMatchingTarget),
			isAnswerVisible: deckReview$.isAnswerVisible.get(),
			preview: deckReview$.preview.get(),
			isSubmitting: deckReview$.isSubmitting.get(),
			isUndoing: deckReview$.isUndoing.get(),
			isRefreshingSession: deckReview$.isRefreshingSession.get(),
			reviewedCount,
			errorMessage: deckReview$.errorMessage.get(),
			undoErrorMessage: deckReview$.undoErrorMessage.get(),
			canUndoPreviousReview: deckReview$.canUndoPreviousReview.get(),
			reviewIndex: reviewedCount,
			currentCard,
			reviewCount,
			remainingCount,
			isFinished: Boolean(session) && dueCount === 0,
		};
	});

	React.useEffect(() => {
		const shouldLoad =
			state.targetType !== "deck" ||
			state.targetId !== deckId ||
			state.languageId !== (languageId ?? null) ||
			(state.session === null && !state.isLoading);

		if (shouldLoad) {
			void loadDeckReviewSession({
				db,
				deckId,
				languageId,
				showSpinner: false,
				indicateRefresh: false,
				resetProgressState: true,
			});
		}
	}, [db, deckId, languageId, state.isLoading, state.languageId, state.session, state.targetId, state.targetType]);

	const reload = React.useCallback(
		async ({
			showSpinner = false,
			indicateRefresh = false,
			resetProgressState = true,
			preserveVisibleCard = false,
		}: {
			showSpinner?: boolean;
			indicateRefresh?: boolean;
			resetProgressState?: boolean;
			preserveVisibleCard?: boolean;
		} = {}) =>
			loadDeckReviewSession({
				db,
				deckId,
				languageId,
				showSpinner,
				indicateRefresh,
				resetProgressState,
				preserveVisibleCard,
			}),
		[db, deckId, languageId],
	);

	const revealAnswer = React.useCallback(() => {
		revealDeckReviewAnswer();
	}, []);

	const submitRating = React.useCallback(
		async (rating: ReviewGrade) => submitDeckReviewRating({ db, rating }),
		[db],
	);

	const undoPrevious = React.useCallback(
		async () => undoPreviousDeckReview({ db }),
		[db],
	);

	return {
		...state,
		session: state.session as DeckReviewSession | null,
		reload,
		revealAnswer,
		submitRating,
		undoPrevious,
	};
};

export const useFolderReviewSession = ({
	db,
	folderId,
	languageId,
}: {
	db: DrizzleInstance;
	folderId: string | null;
	languageId?: string | null;
}) => {
	const state = useSelector(() => {
		const targetType = deckReview$.targetType.get();
		const targetId = deckReview$.targetId.get();
		const currentLanguageId = deckReview$.languageId.get();
		const rawSession = deckReview$.session.get();
		const hasMatchingTarget =
			targetType === "folder" &&
			targetId === folderId &&
			currentLanguageId === (languageId ?? null) &&
			rawSession?.target.type === "folder" &&
			rawSession.target.id === folderId;
		const session = hasMatchingTarget ? rawSession : null;
		const baseIsLoading = deckReview$.isLoading.get();
		const reviewedCount = deckReview$.reviewedCount.get();
		const currentCard = session?.cards[0] ?? null;
		const dueCount = session?.dueCount ?? 0;
		const reviewCount = reviewedCount + dueCount;
		const remainingCount = currentCard ? Math.max(dueCount - 1, 0) : 0;

		return {
			targetType,
			targetId,
			languageId: currentLanguageId,
			hasMatchingTarget,
			session,
			isLoading: baseIsLoading || (folderId !== null && !hasMatchingTarget),
			isAnswerVisible: deckReview$.isAnswerVisible.get(),
			preview: deckReview$.preview.get(),
			isSubmitting: deckReview$.isSubmitting.get(),
			isUndoing: deckReview$.isUndoing.get(),
			isRefreshingSession: deckReview$.isRefreshingSession.get(),
			reviewedCount,
			errorMessage: deckReview$.errorMessage.get(),
			undoErrorMessage: deckReview$.undoErrorMessage.get(),
			canUndoPreviousReview: deckReview$.canUndoPreviousReview.get(),
			reviewIndex: reviewedCount,
			currentCard,
			reviewCount,
			remainingCount,
			isFinished: Boolean(session) && dueCount === 0,
		};
	});

	React.useEffect(() => {
		const shouldLoad =
			state.targetType !== "folder" ||
			state.targetId !== folderId ||
			state.languageId !== (languageId ?? null) ||
			(state.session === null && !state.isLoading);

		if (shouldLoad) {
			void loadFolderReviewSession({
				db,
				folderId,
				languageId,
				showSpinner: false,
				indicateRefresh: false,
				resetProgressState: true,
			});
		}
	}, [db, folderId, languageId, state.isLoading, state.languageId, state.session, state.targetId, state.targetType]);

	const reload = React.useCallback(
		async ({
			showSpinner = false,
			indicateRefresh = false,
			resetProgressState = true,
			preserveVisibleCard = false,
		}: {
			showSpinner?: boolean;
			indicateRefresh?: boolean;
			resetProgressState?: boolean;
			preserveVisibleCard?: boolean;
		} = {}) =>
			loadFolderReviewSession({
				db,
				folderId,
				languageId,
				showSpinner,
				indicateRefresh,
				resetProgressState,
				preserveVisibleCard,
			}),
		[db, folderId, languageId],
	);

	const revealAnswer = React.useCallback(() => {
		revealDeckReviewAnswer();
	}, []);

	const submitRating = React.useCallback(
		async (rating: ReviewGrade) => submitDeckReviewRating({ db, rating }),
		[db],
	);

	const undoPrevious = React.useCallback(
		async () => undoPreviousDeckReview({ db }),
		[db],
	);

	return {
		...state,
		session: state.session as FolderReviewSession | null,
		reload,
		revealAnswer,
		submitRating,
		undoPrevious,
	};
};
