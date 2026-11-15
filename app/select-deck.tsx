import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, ScrollView, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { Computed } from "@legendapp/state/react";
import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import { ArrowLeft, Layers3, Plus, Search } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { Input } from "@/components/ui/input";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { type KnowledgeDefinitionConfig } from "@/lib/knowledge/config";
import { type ReviewType } from "@/lib/database/schema";
import { normalizeVisibleReviewType } from "@/lib/review/reviewTypeConfig";
import {
	addEntryToDeck,
	type DeckListItem,
	type DecksResult,
	decks$,
	refreshDecksStore,
} from "@/lib/store/decksStore";
import { useAppLanguage } from "@/lib/store/appLanguageStore";

export default function SelectDeckPage() {
	const router = useRouter();
	const navigation = useNavigation();
	const drizzle = useDrizzle();
	const { entryId, config: configParam, reviewType: reviewTypeParam } = useLocalSearchParams<{
		entryId?: string;
		config?: string;
		reviewType?: string;
	}>();
	const { activeLanguageId } = useAppLanguage();
	const [searchQuery, setSearchQuery] = useState("");

	const config = useMemo<KnowledgeDefinitionConfig | null>(() => {
		if (!configParam) return null;
		try {
			return JSON.parse(configParam) as KnowledgeDefinitionConfig;
		} catch {
			return null;
		}
	}, [configParam]);

	const reviewType = normalizeVisibleReviewType(reviewTypeParam) as ReviewType;
	const canAdd = Boolean(entryId) && Boolean(config) && (config?.selectedGlossKeys.length ?? 0) > 0;

	const handleBack = useCallback(() => {
		if (!entryId) {
			router.back();
			return;
		}

		const configQuery = configParam
			? `&config=${encodeURIComponent(configParam)}`
			: "";
		router.replace(
			`/select-card-type?entryId=${encodeURIComponent(entryId)}${configQuery}`,
		);
	}, [configParam, entryId, router]);

	useEffect(() => {
		const fetch = async () => {
			await refreshDecksStore(drizzle, activeLanguageId);
		};
		void fetch();
	}, [activeLanguageId, drizzle]);

	useEffect(() => {
		navigation.setOptions({
			headerLeft: () => (
				<TouchableOpacity
					activeOpacity={0.85}
					className="ml-4 h-10 w-10 items-center justify-center rounded-2xl border border-white/8 bg-[#141518]"
					onPress={handleBack}
				>
					<ArrowLeft size={18} color="#fafafa" />
				</TouchableOpacity>
			),
		});
	}, [handleBack, navigation]);

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

	return (
		<View className="flex-1 bg-[#0F1012]">
			<ScrollView
				className="flex-1"
				contentContainerClassName="px-4 pb-5 pt-3"
				showsVerticalScrollIndicator={false}
				keyboardShouldPersistTaps="handled"
			>
				<View className="border-b border-white/8 pb-4">
					<View className="flex-row items-start justify-between gap-3">
						<View className="min-w-0 flex-1">
							<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
								Step 3 of 3
							</Text>
							<Text className="mt-2 text-[28px] font-semibold leading-8 text-zinc-100">
								Choose Deck
							</Text>
						</View>
						<TouchableOpacity
							activeOpacity={0.85}
							className="h-11 w-11 items-center justify-center rounded-2xl border border-white/8 bg-[#141518]"
							onPress={() => router.push("/create-deck")}
						>
							<Plus size={18} color="#fafafa" />
						</TouchableOpacity>
					</View>

					<Text className="mt-3 text-sm leading-5 text-zinc-400">
						Pick a deck to add this knowledge card to.
					</Text>
				</View>

				<View className="mt-4">
					<View className="flex-row items-center gap-3 rounded-2xl border border-white/8 bg-[#141518] px-3.5">
						<Search size={16} color="#71717a" />
						<Input
							value={searchQuery}
							onChangeText={setSearchQuery}
							placeholder="Search decks..."
							placeholderTextColor="#52525b"
							className="h-11 flex-1 border-0 bg-transparent px-0 text-base text-zinc-100"
						/>
					</View>
				</View>

				<View className="mt-4">
					<Computed>
						{() => (
							<InnerDecksPage
								decksResult={decks$.decks.get()}
								entryId={entryId}
								config={config}
								canAdd={canAdd}
								searchQuery={searchQuery}
								reviewType={reviewType}
							/>
						)}
					</Computed>
				</View>
			</ScrollView>
		</View>
	);
}

const InnerDecksPage = ({
	decksResult,
	entryId,
	config,
	canAdd,
	searchQuery,
	reviewType,
}: {
	decksResult: DecksResult;
	entryId?: string;
	config: KnowledgeDefinitionConfig | null;
	canAdd: boolean;
	searchQuery: string;
	reviewType: ReviewType;
}) => {
	const filteredDecks = useMemo(() => {
		if (!searchQuery.trim()) return decksResult;
		const query = searchQuery.toLowerCase().trim();
		return decksResult.filter((deck) => deck.name.toLowerCase().includes(query));
	}, [decksResult, searchQuery]);

	return (
		<View className="gap-3">
			<View className="flex-row items-center justify-between">
				<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
					{searchQuery.trim()
						? `${filteredDecks.length} result${filteredDecks.length === 1 ? "" : "s"}`
						: `${decksResult.length} deck${decksResult.length === 1 ? "" : "s"}`}
				</Text>
			</View>
			{filteredDecks.length === 0 ? (
				<View className="rounded-[24px] border border-white/8 bg-[#121315] px-4 py-4">
					<Text className="text-base font-medium text-zinc-100">
						{searchQuery.trim() ? "No matching decks" : "No decks yet"}
					</Text>
					<Text className="mt-1 text-sm leading-5 text-zinc-500">
						{searchQuery.trim()
							? "Try a different search, or create a new deck."
							: "Create a deck first, then return here to add this entry."}
					</Text>
				</View>
			) : (
				<View className="gap-2">
					{filteredDecks.map((deck) => (
						<DeckComponent
							key={deck.id}
							deck={deck}
							entryId={entryId}
							config={config}
							canAdd={canAdd}
							reviewType={reviewType}
						/>
					))}
				</View>
			)}
		</View>
	);
};

const DeckComponent = ({
	deck,
	entryId,
	config,
	canAdd,
	reviewType,
}: {
	deck: DeckListItem;
	entryId?: string;
	config: KnowledgeDefinitionConfig | null;
	canAdd: boolean;
	reviewType: ReviewType;
}) => {
	const drizzle = useDrizzle();
	const [status, setStatus] = useState<string | null>(null);
	const [isSubmitting, setIsSubmitting] = useState(false);

	const handleAdd = async () => {
		if (!entryId || !config || isSubmitting) return;
		setIsSubmitting(true);
		const result = await addEntryToDeck(drizzle, {
			deckId: deck.id,
			entryId,
			config,
			reviewType,
		});

		if (result.status === "added") {
			setStatus(`Added ${result.configLabel ? `· ${result.configLabel}` : ""}`.trim());
			await refreshDecksStore(drizzle, deck.languageId ?? undefined);
		} else if (result.status === "exists") {
			setStatus(
				`Already in deck${result.configLabel ? ` · ${result.configLabel}` : ""}`,
			);
		} else if (result.status === "language_mismatch") {
			setStatus("Wrong language");
		} else if (result.status === "managed_by_primary") {
			setStatus("Use primary deck");
		} else if (result.status === "stroke_not_supported") {
			setStatus("No Han characters");
		} else if (result.status === "pitch_not_supported") {
			setStatus("No pitch accent");
		} else {
			setStatus("Unavailable");
		}

		setIsSubmitting(false);
	};

	return (
		<View className="rounded-[24px] border border-white/8 bg-[#121315] px-4 py-3.5">
			<View className="flex-row items-center gap-3">
				<View className="h-10 w-10 items-center justify-center rounded-2xl bg-[#17191c]">
					<Layers3 size={18} color="#a1a1aa" />
				</View>
				<View className="min-w-0 flex-1 gap-0.5">
					<Text className="text-[17px] font-medium leading-6 text-zinc-100">
						{deck.name}
					</Text>
					<View className="flex-row flex-wrap items-center gap-2">
						<Text className="text-sm text-zinc-500">
							{deck.cardCount} {deck.cardCount === 1 ? "card" : "cards"}
						</Text>
						{deck.primaryDeckId ? (
							<Text className="text-xs uppercase tracking-[0.12em] text-sky-200">
								Linked
							</Text>
						) : deck.sourceReviewType ? (
							<Text className="text-xs uppercase tracking-[0.12em] text-emerald-200">
								Primary
							</Text>
						) : null}
					</View>
				</View>
				<TouchableOpacity
					activeOpacity={0.85}
					className="h-10 min-w-[72px] items-center justify-center rounded-2xl bg-zinc-100 px-4 disabled:opacity-50"
					onPress={handleAdd}
					disabled={!entryId || !canAdd || isSubmitting || Boolean(deck.primaryDeckId)}
				>
					<Text className="text-sm font-medium text-zinc-900">
						{deck.primaryDeckId ? "Locked" : isSubmitting ? "Adding" : "Add"}
					</Text>
				</TouchableOpacity>
			</View>
			{status ? (
				<Text className="mt-2 pl-[52px] text-xs uppercase tracking-[0.14em] text-zinc-500">
					{status}
				</Text>
			) : null}
		</View>
	);
};
