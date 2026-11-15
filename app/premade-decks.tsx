import { useCallback, useEffect, useRef, useState } from "react";
import { Alert, InteractionManager, Modal, Pressable, ScrollView, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useRouter } from "expo-router";
import {
	BookCopy,
	BookOpen,
	ChevronDown,
	ChevronRight,
	LoaderCircle,
	RefreshCcw,
} from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useAccount } from "@/lib/auth/account";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { type ReviewType } from "@/lib/database/schema";
import {
	copyCachedPremadeCollectionToLocalFolder,
	getCachedPremadeBooks,
	getPremadeSyncStateSnapshot,
	refreshPremadeDeckCache,
	type CachedPremadeBookListItem,
	type PremadeCollectionCopyProgress,
	type PremadeSyncStateSnapshot,
} from "@/lib/premadeDecks/store";
import { getReviewTypeLabel } from "@/lib/review/fsrs";
import { DEFAULT_REVIEW_TYPE, VISIBLE_REVIEW_TYPES } from "@/lib/review/reviewTypeConfig";
import { useAppLanguage } from "@/lib/store/appLanguageStore";

const formatTimestamp = (value: string | null | undefined) => {
	if (!value) return "Not yet";

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return parsed.toLocaleString();
};

const yieldToEventLoop = () =>
	new Promise<void>((resolve) => {
		setTimeout(resolve, 0);
	});

const formatCollectionCopyProgress = (progress: PremadeCollectionCopyProgress | null) => {
	if (!progress) {
		return null;
	}

	return `${progress.label} ${progress.current}/${progress.total}`;
};

export default function PremadeDecksPage() {
	const router = useRouter();
	const drizzle = useDrizzle();
	const { activeLanguageId } = useAppLanguage();
	const { isSignedIn, getToken } = useAccount();
	const [premadeCollections, setPremadeCollections] = useState<CachedPremadeBookListItem[]>([]);
	const [syncState, setSyncState] = useState<PremadeSyncStateSnapshot | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const isRefreshingRef = useRef(false);
	const [refreshError, setRefreshError] = useState<string | null>(null);
	const [selectedCollection, setSelectedCollection] = useState<CachedPremadeBookListItem | null>(null);
	const [copyModalVisible, setCopyModalVisible] = useState(false);
	const [reviewType, setReviewType] = useState<ReviewType>(DEFAULT_REVIEW_TYPE);
	const [folderName, setFolderName] = useState("");
	const [isCopyingCollection, setIsCopyingCollection] = useState(false);
	const [copyProgress, setCopyProgress] = useState<PremadeCollectionCopyProgress | null>(null);
	const [expandedCollections, setExpandedCollections] = useState<Record<string, boolean>>({});

	const loadCachedState = useCallback(async () => {
		const [cachedBooks, cachedSyncState] = await Promise.all([
			getCachedPremadeBooks(drizzle, activeLanguageId),
			getPremadeSyncStateSnapshot(drizzle, activeLanguageId),
		]);
		setPremadeCollections(cachedBooks);
		setSyncState(cachedSyncState);
	}, [activeLanguageId, drizzle]);

	const refreshCloudState = useCallback(async () => {
		if (isRefreshingRef.current) {
			return;
		}
		if (!isSignedIn) {
			setRefreshError("Sign in to load premade decks.");
			return;
		}

		isRefreshingRef.current = true;
		setIsRefreshing(true);
		setRefreshError(null);

		try {
			await refreshPremadeDeckCache({
				db: drizzle,
				getToken,
				languageId: activeLanguageId,
			});
		} catch (error) {
			console.error("Failed to refresh premade decks.", error);
			setRefreshError(
				error instanceof Error
					? error.message
					: "The app could not refresh premade decks.",
			);
		} finally {
			await loadCachedState();
			isRefreshingRef.current = false;
			setIsRefreshing(false);
		}
	}, [activeLanguageId, drizzle, getToken, isSignedIn, loadCachedState]);

	useFocusEffect(
		useCallback(() => {
			let isActive = true;
			let refreshHandle: { cancel?: () => void } | null = null;

			void (async () => {
				setIsLoading(true);
				await loadCachedState();
				if (isActive) {
					setIsLoading(false);
					refreshHandle = InteractionManager.runAfterInteractions(() => {
						if (!isActive) {
							return;
						}
						void refreshCloudState();
					});
				}
			})();

			return () => {
				isActive = false;
				refreshHandle?.cancel?.();
			};
		}, [loadCachedState, refreshCloudState]),
	);

	useEffect(() => {
		if (!copyModalVisible || !selectedCollection) {
			return;
		}

		setFolderName(selectedCollection.name);
		setReviewType(DEFAULT_REVIEW_TYPE);
		setCopyProgress(null);
	}, [copyModalVisible, selectedCollection]);

	const openCopyCollectionModal = useCallback((collection: CachedPremadeBookListItem) => {
		setSelectedCollection(collection);
		setFolderName(collection.name);
		setReviewType(DEFAULT_REVIEW_TYPE);
		setCopyProgress(null);
		setCopyModalVisible(true);
	}, []);

	const toggleCollectionExpanded = useCallback((collectionKey: string) => {
		setExpandedCollections((current) => ({
			...current,
			[collectionKey]: !current[collectionKey],
		}));
	}, []);

	const runCopyCollection = useCallback(async () => {
		if (!selectedCollection || isCopyingCollection) {
			return;
		}

		if (!folderName.trim()) {
			Alert.alert("Folder name required", "Enter a name for the copied premade folder.");
			return;
		}

		setIsCopyingCollection(true);
		setCopyProgress(null);
		await yieldToEventLoop();

		try {
			const result = await copyCachedPremadeCollectionToLocalFolder({
				db: drizzle,
				book: selectedCollection.book,
				reviewType,
				name: folderName,
				onProgress: setCopyProgress,
			});

			if (result.status === "missing_premade_collection") {
				Alert.alert("Collection not found", "This premade collection is no longer available.");
				return;
			}

			if (result.status === "copy_failed") {
				Alert.alert(
					"Copy failed",
					"The premade collection could not be copied into local folders.",
				);
				return;
			}

			setCopyModalVisible(false);
			const copySummary =
				result.skippedCount && result.skippedCount > 0
					? `${result.createdDecks.length} premade decks created in "${result.folderName}". ${result.skippedCount} items skipped for review compatibility.`
					: `${result.createdDecks.length} premade decks created in "${result.folderName}".`;
			Alert.alert(
				"Premade collection copied",
				copySummary,
				[
					{
						text: "Stay here",
						style: "cancel",
					},
					{
						text: "Open decks",
						onPress: () => router.push("/decks"),
					},
				],
			);
		} catch (error) {
			console.error("Failed to copy premade collection.", error);
			Alert.alert(
				"Copy failed",
				error instanceof Error ? error.message : "The premade collection could not be copied.",
			);
		} finally {
			setIsCopyingCollection(false);
			setCopyProgress(null);
		}
	}, [drizzle, folderName, isCopyingCollection, reviewType, router, selectedCollection]);

	return (
		<View className="flex-1 bg-[#0F1012]">
			<ScrollView
				className="flex-1"
				contentContainerClassName="px-3 pb-4 pt-3"
				showsVerticalScrollIndicator={false}
			>
				<View className="border-b border-white/8 pb-2.5">
					<View className="flex-row items-center justify-between gap-2">
						<View className="min-w-0 flex-1">
							<Text className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
								Premades
							</Text>
							<Text className="mt-0.5 text-lg font-semibold text-zinc-100">
								Premade Decks
							</Text>
						</View>
						<Button
							onPress={() => void refreshCloudState()}
							className="h-9 rounded-xl border border-white/8 bg-[#141518] px-3"
						>
							<View className="flex-row items-center justify-center gap-1.5">
								<RefreshCcw size={14} color="#E4E4E7" />
								<Text className="text-sm font-medium text-zinc-100">Refresh</Text>
							</View>
						</Button>
					</View>

					<View className="mt-2.5 flex-row items-center justify-between rounded-xl border border-white/8 bg-[#141518] px-3 py-2">
						<Text className="text-sm font-medium text-zinc-100">
							{formatTimestamp(syncState?.lastSuccessfulSyncAt)}
						</Text>
						{refreshError ? (
							<Text className="text-xs text-amber-300">{refreshError}</Text>
						) : (
							<Text className="text-[10px] font-medium uppercase tracking-[0.2em] text-zinc-500">
								Last sync
							</Text>
						)}
					</View>
				</View>

				{isLoading && premadeCollections.length === 0 ? (
					<View className="mt-2 rounded-xl border border-white/10 bg-[#111214] px-3 py-3">
						<View className="flex-row items-center gap-2.5">
							<LoaderCircle size={16} color="#E4E4E7" />
							<Text className="text-sm font-medium text-zinc-100">
								Loading premade decks...
							</Text>
						</View>
					</View>
				) : premadeCollections.length === 0 ? (
					<View className="mt-2 rounded-xl border border-white/10 bg-[#111214] px-3 py-3">
						<Text className="text-sm font-semibold text-zinc-100">
							No premade decks available
						</Text>
						<Text className="mt-0.5 text-xs text-zinc-400">
							Refresh when online to load premades for the active language.
						</Text>
					</View>
				) : (
					<View className="mt-2 gap-2">
						{premadeCollections.map((collection) => {
							const isExpanded = Boolean(expandedCollections[collection.book]);

							return (
							<View key={collection.book} className="rounded-2xl border border-white/8 bg-[#141518] p-2.5">
								<View className="flex-row items-center gap-2.5">
									<Pressable
										onPress={() => toggleCollectionExpanded(collection.book)}
										className="min-w-0 flex-1"
									>
										<View className="flex-row items-center gap-2.5">
											<View className="rounded-xl border border-white/8 bg-white/[0.04] p-2">
												<BookCopy size={16} color="#E4E4E7" />
											</View>
											<View className="min-w-0 flex-1">
												<Text className="text-sm font-semibold text-zinc-100" numberOfLines={1}>
													{collection.name}
												</Text>
												<Text className="mt-0.5 text-xs text-zinc-500">
													{collection.decks.length} decks • {collection.itemCount} items
												</Text>
											</View>
										</View>
									</Pressable>
									<Button
										onPress={() => openCopyCollectionModal(collection)}
										className="h-8 rounded-lg border border-white/8 bg-[#17181B] px-2.5"
									>
										<Text className="text-xs font-medium text-zinc-100">Copy</Text>
									</Button>
									<Pressable
										onPress={() => toggleCollectionExpanded(collection.book)}
										className="h-11 w-11 items-center justify-center rounded-xl border border-white/8 bg-[#15171A]"
									>
										{isExpanded ? (
											<ChevronDown size={18} color="#A1A1AA" />
										) : (
											<ChevronRight size={18} color="#A1A1AA" />
										)}
									</Pressable>
								</View>

								{isExpanded ? (
									<View className="mt-2 gap-1.5 border-t border-white/8 pt-2">
										{collection.decks.map((deck) => (
											<Pressable
												key={deck.id}
												onPress={() => router.push(`/premade-decks/${deck.id}`)}
												className="rounded-xl border border-white/6 bg-[#17181B] px-3 py-2.5"
											>
												<View className="flex-row items-center justify-between gap-2">
													<View className="min-w-0 flex-1 gap-0.5">
														<Text className="text-sm font-semibold text-zinc-100" numberOfLines={1}>
															{deck.name}
														</Text>
														<Text className="text-xs text-zinc-500">
															{deck.itemCount} {deck.itemCount === 1 ? "item" : "items"}
														</Text>
													</View>
													<ChevronRight size={14} color="#71717A" />
												</View>
											</Pressable>
										))}
									</View>
								) : null}
							</View>
							);
						})}
					</View>
				)}
			</ScrollView>

			<Modal
				transparent
				visible={copyModalVisible}
				animationType="fade"
				onRequestClose={() => {
					if (isCopyingCollection) {
						return;
					}
					setCopyModalVisible(false);
				}}
			>
				<View className="flex-1 items-center justify-center bg-black/60 px-4">
					<View className="max-h-[85%] w-full rounded-xl border border-white/10 bg-[#111214] p-3">
							<ScrollView showsVerticalScrollIndicator={false}>
								<Text className="text-sm font-semibold text-zinc-100">
									Copy collection: {selectedCollection?.name ?? "Collection"}
								</Text>
							<Text className="mt-1 text-xs text-zinc-400">
								{formatCollectionCopyProgress(copyProgress) ??
									(selectedCollection
										? `${selectedCollection.decks.length} decks • ${selectedCollection.itemCount} items`
										: "")}
							</Text>

							<View className="mt-3 gap-1.5">
								<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
									Folder name
								</Text>
								<Input
									value={folderName}
									onChangeText={setFolderName}
									placeholder="Premade folder name"
									placeholderTextColor="#71717a"
									className="rounded-lg border border-white/8 bg-[#17181B] px-3 py-2.5 text-sm text-zinc-100"
								/>
							</View>

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
								onPress={() => setCopyModalVisible(false)}
								disabled={isCopyingCollection}
								variant="secondary"
								className="h-10 flex-1 rounded-xl border border-white/8 bg-[#17181B]"
							>
								<Text className="text-sm font-medium text-zinc-200">Cancel</Text>
							</Button>
							<Button
								onPress={() => void runCopyCollection()}
								disabled={isCopyingCollection}
								className="h-10 flex-1 rounded-xl bg-zinc-100"
							>
								<Text className="text-sm font-medium text-zinc-900">
									{isCopyingCollection ? "Copying..." : "Copy collection"}
								</Text>
							</Button>
						</View>
					</View>
				</View>
			</Modal>
		</View>
	);
}
