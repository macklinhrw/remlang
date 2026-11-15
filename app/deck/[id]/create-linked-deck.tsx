import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert, BackHandler, ScrollView, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowLeft, Check, Link2 } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { Button } from "@/components/ui/button";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { getEntryDetail } from "@/lib/database/lexicon";
import { type ReviewType } from "@/lib/database/schema";
import { getReviewTypeLabel } from "@/lib/review/fsrs";
import { hasPitchAccentReviewSupport } from "@/lib/review/pitchEligibility";
import {
	DEFAULT_REVIEW_TYPE,
	VISIBLE_REVIEW_TYPES,
	normalizeVisibleReviewType,
} from "@/lib/review/reviewTypeConfig";
import {
	createLinkedDeck,
	getDeckDetail,
	refreshDecksStore,
	setDeckSourceReviewType,
	type DeckDetailResult,
} from "@/lib/store/decksStore";
import { useAppLanguage } from "@/lib/store/appLanguageStore";

export default function CreateLinkedDeckPage() {
	const router = useRouter();
	const drizzle = useDrizzle();
	const { id } = useLocalSearchParams<{ id?: string }>();
	const { activeLanguageId } = useAppLanguage();
	const [deck, setDeck] = useState<DeckDetailResult | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [selectedSourceType, setSelectedSourceType] =
		useState<ReviewType>(DEFAULT_REVIEW_TYPE);
	const [creatingTargetType, setCreatingTargetType] = useState<string | null>(null);
	const [isSavingSourceType, setIsSavingSourceType] = useState(false);
	const [supportsPitchTarget, setSupportsPitchTarget] = useState(false);

	const loadDeck = useCallback(async () => {
		if (!id) {
			setDeck(null);
			setIsLoading(false);
			return;
		}

		setIsLoading(true);
		const result = await getDeckDetail(drizzle, id, activeLanguageId);
		setDeck(result);
		setSelectedSourceType(normalizeVisibleReviewType(result?.sourceReviewType));
		setIsLoading(false);
	}, [activeLanguageId, drizzle, id]);

	useEffect(() => {
		void loadDeck();
	}, [loadDeck]);

	useEffect(() => {
		let cancelled = false;

		const loadPitchTargetSupport = async () => {
			if (!deck || deck.role === "linked") {
				setSupportsPitchTarget(false);
				return;
			}

			const sourceCards = deck.cards.filter((card) => {
				const sourceKnowledge = card.knowledge;
				return (
					Boolean(sourceKnowledge) &&
					!card.deleted &&
					!sourceKnowledge!.deleted &&
					sourceKnowledge!.reviewType === selectedSourceType
				);
			});

			if (sourceCards.length === 0) {
				setSupportsPitchTarget(false);
				return;
			}

			for (const sourceCard of sourceCards) {
				const entryId = sourceCard.knowledge?.entryId;
				if (!entryId) {
					continue;
				}

				const entry = await getEntryDetail(drizzle, entryId);
				if (cancelled) {
					return;
				}

				if (hasPitchAccentReviewSupport(entry)) {
					setSupportsPitchTarget(true);
					return;
				}
			}

			if (!cancelled) {
				setSupportsPitchTarget(false);
			}
		};

		void loadPitchTargetSupport();

		return () => {
			cancelled = true;
		};
	}, [deck, drizzle, selectedSourceType]);

	const handleBack = useCallback(() => {
		if (id) {
			router.replace(`/deck/${id}`);
			return;
		}
		router.back();
	}, [id, router]);

	useFocusEffect(
		useCallback(() => {
			const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
				handleBack();
				return true;
			});
			return () => {
				subscription.remove();
			};
		}, [handleBack]),
	);

	const existingTargetTypes = useMemo(
		() => new Set(deck?.linkedDecks.map((item) => item.targetReviewType) ?? []),
		[deck?.linkedDecks],
	);
	const availableTargetTypes = useMemo(
		() =>
			VISIBLE_REVIEW_TYPES.filter(
				(type) =>
					type !== selectedSourceType &&
					!existingTargetTypes.has(type) &&
					(type !== "Pitch" || supportsPitchTarget),
			),
		[existingTargetTypes, selectedSourceType, supportsPitchTarget],
	);

	const handleCreateLinkedDeck = useCallback(
		async (targetReviewType: string) => {
			if (!deck || deck.role === "linked" || creatingTargetType) {
				return;
			}

			setCreatingTargetType(targetReviewType);
			try {
				if (deck.sourceReviewType !== selectedSourceType) {
					setIsSavingSourceType(true);
					await setDeckSourceReviewType(drizzle, {
						deckId: deck.id,
						sourceReviewType: selectedSourceType,
					});
					setIsSavingSourceType(false);
				}

				const result = await createLinkedDeck(drizzle, {
					primaryDeckId: deck.id,
					sourceReviewType: selectedSourceType,
					targetReviewType,
				});

				if (
					(result.status === "created" || result.status === "restored") &&
					result.linkedDeck
				) {
					await refreshDecksStore(drizzle, activeLanguageId);
					router.replace(
						`/deck/${result.linkedDeck.id}?backToDeckId=${encodeURIComponent(deck.id)}`,
					);
					return;
				}

				if (result.status === "exists" && result.linkedDeck) {
					await refreshDecksStore(drizzle, activeLanguageId);
					router.replace(
						`/deck/${result.linkedDeck.id}?backToDeckId=${encodeURIComponent(deck.id)}`,
					);
					return;
				}

				if (result.status === "managed_by_primary" && result.primaryDeckId) {
					router.replace(`/deck/${result.primaryDeckId}`);
					return;
				}

				if (result.status === "exists") {
					Alert.alert(
						"Linked deck already exists",
						"A linked deck for this review type already exists.",
					);
					return;
				}

				if (result.status === "same_review_type") {
					Alert.alert(
						"Choose another review type",
						"The linked deck review type must differ from the source review type.",
					);
					return;
				}

				if (result.status === "pitch_not_supported") {
					Alert.alert(
						"Pitch accent unavailable",
						"No cards in this source review type have Japanese pitch-accent data available for mirroring.",
					);
				}
			} finally {
				setIsSavingSourceType(false);
				setCreatingTargetType(null);
			}
		},
		[activeLanguageId, creatingTargetType, deck, drizzle, router, selectedSourceType],
	);

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
				<Button onPress={() => router.replace("/decks")} className="rounded-2xl bg-zinc-100">
					<Text className="text-zinc-900">Back to decks</Text>
				</Button>
			</View>
		);
	}

	if (deck.role === "linked") {
		return (
			<View className="flex-1 items-center justify-center gap-3 bg-[#0F1012] p-4">
				<Text className="text-zinc-100">Linked decks are managed by the primary deck.</Text>
				<Button
					onPress={() => router.replace(`/deck/${deck.primaryDeck?.id ?? deck.id}`)}
					className="rounded-2xl bg-zinc-100"
				>
					<Text className="text-zinc-900">Open primary deck</Text>
				</Button>
			</View>
		);
	}

	return (
		<View className="flex-1 bg-[#0F1012]">
			<ScrollView
				className="flex-1"
				contentContainerClassName="px-4 pb-5 pt-3"
				showsVerticalScrollIndicator={false}
			>
				<View className="border-b border-white/8 pb-4">
					<View className="flex-row items-start gap-3">
						<TouchableOpacity
							activeOpacity={0.85}
							className="h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-[#141518]"
							onPress={handleBack}
						>
							<ArrowLeft size={18} color="#fafafa" />
						</TouchableOpacity>
						<View className="min-w-0 flex-1">
							<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
								Linked Decks
							</Text>
							<Text className="mt-2 text-[28px] font-semibold leading-8 text-zinc-100">
								Create Linked Deck
							</Text>
							<Text className="mt-2 text-sm leading-5 text-zinc-400">
								Choose the source review type for {deck.name}, then create linked decks for the other card types.
							</Text>
						</View>
					</View>
				</View>

				<View className="mt-5 rounded-[24px] border border-white/8 bg-[#121315] px-4 py-4">
					<View className="flex-row items-center gap-3">
						<View className="rounded-2xl border border-white/8 bg-[#17191c] p-2.5">
							<Link2 size={18} color="#E5E7EB" />
						</View>
						<View className="min-w-0 flex-1">
							<Text className="text-base font-semibold text-zinc-100">
								Source Review Type
							</Text>
							<Text className="mt-0.5 text-sm leading-5 text-zinc-400">
								Only cards of this type will mirror into linked decks.
							</Text>
						</View>
					</View>

					<View className="mt-4 flex-row flex-wrap gap-2">
						{VISIBLE_REVIEW_TYPES.map((type) => {
							const selected = selectedSourceType === type;
							return (
								<TouchableOpacity
									key={type}
									activeOpacity={0.85}
									className={[
										"rounded-full border px-3 py-2",
										selected
											? "border-zinc-100 bg-zinc-100"
											: "border-white/8 bg-[#17191c]",
									].join(" ")}
									onPress={() => setSelectedSourceType(type)}
									disabled={Boolean(creatingTargetType) || isSavingSourceType}
								>
									<Text className={selected ? "text-zinc-900" : "text-zinc-200"}>
										{getReviewTypeLabel(type)}
									</Text>
								</TouchableOpacity>
							);
						})}
					</View>
				</View>

				<View className="mt-5 gap-2">
					<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
						Available Linked Decks
					</Text>
					{availableTargetTypes.length === 0 ? (
						<View className="rounded-2xl border border-white/8 bg-[#121315] px-4 py-4">
							<Text className="text-base font-medium text-zinc-100">
								Nothing left to create
							</Text>
							<Text className="mt-1 text-sm leading-5 text-zinc-500">
								Linked decks already exist for every other compatible review type.
							</Text>
						</View>
					) : (
						<View className="gap-2">
							{availableTargetTypes.map((type) => (
								<TouchableOpacity
									key={type}
									activeOpacity={0.85}
									className="rounded-2xl border border-white/8 bg-[#121315] px-4 py-4"
									onPress={() => void handleCreateLinkedDeck(type)}
									disabled={Boolean(creatingTargetType) || isSavingSourceType}
								>
									<View className="flex-row items-center gap-3">
										<View
											className={[
												"h-10 w-10 items-center justify-center rounded-2xl",
												creatingTargetType === type ? "bg-zinc-100" : "bg-[#17191c]",
											].join(" ")}
										>
											{creatingTargetType === type ? (
												<Check size={18} color="#111214" />
											) : (
												<Link2 size={18} color="#a1a1aa" />
											)}
										</View>
										<View className="min-w-0 flex-1">
											<Text className="text-base font-medium text-zinc-100">
												{creatingTargetType === type
													? "Creating..."
													: `Create ${getReviewTypeLabel(type)} linked deck`}
											</Text>
											<Text className="mt-1 text-sm leading-5 text-zinc-500">
												Mirror {getReviewTypeLabel(selectedSourceType)} cards from {deck.name} into a read-only {getReviewTypeLabel(type)} deck.
											</Text>
										</View>
									</View>
								</TouchableOpacity>
							))}
						</View>
					)}
				</View>
			</ScrollView>
		</View>
	);
}
