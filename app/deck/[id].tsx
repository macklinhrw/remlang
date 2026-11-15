import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import { useSelector } from "@legendapp/state/react";
import { Alert, ScrollView, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ReviewLimitEditor } from "@/components/review/review-limit-editor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { type ReviewType } from "@/lib/database/schema";
import { getKnowledgeRoute } from "@/lib/knowledge/routes";
import { getReviewTypeLabel } from "@/lib/review/fsrs";
import {
	getDeckReviewLimitSettings,
	normalizeReviewLimitSettings,
	type ReviewLimitSettings,
} from "@/lib/review/reviewLimits";
import { useAppLanguage } from "@/lib/store/appLanguageStore";
import {
	getDeckDetail,
	type DeckCardListItem,
	type DeckDetailResult,
	decks$,
	refreshDecksStore,
	setDeckNewCardsPaused,
	setDeckReviewLimits,
	trashDeck,
} from "@/lib/store/decksStore";
import {
	ChevronRight,
	ExternalLink,
	Link2,
	Play,
	Search,
	Trash2,
} from "lucide-react-native";

const CARD_PAGE_SIZE = 20;

const firstDefinitionLine = (value: string | null | undefined) =>
	value?.split("\n").map((line) => line.trim()).find(Boolean) ?? null;

export default function DeckDetailPage() {
	const router = useRouter();
	const drizzle = useDrizzle();
	const { id, backToDeckId } = useLocalSearchParams<{
		id?: string;
		backToDeckId?: string;
	}>();
	const { activeLanguageId } = useAppLanguage();
	const deckStoreRevision = useSelector(() => decks$.revision.get());
	const [deck, setDeck] = useState<DeckDetailResult | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isDeleting, setIsDeleting] = useState(false);
	const [activeTab, setActiveTab] = useState<"cards" | "settings">("cards");
	const [cardSearchQuery, setCardSearchQuery] = useState("");
	const [cardPage, setCardPage] = useState(1);
	const [reviewLimitSettings, setReviewLimitSettings] =
		useState<ReviewLimitSettings>(normalizeReviewLimitSettings());
	const [isSavingReviewLimits, setIsSavingReviewLimits] = useState(false);
	const [isTogglingNewCardsPaused, setIsTogglingNewCardsPaused] = useState(false);
	const hasObservedRevisionRef = useRef(false);

	const loadDeck = useCallback(
		({ showSpinner = true }: { showSpinner?: boolean } = {}) => {
			let cancelled = false;

			const fetchDeck = async () => {
				if (!id) {
					if (!cancelled) {
						setDeck(null);
						setIsLoading(false);
					}
					return;
				}

				if (showSpinner) {
					setIsLoading(true);
				}
				const result = await getDeckDetail(drizzle, id, activeLanguageId);
				if (!cancelled) {
					setDeck(result);
					setIsLoading(false);
				}
			};

			void fetchDeck();

			return () => {
				cancelled = true;
			};
		},
		[activeLanguageId, drizzle, id],
	);

	useFocusEffect(
		useCallback(() => loadDeck({ showSpinner: true }), [loadDeck]),
	);

	useEffect(() => {
		if (!hasObservedRevisionRef.current) {
			hasObservedRevisionRef.current = true;
			return;
		}

		if (!id) {
			return;
		}

		const cleanup = loadDeck({ showSpinner: false });
		return cleanup;
	}, [deckStoreRevision, id, loadDeck]);

	const sourceReviewType = deck?.sourceReviewType ?? null;
	const normalizedCardSearchQuery = cardSearchQuery.trim().toLowerCase();
	const filteredCards = useMemo(() => {
		if (!deck) {
			return [];
		}
		if (!normalizedCardSearchQuery) {
			return deck.cards;
		}

		return deck.cards.filter((card) => {
			const front = card.knowledge?.front?.toLowerCase() ?? "";
			const pronunciation = card.knowledge?.pronunciation?.toLowerCase() ?? "";
			const definitions = card.knowledge?.definitions?.toLowerCase() ?? "";
			return (
				front.includes(normalizedCardSearchQuery) ||
				pronunciation.includes(normalizedCardSearchQuery) ||
				definitions.includes(normalizedCardSearchQuery)
			);
		});
	}, [deck, normalizedCardSearchQuery]);
	const totalPages = Math.max(1, Math.ceil(filteredCards.length / CARD_PAGE_SIZE));
	const currentCardPage = Math.min(cardPage, totalPages);
	const visibleCards = useMemo(() => {
		const start = (currentCardPage - 1) * CARD_PAGE_SIZE;
		return filteredCards.slice(start, start + CARD_PAGE_SIZE);
	}, [currentCardPage, filteredCards]);

	useEffect(() => {
		setCardPage(1);
	}, [normalizedCardSearchQuery]);

	useEffect(() => {
		setCardPage((current) => Math.min(current, totalPages));
	}, [totalPages]);

	useEffect(() => {
		if (!deck) {
			setReviewLimitSettings(normalizeReviewLimitSettings());
			return;
		}

		setReviewLimitSettings(getDeckReviewLimitSettings(deck));
	}, [
		deck,
		deck?.id,
		deck?.dailyNewLimitEnabled,
		deck?.dailyNewLimit,
		deck?.dailyReviewLimitEnabled,
		deck?.dailyReviewLimit,
	]);

	const normalizedReviewLimitSettings = useMemo(
		() => normalizeReviewLimitSettings(reviewLimitSettings),
		[reviewLimitSettings],
	);
	const savedReviewLimitSettings = useMemo(
		() => (deck ? getDeckReviewLimitSettings(deck) : normalizeReviewLimitSettings()),
		[deck],
	);
	const hasReviewLimitChanges =
		normalizedReviewLimitSettings.newLimitEnabled !== savedReviewLimitSettings.newLimitEnabled ||
		normalizedReviewLimitSettings.newLimit !== savedReviewLimitSettings.newLimit ||
		normalizedReviewLimitSettings.totalLimitEnabled !==
			savedReviewLimitSettings.totalLimitEnabled ||
		normalizedReviewLimitSettings.totalLimit !== savedReviewLimitSettings.totalLimit;

	const runTrashDeck = useCallback(async () => {
		if (!deck || isDeleting) {
			return;
		}

		setIsDeleting(true);
		try {
			const result = await trashDeck(drizzle, deck.id);
			await refreshDecksStore(drizzle, activeLanguageId);

			if (result.status === "trashed" || result.status === "already_deleted") {
				router.replace("/decks");
				return;
			}

			Alert.alert("Deck not found", "This deck is no longer available.");
			router.replace("/decks");
		} catch (error) {
			console.error("Failed to trash deck.", error);
			Alert.alert("Delete failed", "The deck could not be moved to Trash.");
		} finally {
			setIsDeleting(false);
		}
	}, [activeLanguageId, deck, drizzle, isDeleting, router]);

	const handleDeletePress = useCallback(() => {
		if (!deck || isDeleting) {
			return;
		}

		Alert.alert(
			`Delete "${deck.name}"?`,
			deck.role === "primary" && deck.linkedDecks.length > 0
				? "This moves the primary deck and all linked decks to Trash."
				: "This moves the deck and its cards to Trash.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Delete",
					style: "destructive",
					onPress: () => {
						void runTrashDeck();
					},
				},
			],
		);
	}, [deck, isDeleting, runTrashDeck]);

	const handleSaveReviewLimits = useCallback(async () => {
		if (!deck || deck.role === "linked" || isSavingReviewLimits) {
			return;
		}

		setIsSavingReviewLimits(true);
		try {
			const result = await setDeckReviewLimits(drizzle, {
				deckId: deck.id,
				newLimitEnabled: normalizedReviewLimitSettings.newLimitEnabled,
				newLimit: normalizedReviewLimitSettings.newLimit,
				totalLimitEnabled: normalizedReviewLimitSettings.totalLimitEnabled,
				totalLimit: normalizedReviewLimitSettings.totalLimit,
			});

			if (result.status === "managed_by_primary") {
				Alert.alert(
					"Use the primary deck",
					"Linked decks inherit review behavior from their primary deck.",
				);
				return;
			}

			if (result.status === "missing_deck") {
				Alert.alert("Deck not found", "This deck is no longer available.");
				return;
			}

			await refreshDecksStore(drizzle, activeLanguageId);
			Alert.alert("Saved", "Daily review limits were updated.");
		} catch (error) {
			console.error("Failed to save deck review limits.", error);
			Alert.alert("Save failed", "The deck review limits could not be updated.");
		} finally {
			setIsSavingReviewLimits(false);
		}
	}, [
		activeLanguageId,
		deck,
		drizzle,
		isSavingReviewLimits,
		normalizedReviewLimitSettings.newLimit,
		normalizedReviewLimitSettings.newLimitEnabled,
		normalizedReviewLimitSettings.totalLimit,
		normalizedReviewLimitSettings.totalLimitEnabled,
	]);

	const handleToggleNewCardsPaused = useCallback(async () => {
		if (!deck || deck.role === "linked" || isTogglingNewCardsPaused) {
			return;
		}

		setIsTogglingNewCardsPaused(true);
		try {
			const result = await setDeckNewCardsPaused(drizzle, {
				deckId: deck.id,
				paused: !Boolean(deck.newCardsPaused),
			});

			if (result.status === "managed_by_primary") {
				Alert.alert(
					"Use the primary deck",
					"Linked decks inherit review behavior from their primary deck.",
				);
				return;
			}

			if (result.status === "missing_deck") {
				Alert.alert("Deck not found", "This deck is no longer available.");
				return;
			}

			await refreshDecksStore(drizzle, activeLanguageId);
		} catch (error) {
			console.error("Failed to toggle new cards pause.", error);
			Alert.alert("Update failed", "The deck new-card setting could not be updated.");
		} finally {
			setIsTogglingNewCardsPaused(false);
		}
	}, [activeLanguageId, deck, drizzle, isTogglingNewCardsPaused]);

	if (isLoading) {
		return (
			<View className="flex-1 items-center justify-center bg-[#0F1012]">
				<Text className="text-zinc-400">Loading deck...</Text>
			</View>
		);
	}

	if (!deck) {
		return (
			<View className="flex-1 items-center justify-center gap-3 bg-[#0F1012] p-4">
				<Text className="text-zinc-100">Deck not found.</Text>
				<TouchableOpacity
					activeOpacity={0.85}
					className="rounded-2xl border border-white/8 bg-[#141518] px-4 py-3"
					onPress={() => router.replace("/decks")}
				>
					<Text className="font-medium text-zinc-200">Back to decks</Text>
				</TouchableOpacity>
			</View>
		);
	}

	return (
		<ScrollView className="flex-1 bg-[#0F1012]" contentContainerClassName="px-3 pb-4 pt-3">
			<View className="border-b border-white/8 pb-2.5">
				<View className="flex-row items-center justify-between gap-2">
					<View className="min-w-0 flex-1">
						<View className="flex-row items-center gap-2">
							<Text className="text-sm font-semibold text-zinc-100" numberOfLines={1}>
								{deck.name}
							</Text>
							<Text className="text-xs text-zinc-500">
								{deck.cardCount} {deck.cardCount === 1 ? "card" : "cards"}
							</Text>
						</View>
						<View className="mt-1 flex-row flex-wrap gap-1.5">
							{deck.role === "linked" ? (
								<HeaderPill label="Linked" tone="linked" />
							) : deck.role === "primary" ? (
								<HeaderPill label="Primary" tone="primary" />
							) : null}
							{deck.newCardsPaused ? (
								<HeaderPill label="Paused" tone="linked" />
							) : null}
							{deck.role === "primary" && sourceReviewType ? (
								<HeaderPill
									label={getReviewTypeLabel(sourceReviewType as ReviewType)}
									tone="primary"
								/>
							) : null}
						</View>
					</View>
					<TouchableOpacity
						activeOpacity={0.85}
						className="h-11 w-11 items-center justify-center rounded-xl border border-white/8 bg-[#141518]"
						onPress={() => router.push(`/deck/${deck.id}/review`)}
					>
						<Play size={18} color="#fafafa" fill="#fafafa" />
					</TouchableOpacity>
				</View>
			</View>

			<View className="mt-3 rounded-xl border border-white/8 bg-[#121315] p-1">
				<View className="flex-row gap-1">
					<TouchableOpacity
						activeOpacity={0.85}
						className={[
							"flex-1 rounded-lg px-3 py-2",
							activeTab === "cards" ? "bg-zinc-100" : "bg-transparent",
						].join(" ")}
						onPress={() => setActiveTab("cards")}
					>
						<Text
							className={[
								"text-center text-sm font-medium",
								activeTab === "cards" ? "text-zinc-900" : "text-zinc-400",
							].join(" ")}
						>
							Cards
						</Text>
					</TouchableOpacity>
					<TouchableOpacity
						activeOpacity={0.85}
						className={[
							"flex-1 rounded-lg px-3 py-2",
							activeTab === "settings" ? "bg-zinc-100" : "bg-transparent",
						].join(" ")}
						onPress={() => setActiveTab("settings")}
					>
						<Text
							className={[
								"text-center text-sm font-medium",
								activeTab === "settings" ? "text-zinc-900" : "text-zinc-400",
							].join(" ")}
						>
							Settings
						</Text>
					</TouchableOpacity>
				</View>
			</View>

			{activeTab === "cards" ? (
				<View className="mt-3 gap-2">
					<View className="flex-row items-center gap-2 rounded-xl border border-white/8 bg-[#141518] px-3">
						<Search size={14} color="#71717a" />
						<Input
							value={cardSearchQuery}
							onChangeText={setCardSearchQuery}
							placeholder="Search cards..."
							placeholderTextColor="#52525b"
							className="h-10 flex-1 border-0 bg-transparent px-0 text-sm text-zinc-100"
						/>
						<Text className="text-xs text-zinc-500">
							{filteredCards.length}
						</Text>
					</View>
					{deck.cards.length === 0 ? (
						<View className="rounded-xl border border-white/8 bg-[#121315] px-3 py-3">
							<Text className="text-sm font-medium text-zinc-100">No cards yet</Text>
							<Text className="mt-0.5 text-xs text-zinc-500">
								Add entries from the dictionary to start building this deck.
							</Text>
						</View>
					) : filteredCards.length === 0 ? (
						<View className="rounded-xl border border-white/8 bg-[#121315] px-3 py-3">
							<Text className="text-sm font-medium text-zinc-100">No matching cards</Text>
							<Text className="mt-0.5 text-xs text-zinc-500">
								Try a different search term.
							</Text>
						</View>
					) : (
						<View className="gap-2">
							<View className="gap-1.5">
								{visibleCards.map((card) => (
									<DeckCardRow key={card.id} card={card} deckId={deck.id} />
								))}
							</View>
							{totalPages > 1 ? (
								<View className="flex-row items-center justify-between gap-2">
									<Text className="text-xs text-zinc-500">
										{currentCardPage}/{totalPages}
									</Text>
									<View className="flex-row gap-1.5">
										<PaginationButton
											label="«"
											disabled={currentCardPage === 1}
											onPress={() => setCardPage(1)}
										/>
										<PaginationButton
											label="‹"
											disabled={currentCardPage === 1}
											onPress={() =>
												setCardPage((current) => Math.max(1, current - 1))
											}
										/>
										<PaginationButton
											label="›"
											disabled={currentCardPage === totalPages}
											onPress={() =>
												setCardPage((current) => Math.min(totalPages, current + 1))
											}
										/>
										<PaginationButton
											label="»"
											disabled={currentCardPage === totalPages}
											onPress={() => setCardPage(totalPages)}
										/>
									</View>
								</View>
							) : null}
						</View>
					)}
				</View>
			) : deck.role === "linked" && deck.primaryDeck ? (
				<View className="mt-3 rounded-xl border border-sky-400/20 bg-sky-400/[0.08] px-3 py-3">
					<Text className="text-sm font-medium text-zinc-100">
						Managed by primary deck
					</Text>
					<Text className="mt-1 text-xs leading-4 text-zinc-300">
						Content comes from {deck.primaryDeck.name}
						{deck.primaryDeck.sourceReviewType
							? ` (${getReviewTypeLabel(deck.primaryDeck.sourceReviewType as ReviewType)})`
							: ""}.
					</Text>
					<View className="mt-3 flex-row gap-1.5">
						{backToDeckId ? (
							<Button
								onPress={() => router.replace(`/deck/${backToDeckId}`)}
								className="h-10 flex-1 rounded-xl border border-white/12 bg-[#17191c]"
							>
								<Text className="text-sm text-zinc-100">Back</Text>
							</Button>
						) : null}
						<Button
							onPress={() => router.push(`/deck/${deck.primaryDeck?.id}`)}
							className="h-10 flex-1 rounded-xl bg-sky-100"
						>
							<View className="flex-row items-center gap-1.5">
								<ExternalLink size={14} color="#111827" />
								<Text className="text-sm text-slate-900">Primary Deck</Text>
							</View>
						</Button>
					</View>
				</View>
			) : (
				<View className="mt-3 gap-2">
					<View className="rounded-xl border border-white/8 bg-[#121315] px-3 py-2.5">
						<View className="flex-row items-center justify-between">
							<View className="min-w-0 flex-1">
								<Text className="text-sm font-medium text-zinc-100">New Cards</Text>
								<Text className="mt-0.5 text-xs text-zinc-400">
									{deck.newCardsPaused ? "Currently paused" : "Currently active"}
								</Text>
							</View>
							<Button
								onPress={() => void handleToggleNewCardsPaused()}
								disabled={isTogglingNewCardsPaused}
								className="h-9 rounded-xl border border-white/8 bg-[#17191c] px-3"
							>
								<Text className="text-sm text-zinc-100">
									{isTogglingNewCardsPaused
										? "..."
										: deck.newCardsPaused
											? "Resume"
											: "Pause"}
								</Text>
							</Button>
						</View>
					</View>

					<View className="rounded-xl border border-white/8 bg-[#121315] p-2.5">
						<Text className="text-sm font-medium text-zinc-100">
							Daily Review Limits
						</Text>
						<Text className="mt-0.5 text-xs text-zinc-400">
							Enforced before folder and global limits.
						</Text>
						<View className="mt-2.5">
							<ReviewLimitEditor
								value={reviewLimitSettings}
								onChange={setReviewLimitSettings}
							/>
						</View>
						<Button
							onPress={() => void handleSaveReviewLimits()}
							disabled={!hasReviewLimitChanges || isSavingReviewLimits}
							className="mt-2.5 h-10 rounded-xl bg-zinc-100 disabled:bg-zinc-700"
						>
							<Text className="text-sm text-zinc-900">
								{isSavingReviewLimits ? "Saving..." : "Save limits"}
							</Text>
						</Button>
					</View>

					<View className="rounded-xl border border-white/8 bg-[#121315] p-2.5">
						<View className="flex-row items-center gap-2.5">
							<View className="rounded-xl border border-white/8 bg-[#17191c] p-2">
								<Link2 size={16} color="#E5E7EB" />
							</View>
							<View className="min-w-0 flex-1">
								<Text className="text-sm font-semibold text-zinc-100">
									Linked Decks
								</Text>
								<Text className="mt-0.5 text-xs text-zinc-400">
									{sourceReviewType
										? `Source: ${getReviewTypeLabel(sourceReviewType as ReviewType)}`
										: "No source type set"}
								</Text>
							</View>
						</View>

						{deck.linkedDecks.length > 0 ? (
							<View className="mt-2.5 gap-1.5">
								{deck.linkedDecks.map((linkedDeck) => (
									<TouchableOpacity
										key={linkedDeck.id}
										activeOpacity={0.85}
										className="rounded-lg border border-white/8 bg-[#17191c] px-3 py-2.5"
										onPress={() =>
											router.push(
												`/deck/${linkedDeck.id}?backToDeckId=${encodeURIComponent(deck.id)}`,
											)
										}
									>
										<View className="flex-row items-center justify-between gap-2">
											<View className="min-w-0 flex-1">
												<Text className="text-sm font-medium text-zinc-100">
													{linkedDeck.name}
												</Text>
												<Text className="text-xs text-zinc-500">
													{getReviewTypeLabel(linkedDeck.targetReviewType as ReviewType)} · {linkedDeck.cardCount} cards
												</Text>
											</View>
											<ChevronRight size={14} color="#71717a" />
										</View>
									</TouchableOpacity>
								))}
							</View>
						) : (
							<Text className="mt-2.5 text-xs text-zinc-500">
								No linked decks yet.
							</Text>
						)}

						<Button
							onPress={() => router.push(`/deck/${deck.id}/create-linked-deck`)}
							className="mt-2.5 h-10 rounded-xl bg-zinc-100"
						>
							<View className="flex-row items-center gap-1.5">
								<Link2 size={14} color="#111827" />
								<Text className="text-sm text-zinc-900">Create linked deck</Text>
							</View>
						</Button>
					</View>

					<TouchableOpacity
						activeOpacity={0.85}
						className="flex-row items-center gap-2.5 rounded-xl border border-red-500/20 bg-red-500/[0.05] px-3 py-3"
						onPress={handleDeletePress}
						disabled={isDeleting}
					>
						<Trash2 size={16} color="#FCA5A5" />
						<Text className="text-sm text-red-200">
							{isDeleting ? "Deleting..." : "Delete deck"}
						</Text>
					</TouchableOpacity>
				</View>
			)}
		</ScrollView>
	);
}

const HeaderPill = ({
	label,
	tone,
}: {
	label: string;
	tone: "neutral" | "primary" | "linked";
}) => (
	<View
		className={[
			"rounded-md border px-2 py-0.5",
			tone === "neutral"
				? "border-white/8 bg-[#121315]"
				: tone === "primary"
					? "border-emerald-400/20 bg-emerald-400/[0.08]"
					: "border-sky-400/20 bg-sky-400/[0.08]",
		].join(" ")}
	>
		<Text
			className={[
				"text-[10px] font-medium uppercase tracking-[0.1em]",
				tone === "neutral"
					? "text-zinc-400"
					: tone === "primary"
						? "text-emerald-200"
						: "text-sky-200",
			].join(" ")}
		>
			{label}
		</Text>
	</View>
);

const DeckCardRow = ({
	card,
	deckId,
}: {
	card: DeckCardListItem;
	deckId: string;
}) => {
	const router = useRouter();
	const definitionPreview = firstDefinitionLine(card.knowledge?.definitions);

	const handlePress = () => {
		if (!card.knowledge?.id) return;
		router.push(
			getKnowledgeRoute(card.knowledge.id, {
				cardId: card.id,
				deckId,
				originPath: `/deck/${deckId}`,
			}),
		);
	};

	return (
		<TouchableOpacity
			activeOpacity={card.knowledge?.id ? 0.8 : 1}
			className="rounded-xl border border-white/8 bg-[#121315] px-3 py-2.5"
			onPress={handlePress}
			disabled={!card.knowledge?.id}
		>
			<View className="flex-row items-center justify-between gap-2">
				<View className="min-w-0 flex-1 gap-0.5">
					<Text className="text-sm font-semibold text-zinc-100" numberOfLines={1}>
						{card.knowledge?.front ?? "Untitled card"}
					</Text>
					<View className="flex-row flex-wrap items-center gap-x-2">
						{card.knowledge?.pronunciation ? (
							<Text className="text-xs text-zinc-400">
								{card.knowledge.pronunciation}
							</Text>
						) : null}
						{definitionPreview ? (
							<Text className="text-xs text-zinc-500" numberOfLines={1}>
								{definitionPreview}
							</Text>
						) : null}
					</View>
				</View>
				{card.knowledge?.id ? (
					<ChevronRight size={14} color="#71717a" />
				) : null}
			</View>
		</TouchableOpacity>
	);
};

const PaginationButton = ({
	label,
	disabled,
	onPress,
}: {
	label: string;
	disabled: boolean;
	onPress: () => void;
}) => (
	<TouchableOpacity
		activeOpacity={0.85}
		className={[
			"h-9 w-9 items-center justify-center rounded-lg border",
			disabled
				? "border-white/8 bg-[#17191c] opacity-40"
				: "border-white/12 bg-[#17191c]",
		].join(" ")}
		onPress={onPress}
		disabled={disabled}
	>
		<Text className="text-base text-zinc-100">{label}</Text>
	</TouchableOpacity>
);
