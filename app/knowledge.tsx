import { useCallback, useEffect, useMemo, useState } from "react";
import {
	ActivityIndicator,
	Alert,
	ScrollView,
	TouchableOpacity,
	View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import {
	ChevronLeft,
	ChevronRight,
	ChevronsLeft,
	ChevronsRight,
	Search,
	Trash2,
} from "lucide-react-native";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { getKnowledgeRoute } from "@/lib/knowledge/routes";
import {
	getDanglingKnowledgeCount,
	getKnowledgeBrowserPage,
	trashDanglingKnowledge,
	type KnowledgeBrowserPage,
} from "@/lib/store/knowledgeStore";
import { useAppLanguage } from "@/lib/store/appLanguageStore";

const PAGE_SIZE = 25;

const firstDefinitionLine = (value: string | null | undefined) =>
	value?.split("\n").map((line) => line.trim()).find(Boolean) ?? null;

const reviewTypeLabel = (value: string) => {
	switch (value) {
		case "Back-Front":
			return "Back-Front";
		case "Pitch":
			return "Pitch";
		case "Stroke":
			return "Stroke";
		default:
			return "Front-Back";
	}
};

export default function KnowledgePage() {
	const router = useRouter();
	const drizzle = useDrizzle();
	const { activeLanguageId } = useAppLanguage();
	const [pageData, setPageData] = useState<KnowledgeBrowserPage | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isPurgingDangling, setIsPurgingDangling] = useState(false);
	const [searchInput, setSearchInput] = useState("");
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(1);
	const [danglingCount, setDanglingCount] = useState(0);

	useEffect(() => {
		const timeout = setTimeout(() => {
			setQuery(searchInput.trim());
			setPage(1);
		}, 250);

		return () => clearTimeout(timeout);
	}, [searchInput]);

	const loadPage = useCallback(async () => {
		setIsLoading(true);
		try {
			const [result, nextDanglingCount] = await Promise.all([
				getKnowledgeBrowserPage(drizzle, {
					languageId: activeLanguageId,
					query,
					page,
					pageSize: PAGE_SIZE,
				}),
				getDanglingKnowledgeCount(drizzle, activeLanguageId),
			]);
			setPageData(result);
			setDanglingCount(nextDanglingCount);
		} finally {
			setIsLoading(false);
		}
	}, [activeLanguageId, drizzle, page, query]);

	useFocusEffect(
		useCallback(() => {
			void loadPage();
		}, [loadPage]),
	);

	const totalCount = pageData?.totalCount ?? 0;
	const rangeStart = totalCount === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
	const rangeEnd = pageData
		? Math.min(totalCount, (page - 1) * PAGE_SIZE + pageData.items.length)
		: 0;
	const lastPage = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
	const hasPreviousPage = page > 1;
	const hasNextPage = Boolean(pageData && page * PAGE_SIZE < totalCount);
	const summaryText = useMemo(() => {
		if (totalCount === 0) return "No results";
		return `${rangeStart}-${rangeEnd} of ${totalCount}`;
	}, [rangeEnd, rangeStart, totalCount]);

	const handleTrashDangling = useCallback(() => {
		if (danglingCount === 0 || isPurgingDangling) {
			return;
		}

		Alert.alert(
			"Trash dangling knowledge?",
			`This moves ${danglingCount} knowledge row${danglingCount === 1 ? "" : "s"} with no attached cards to Trash for the active language.`,
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Trash",
					style: "destructive",
					onPress: () => {
						void (async () => {
							setIsPurgingDangling(true);
							try {
								await trashDanglingKnowledge(drizzle, {
									languageId: activeLanguageId,
								});
								setPage(1);
								await loadPage();
							} finally {
								setIsPurgingDangling(false);
							}
						})();
					},
				},
			],
		);
	}, [activeLanguageId, danglingCount, drizzle, isPurgingDangling, loadPage]);

	return (
		<View className="flex-1 bg-[#0F1012]">
			<View className="gap-2.5 px-4 pt-3">
				<View>
					<Text className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
						Shared Study Data
					</Text>
					<Text className="mt-0.5 text-lg font-semibold text-zinc-100">Knowledge</Text>
				</View>

				<View className="flex-row items-center rounded-2xl border border-white/8 bg-[#141518] px-3">
					<Search size={18} color="#71717A" />
					<Input
						value={searchInput}
						onChangeText={setSearchInput}
						placeholder="Search front, reading, or definitions"
						className="flex-1 border-0 bg-transparent px-3 py-3 text-base text-zinc-100"
						placeholderTextColor="#71717a"
					/>
				</View>

				<View className="flex-row items-center justify-between pb-2">
					<View className="gap-1">
						<Text className="text-xs text-zinc-500">{summaryText}</Text>
						<View className="flex-row items-center gap-1.5">
							<Text className="text-[11px] text-zinc-600">
								{danglingCount} dangling{danglingCount === 1 ? "" : "s"}
							</Text>
							<TouchableOpacity
								activeOpacity={0.85}
								onPress={handleTrashDangling}
								disabled={danglingCount === 0 || isLoading || isPurgingDangling}
								className="h-8 w-8 items-center justify-center rounded-lg border border-red-500/20 bg-red-500/[0.08]"
								style={
									danglingCount === 0 || isLoading || isPurgingDangling
										? { opacity: 0.35 }
										: undefined
								}
							>
								<Trash2 size={14} color="#FCA5A5" />
							</TouchableOpacity>
						</View>
					</View>
					{lastPage > 1 && (
						<View className="flex-row items-center gap-2">
							<Text className="text-xs text-zinc-500">Page {page}/{lastPage}</Text>
							<View className="flex-row gap-1">
								<PaginationButton
									disabled={!hasPreviousPage || isLoading}
									onPress={() => setPage(1)}
								>
									<ChevronsLeft size={15} color="#A1A1AA" />
								</PaginationButton>
								<PaginationButton
									disabled={!hasPreviousPage || isLoading}
									onPress={() => setPage((c) => Math.max(1, c - 1))}
								>
									<ChevronLeft size={15} color="#A1A1AA" />
								</PaginationButton>
								<PaginationButton
									disabled={!hasNextPage || isLoading}
									onPress={() => setPage((c) => c + 1)}
								>
									<ChevronRight size={15} color="#A1A1AA" />
								</PaginationButton>
								<PaginationButton
									disabled={!hasNextPage || isLoading}
									onPress={() => setPage(lastPage)}
								>
									<ChevronsRight size={15} color="#A1A1AA" />
								</PaginationButton>
							</View>
						</View>
					)}
				</View>
			</View>

			{isLoading ? (
				<View className="flex-1 items-center justify-center">
					<ActivityIndicator color="#71717A" />
				</View>
			) : (
				<ScrollView
					className="flex-1"
					contentContainerClassName="gap-1.5 px-3 pb-6 pt-1"
					showsVerticalScrollIndicator={false}
				>
					{pageData?.items.length ? (
						pageData.items.map((item) => {
							const definition = firstDefinitionLine(item.definitions);
							return (
								<TouchableOpacity
									key={item.id}
									activeOpacity={0.85}
									className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2.5"
									onPress={() => router.push(getKnowledgeRoute(item.id))}
								>
									<View className="flex-row items-center justify-between gap-2">
										<View className="min-w-0 flex-1 gap-0.5">
											<View className="flex-row flex-wrap items-center gap-x-2">
												<Text className="text-sm font-semibold leading-5 text-zinc-100" numberOfLines={1}>
													{item.front}
												</Text>
												{item.pronunciation ? (
													<Text className="text-sm text-zinc-400" numberOfLines={1}>
														{item.pronunciation}
													</Text>
												) : null}
											</View>
											{definition ? (
												<Text className="text-xs leading-4 text-zinc-400" numberOfLines={1}>
													{definition}
												</Text>
											) : null}
											<View className="mt-1 flex-row flex-wrap items-center gap-x-2">
												<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
													{reviewTypeLabel(item.reviewType)}
												</Text>
												{item.configLabel ? (
													<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-200">
														{item.configLabel}
													</Text>
												) : null}
												{item.suspended ? (
													<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-amber-200">
														Suspended
													</Text>
												) : null}
												<Text className="text-[10px] text-zinc-600">
													{item.linkedCardCount} card{item.linkedCardCount === 1 ? "" : "s"} · {item.linkedDeckCount} deck{item.linkedDeckCount === 1 ? "" : "s"}
												</Text>
											</View>
										</View>
										<ChevronRight size={14} color="#52525B" />
									</View>
								</TouchableOpacity>
							);
						})
					) : (
						<View className="items-center justify-center rounded-2xl border border-dashed border-white/8 bg-[#121315] px-4 py-10">
							<Text className="text-sm text-zinc-500">
								{query
									? "No results for this search."
									: "Knowledge appears here once it is backing cards in your decks."}
							</Text>
						</View>
					)}
				</ScrollView>
			)}
		</View>
	);
}

const PaginationButton = ({
	disabled,
	onPress,
	children,
}: {
	disabled: boolean;
	onPress: () => void;
	children: React.ReactNode;
}) => (
	<TouchableOpacity
		activeOpacity={0.85}
		disabled={disabled}
		onPress={onPress}
		className="h-10 w-10 items-center justify-center rounded-xl border border-white/8 bg-[#17191c]"
		style={disabled ? { opacity: 0.35 } : undefined}
	>
		{children}
	</TouchableOpacity>
);
