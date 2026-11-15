import { useCallback, useEffect, useState } from "react";
import {
	Alert,
	Modal,
	Pressable,
	ScrollView,
	View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { BookOpen, Copy, LoaderCircle } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { getPremadeBookLabel } from "@/lib/premadeDecks/types";
import { type ReviewType } from "@/lib/database/schema";
import {
	copyCachedPremadeDeckToExistingDeck,
	copyCachedPremadeDeckToLocalDeck,
	getCachedPremadeDeck,
	getCachedPremadeDeckItems,
} from "@/lib/premadeDecks/store";
import type { PremadeDeckItemRecord, PremadeDeckRecord } from "@/lib/premadeDecks/types";
import { getReviewTypeLabel } from "@/lib/review/fsrs";
import { DEFAULT_REVIEW_TYPE, VISIBLE_REVIEW_TYPES } from "@/lib/review/reviewTypeConfig";
import { getDecks, type DeckListItem, refreshDecksStore } from "@/lib/store/decksStore";
import { useAppLanguage } from "@/lib/store/appLanguageStore";

type CopyMode = "new" | "existing";

const getMatchBadge = (item: PremadeDeckItemRecord) => {
	if (!item.dictionaryEntryId) {
		return {
			label: "Custom",
			style: {
				borderColor: "rgba(251, 191, 36, 0.30)",
				backgroundColor: "rgba(251, 191, 36, 0.12)",
			},
			textColor: "#FDE68A",
		};
	}

	if (item.usesAllSenses) {
		return {
			label: "All senses",
			style: {
				borderColor: "rgba(56, 189, 248, 0.30)",
				backgroundColor: "rgba(56, 189, 248, 0.12)",
			},
			textColor: "#E0F2FE",
		};
	}

	return {
		label: "Exact",
		style: {
			borderColor: "rgba(52, 211, 153, 0.30)",
			backgroundColor: "rgba(52, 211, 153, 0.12)",
		},
		textColor: "#D1FAE5",
	};
};

export default function PremadeDeckDetailPage() {
	const router = useRouter();
	const navigation = useNavigation();
	const drizzle = useDrizzle();
	const { activeLanguageId } = useAppLanguage();
	const { id } = useLocalSearchParams<{ id?: string }>();
	const [deck, setDeck] = useState<PremadeDeckRecord | null>(null);
	const [items, setItems] = useState<PremadeDeckItemRecord[]>([]);
	const [isLoading, setIsLoading] = useState(true);
	const [copyModalVisible, setCopyModalVisible] = useState(false);
	const [copyMode, setCopyMode] = useState<CopyMode>("new");
	const [reviewType, setReviewType] = useState<ReviewType>(DEFAULT_REVIEW_TYPE);
	const [deckName, setDeckName] = useState("");
	const [existingDecks, setExistingDecks] = useState<DeckListItem[]>([]);
	const [selectedExistingDeckId, setSelectedExistingDeckId] = useState<string | null>(null);
	const [loadingExistingDecks, setLoadingExistingDecks] = useState(false);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const loadDeck = useCallback(async () => {
		if (!id) {
			setDeck(null);
			setItems([]);
			setIsLoading(false);
			return;
		}

		setIsLoading(true);
		try {
			const [cachedDeck, cachedItems] = await Promise.all([
				getCachedPremadeDeck(drizzle, id),
				getCachedPremadeDeckItems(drizzle, id),
			]);
			setDeck(cachedDeck);
			setItems(cachedItems);
			setDeckName(cachedDeck?.name ?? "");
		} finally {
			setIsLoading(false);
		}
	}, [drizzle, id]);

	const loadExistingDecks = useCallback(async () => {
		setLoadingExistingDecks(true);
		try {
			await refreshDecksStore(drizzle, activeLanguageId);
			const deckRows = await getDecks(drizzle, activeLanguageId);
			const eligibleDecks = deckRows.filter((item) => item.primaryDeckId === null);
			setExistingDecks(eligibleDecks);
			setSelectedExistingDeckId((current) =>
				current && eligibleDecks.some((item) => item.id === current)
					? current
					: eligibleDecks[0]?.id ?? null,
			);
		} finally {
			setLoadingExistingDecks(false);
		}
	}, [activeLanguageId, drizzle]);

	useEffect(() => {
		navigation.setOptions({
			title: deck?.name ?? "Premade Deck",
		});
	}, [deck?.name, navigation]);

	useFocusEffect(
		useCallback(() => {
			void loadDeck();
		}, [loadDeck]),
	);

	useEffect(() => {
		if (copyModalVisible) {
			void loadExistingDecks();
		}
	}, [copyModalVisible, loadExistingDecks]);

	const closeCopyModal = useCallback(() => {
		if (isSubmitting) {
			return;
		}
		setCopyModalVisible(false);
	}, [isSubmitting]);

	const openCopyModal = useCallback(() => {
		if (!deck) {
			return;
		}
		setDeckName(deck.name);
		setReviewType(DEFAULT_REVIEW_TYPE);
		setCopyMode("new");
		setCopyModalVisible(true);
	}, [deck]);

	const runCopy = useCallback(async () => {
		if (!deck || !id || isSubmitting) {
			return;
		}

		if (copyMode === "new" && !deckName.trim()) {
			Alert.alert("Deck name required", "Enter a name for the new local deck.");
			return;
		}

		if (copyMode === "existing" && !selectedExistingDeckId) {
			Alert.alert("Choose a deck", "Select an existing deck before copying.");
			return;
		}

		setIsSubmitting(true);
		try {
			const result =
				copyMode === "new"
					? await copyCachedPremadeDeckToLocalDeck({
							db: drizzle,
							premadeDeckId: id,
							reviewType,
							name: deckName,
						})
					: await copyCachedPremadeDeckToExistingDeck({
							db: drizzle,
							premadeDeckId: id,
							targetDeckId: selectedExistingDeckId!,
							reviewType,
						});

			if (result.status === "missing_premade_deck") {
				Alert.alert("Premade deck not found", "This premade deck is no longer available.");
				return;
			}

			if (result.status === "missing_target_deck") {
				Alert.alert("Deck not found", "The selected local deck is no longer available.");
				return;
			}

			if (result.status === "language_mismatch") {
				Alert.alert(
					"Language mismatch",
					"Choose a deck in the active language, or create a new one.",
				);
				return;
			}

			if (result.status === "managed_by_primary") {
				Alert.alert(
					"Use the primary deck",
					"Linked decks are managed by their primary deck.",
				);
				return;
			}

			if (result.status === "create_failed" || result.status === "copy_failed") {
				Alert.alert(
					"Copy failed",
					"The premade deck could not be copied into the selected deck.",
				);
				return;
			}

			setCopyModalVisible(false);
			const copySummary =
				result.skippedCount && result.skippedCount > 0
					? `${result.addedCount} added, ${result.existingCount} already existed, ${result.skippedCount} skipped for review compatibility.`
					: `${result.addedCount} added, ${result.existingCount} already existed.`;
			Alert.alert(
				"Premade copied",
				copySummary,
				[
					{
						text: "Stay here",
						style: "cancel",
					},
					{
						text: "Open deck",
						onPress: () => {
							router.push(`/deck/${result.deckId}`);
						},
					},
				],
			);
		} catch (error) {
			console.error("Failed to copy premade deck.", error);
			Alert.alert(
				"Copy failed",
				error instanceof Error
					? error.message
					: "The premade deck could not be copied.",
			);
		} finally {
			setIsSubmitting(false);
		}
	}, [
		copyMode,
		deck,
		deckName,
		drizzle,
		id,
		isSubmitting,
		reviewType,
		router,
		selectedExistingDeckId,
	]);

	return (
		<View className="flex-1 bg-[#0F1012]">
			<ScrollView
				className="flex-1"
				contentContainerClassName="px-3 pb-24 pt-3"
				showsVerticalScrollIndicator={false}
			>
				{isLoading ? (
					<View className="rounded-xl border border-white/10 bg-[#111214] px-3 py-3">
						<View className="flex-row items-center gap-2.5">
							<LoaderCircle size={16} color="#E4E4E7" />
							<Text className="text-sm font-medium text-zinc-100">
								Loading premade deck...
							</Text>
						</View>
					</View>
				) : !deck ? (
					<View className="rounded-xl border border-white/10 bg-[#111214] px-3 py-3">
						<Text className="text-sm font-semibold text-zinc-100">
							Premade deck not found
						</Text>
						<Text className="mt-0.5 text-xs text-zinc-400">
							This premade deck is not available in the local cache.
						</Text>
					</View>
				) : (
					<>
						<View className="border-b border-white/8 pb-2.5">
							<View className="flex-row items-center gap-2.5">
								<View className="rounded-xl border border-white/8 bg-white/[0.04] p-2">
									<BookOpen size={16} color="#E4E4E7" />
								</View>
								<View className="min-w-0 flex-1">
									<View className="flex-row items-center gap-2">
										<Text className="text-sm font-semibold text-zinc-100" numberOfLines={1}>
											{deck.name}
										</Text>
										<Text className="text-xs text-zinc-500">
											{items.length} {items.length === 1 ? "item" : "items"}
										</Text>
									</View>
									<Text className="mt-0.5 text-xs text-zinc-400">
										{getPremadeBookLabel(deck.book)}
									</Text>
								</View>
							</View>
						</View>

						<View className="mt-2 gap-1.5">
							{items.map((item) => {
								const badge = getMatchBadge(item);
								return (
									<View
										key={item.id}
										className="rounded-xl border border-white/8 bg-[#141518] px-3 py-2.5"
									>
										<View className="flex-row items-center justify-between gap-2">
											<View className="min-w-0 flex-1 gap-0.5">
												<Text className="text-sm font-semibold text-zinc-100">
													{item.front}
												</Text>
												{item.pronunciation ? (
													<Text className="text-xs text-zinc-400">
														{item.pronunciation}
													</Text>
												) : null}
											</View>
											<View
												className="rounded-md border px-2 py-0.5"
												style={badge.style}
											>
												<Text
													className="text-[10px] font-medium uppercase tracking-[0.1em]"
													style={{ color: badge.textColor }}
												>
													{badge.label}
												</Text>
											</View>
										</View>
										{item.sourceDefinitions ? (
											<Text className="mt-1.5 text-xs leading-4 text-zinc-300">
												{item.sourceDefinitions}
											</Text>
										) : null}
									</View>
								);
							})}
						</View>
					</>
				)}
			</ScrollView>

			{deck ? (
				<View className="absolute inset-x-0 bottom-0 border-t border-white/8 bg-[#0F1012] px-3 pb-4 pt-2.5">
					<Button
						onPress={openCopyModal}
						disabled={isLoading}
						className="h-10 rounded-xl bg-zinc-100"
					>
						<View className="flex-row items-center gap-1.5">
							<Copy size={14} color="#111827" />
							<Text className="text-sm font-medium text-zinc-900">Copy to My Decks</Text>
						</View>
					</Button>
				</View>
			) : null}

			<Modal
				transparent
				visible={copyModalVisible}
				animationType="fade"
				onRequestClose={closeCopyModal}
			>
				<View className="flex-1 items-center justify-center bg-black/60 px-4">
					<View className="max-h-[85%] w-full rounded-xl border border-white/10 bg-[#111214] p-3">
							<ScrollView showsVerticalScrollIndicator={false}>
								<Text className="text-sm font-semibold text-zinc-100">
									Copy deck: {deck?.name}
								</Text>

							<View className="mt-3 gap-1.5">
								<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
									Destination
								</Text>
								{([
									{
										id: "new" as const,
										title: "Create new deck",
									},
									{
										id: "existing" as const,
										title: "Copy into existing deck",
									},
								] as const).map((option) => {
									const isSelected = copyMode === option.id;
									return (
										<Pressable
											key={option.id}
											onPress={() => setCopyMode(option.id)}
											className={`rounded-lg border px-3 py-2.5 ${
												isSelected
													? "border-white/12 bg-white/[0.06]"
													: "border-white/8 bg-[#17181B]"
											}`}
										>
											<Text className="text-sm font-medium text-zinc-100">
												{option.title}
											</Text>
										</Pressable>
									);
								})}
							</View>

							{copyMode === "new" ? (
								<View className="mt-3 gap-1.5">
									<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
										New deck name
									</Text>
									<Input
										value={deckName}
										onChangeText={setDeckName}
										placeholder="Premade deck name"
										placeholderTextColor="#71717a"
										className="rounded-lg border border-white/8 bg-[#17181B] px-3 py-2.5 text-sm text-zinc-100"
									/>
								</View>
							) : (
								<View className="mt-3 gap-1.5">
									<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
										Choose local deck
									</Text>
									{loadingExistingDecks ? (
										<View className="rounded-lg border border-white/8 bg-[#17181B] px-3 py-2.5">
											<View className="flex-row items-center gap-2">
												<LoaderCircle size={14} color="#E4E4E7" />
												<Text className="text-xs text-zinc-300">
													Loading local decks...
												</Text>
											</View>
										</View>
									) : existingDecks.length === 0 ? (
										<View className="rounded-lg border border-white/8 bg-[#17181B] px-3 py-2.5">
											<Text className="text-xs text-zinc-400">
												No eligible local decks. Create a new deck instead.
											</Text>
										</View>
									) : (
										existingDecks.map((item) => {
											const isSelected = item.id === selectedExistingDeckId;
											return (
												<Pressable
													key={item.id}
													onPress={() => setSelectedExistingDeckId(item.id)}
													className={`rounded-lg border px-3 py-2.5 ${
														isSelected
															? "border-white/12 bg-white/[0.06]"
															: "border-white/8 bg-[#17181B]"
													}`}
												>
													<Text className="text-sm font-medium text-zinc-100">
														{item.name}
													</Text>
													<Text className="mt-0.5 text-xs text-zinc-500">
														{item.cardCount} {item.cardCount === 1 ? "card" : "cards"}
													</Text>
												</Pressable>
											);
										})
									)}
								</View>
							)}

							<View className="mt-3 gap-1.5">
								<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
									Review type
								</Text>
								<View className="gap-1.5">
									{VISIBLE_REVIEW_TYPES.map((type) => {
										const isSelected = reviewType === type;
										return (
											<Pressable
												key={type}
												onPress={() => setReviewType(type)}
												className={`rounded-lg border px-3 py-2.5 ${
													isSelected
														? "border-white/12 bg-white/[0.06]"
														: "border-white/8 bg-[#17181B]"
												}`}
											>
												<Text className="text-sm font-medium text-zinc-100">
													{getReviewTypeLabel(type)}
												</Text>
											</Pressable>
										);
									})}
								</View>
							</View>
						</ScrollView>

						<View className="mt-3 flex-row gap-1.5">
							<Button
								onPress={closeCopyModal}
								disabled={isSubmitting}
								variant="secondary"
								className="h-10 flex-1 rounded-xl border border-white/8 bg-[#17181B]"
							>
								<Text className="text-sm font-medium text-zinc-200">Cancel</Text>
							</Button>
							<Button
								onPress={() => void runCopy()}
								disabled={
									isSubmitting ||
									(copyMode === "existing" &&
										(existingDecks.length === 0 || !selectedExistingDeckId))
								}
								className="h-10 flex-1 rounded-xl bg-zinc-100"
							>
								<Text className="text-sm font-medium text-zinc-900">
									{isSubmitting ? "Copying..." : "Copy deck"}
								</Text>
							</Button>
						</View>
					</View>
				</View>
			</Modal>
		</View>
	);
}
