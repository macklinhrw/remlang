import { useCallback, useMemo, useRef, useState } from "react";
import {
	Alert,
	ActivityIndicator,
	Modal,
	Pressable,
	ScrollView,
	TouchableOpacity,
	View,
} from "react-native";
import { useSelector } from "@legendapp/state/react";
import { useRouter } from "expo-router";
import { useFocusEffect } from "@react-navigation/native";
import { useAuth } from "@clerk/expo";
import { ReviewLimitEditor } from "@/components/review/review-limit-editor";
import {
	ChevronDown,
	ChevronRight,
	Cloud,
	ExternalLink,
	FolderOpen,
	FolderPlus,
	LoaderCircle,
	Pause,
	PencilLine,
	Play,
	Plus,
	Trash2,
} from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import {
	getFolderReviewLimitSettings,
	normalizeReviewLimitSettings,
	type ReviewLimitSettings,
} from "@/lib/review/reviewLimits";
import { generateId } from "@/lib/id";
import {
	createDeck,
	createDeckFolder,
	deleteDeckFolder,
	deleteDeckFolderAndChildren,
	type DeckCollectionListItem,
	type DeckCollectionResult,
	type DeckFolderListItem,
	type DeckListItem,
	decks$,
	getDeckFolders,
	refreshDecksStore,
	setDeckNewCardsPaused,
	setDeckFolder,
	setFolderNewCardsPaused as setFolderNewCardsPausedSetting,
	setFolderReviewLimits,
	trashDeck,
} from "@/lib/store/decksStore";
import { useAppLanguage } from "@/lib/store/appLanguageStore";
import { runManualSync, type ManualSyncProgress } from "@/lib/sync/client";
import { promptForConflictResolution } from "@/lib/sync/conflict-prompt";
import { useSyncSettings } from "@/lib/sync/settings";

const formatSyncTimestamp = (value: string | null) => {
	if (!value) return "Not yet";

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return parsed.toLocaleString();
};

const formatChangeSummary = (
	summary: {
		deckFolders: number;
		decks: number;
		deckLinks: number;
		permanentDeletes: number;
		knowledge: number;
		cards: number;
		knowledgeLinks: number;
		cardLinks: number;
		reviewLogs: number;
		reviewUndos: number;
		total: number;
	},
	emptyLabel: string,
) => {
	if (summary.total === 0) {
		return emptyLabel;
	}

	const parts = [
		summary.deckFolders > 0
			? `${summary.deckFolders} folder${summary.deckFolders === 1 ? "" : "s"}`
			: null,
		summary.decks > 0
			? `${summary.decks} deck${summary.decks === 1 ? "" : "s"}`
			: null,
		summary.deckLinks > 0
			? `${summary.deckLinks} deck link${summary.deckLinks === 1 ? "" : "s"}`
			: null,
		summary.permanentDeletes > 0
			? `${summary.permanentDeletes} permanent delete${summary.permanentDeletes === 1 ? "" : "s"}`
			: null,
		summary.knowledge > 0
			? `${summary.knowledge} knowledge item${summary.knowledge === 1 ? "" : "s"}`
			: null,
		summary.cards > 0
			? `${summary.cards} card${summary.cards === 1 ? "" : "s"}`
			: null,
		summary.knowledgeLinks > 0
			? `${summary.knowledgeLinks} knowledge link${summary.knowledgeLinks === 1 ? "" : "s"}`
			: null,
		summary.cardLinks > 0
			? `${summary.cardLinks} card link${summary.cardLinks === 1 ? "" : "s"}`
			: null,
		summary.reviewLogs > 0
			? `${summary.reviewLogs} review log${summary.reviewLogs === 1 ? "" : "s"}`
			: null,
		summary.reviewUndos > 0
			? `${summary.reviewUndos} review undo${summary.reviewUndos === 1 ? "" : "s"}`
			: null,
	].filter(Boolean);

	return parts.join(", ");
};

const scheduleAfterNextPaint = (task: () => void) => {
	let cancelled = false;
	const runTask = () => {
		if (!cancelled) {
			void task();
		}
	};

	if (typeof globalThis.requestAnimationFrame === "function") {
		const frameId = globalThis.requestAnimationFrame(() => {
			setTimeout(runTask, 0);
		});

		return () => {
			cancelled = true;
			if (typeof globalThis.cancelAnimationFrame === "function") {
				globalThis.cancelAnimationFrame(frameId);
			}
		};
	}

	const timeoutId = setTimeout(runTask, 0);
	return () => {
		cancelled = true;
		clearTimeout(timeoutId);
	};
};

export default function DecksPage() {
	const router = useRouter();
	const drizzle = useDrizzle();
	const { activeLanguageId } = useAppLanguage();
	const { isSignedIn, getToken } = useAuth();
	const syncSettings = useSyncSettings();
	const [selectedDeck, setSelectedDeck] = useState<DeckListItem | null>(null);
	const [selectedFolder, setSelectedFolder] = useState<DeckFolderListItem | null>(null);
	const [folderTargetDeck, setFolderTargetDeck] = useState<DeckListItem | null>(null);
	const [isFolderModalVisible, setIsFolderModalVisible] = useState(false);
	const [availableFolders, setAvailableFolders] = useState<DeckFolderListItem[]>([]);
	const [folderSearch, setFolderSearch] = useState("");
	const [isLoadingFolders, setIsLoadingFolders] = useState(false);
	const [isSavingFolderAssignment, setIsSavingFolderAssignment] = useState(false);
	const [isCreateFolderVisible, setIsCreateFolderVisible] = useState(false);
	const [newFolderName, setNewFolderName] = useState("");
	const [isCreatingFolder, setIsCreatingFolder] = useState(false);
	const [isCreateDeckVisible, setIsCreateDeckVisible] = useState(false);
	const [newDeckName, setNewDeckName] = useState("");
	const [isCreatingDeck, setIsCreatingDeck] = useState(false);
	const [folderLimitTarget, setFolderLimitTarget] = useState<DeckFolderListItem | null>(null);
	const [folderLimitSettings, setFolderLimitSettings] =
		useState<ReviewLimitSettings>(normalizeReviewLimitSettings());
	const [folderNewCardsPaused, setFolderNewCardsPaused] = useState(false);
	const [isSavingFolderLimits, setIsSavingFolderLimits] = useState(false);
	const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
	const [expandedPrimaryDecks, setExpandedPrimaryDecks] = useState<Record<string, boolean>>({});
	const [isSyncing, setIsSyncing] = useState(false);
	const [syncProgress, setSyncProgress] = useState<ManualSyncProgress | null>(null);
	const [isTogglingDeckNewCardsPaused, setIsTogglingDeckNewCardsPaused] = useState(false);
	const [isTogglingFolderNewCardsPaused, setIsTogglingFolderNewCardsPaused] = useState(false);
	const normalizedActiveLanguageId = activeLanguageId ?? null;
	const decksState = useSelector(() => {
		const hasLoadedSnapshot = decks$.hasLoadedSnapshot.get();
		const snapshotLanguageId = decks$.snapshotLanguageId.get();
		const hasMatchingSnapshot =
			hasLoadedSnapshot && snapshotLanguageId === normalizedActiveLanguageId;

		return {
			collections: hasMatchingSnapshot ? decks$.collections.get() : [],
			hasMatchingSnapshot,
			isRefreshing: decks$.isRefreshing.get(),
			refreshError: decks$.refreshError.get(),
		};
	});

	const refreshDecks = useCallback(async () => {
		try {
			await refreshDecksStore(drizzle, activeLanguageId);
		} catch (error) {
			console.error("Failed to refresh decks.", error);
		}
	}, [activeLanguageId, drizzle]);

	const loadFolders = useCallback(async () => {
		setIsLoadingFolders(true);
		try {
			const rows = await getDeckFolders(drizzle, activeLanguageId);
			setAvailableFolders(rows);
		} finally {
			setIsLoadingFolders(false);
		}
	}, [activeLanguageId, drizzle]);

	const handleTrashDeck = useCallback(
		(deck: DeckListItem) => {
			setSelectedDeck(null);
			Alert.alert(
				`Delete "${deck.name}"?`,
				"This moves the deck and its cards to Trash.",
				[
					{ text: "Cancel", style: "cancel" },
					{
						text: "Delete",
						style: "destructive",
						onPress: () => {
							void (async () => {
								try {
									const result = await trashDeck(drizzle, deck.id);
									await refreshDecks();

									if (result.status === "missing_deck") {
										Alert.alert("Deck not found", "This deck is no longer available.");
									}
								} catch (error) {
									console.error("Failed to trash deck.", error);
									Alert.alert("Delete failed", "The deck could not be moved to Trash.");
								}
							})();
						},
					},
				],
			);
		},
		[drizzle, refreshDecks],
	);

	const handleToggleDeckNewCardsPaused = useCallback(
		async (deck: DeckListItem) => {
			if (isTogglingDeckNewCardsPaused) {
				return;
			}

			setSelectedDeck(null);
			setIsTogglingDeckNewCardsPaused(true);
			try {
				const result = await setDeckNewCardsPaused(drizzle, {
					deckId: deck.id,
					paused: !Boolean(deck.newCardsPaused),
				});
				await refreshDecks();

				if (result.status === "missing_deck") {
					Alert.alert("Deck not found", "This deck is no longer available.");
					return;
				}

				if (result.status === "managed_by_primary") {
					Alert.alert(
						"Use the primary deck",
						"Linked decks inherit review behavior from their primary deck.",
					);
				}
			} catch (error) {
				console.error("Failed to toggle deck new cards pause.", error);
				Alert.alert("Update failed", "The deck new-card setting could not be updated.");
			} finally {
				setIsTogglingDeckNewCardsPaused(false);
			}
		},
		[drizzle, isTogglingDeckNewCardsPaused, refreshDecks],
	);

	const handleDeleteFolder = useCallback(
		(folder: DeckFolderListItem) => {
			setSelectedFolder(null);
			Alert.alert(
				`Delete "${folder.name}"?`,
				"This deletes the folder and moves its child decks back to the main deck list.",
				[
					{ text: "Cancel", style: "cancel" },
					{
						text: "Delete",
						style: "destructive",
						onPress: () => {
							void (async () => {
								try {
									const result = await deleteDeckFolder(drizzle, {
										folderId: folder.id,
										languageId: activeLanguageId,
									});
									await refreshDecks();

									if (result.status === "missing_folder") {
										Alert.alert("Folder not found", "This folder is no longer available.");
									}
								} catch (error) {
									console.error("Failed to delete folder.", error);
									Alert.alert(
										"Delete failed",
										"The folder could not be deleted.",
									);
								}
							})();
						},
					},
				],
			);
		},
		[activeLanguageId, drizzle, refreshDecks],
	);

	const handleDeleteFolderAndChildren = useCallback(
		(folder: DeckFolderListItem) => {
			setSelectedFolder(null);
			Alert.alert(
				`Delete "${folder.name}" and all child decks?`,
				"This deletes the folder and moves all child decks and their cards to Trash.",
				[
					{ text: "Cancel", style: "cancel" },
					{
						text: "Delete all",
						style: "destructive",
						onPress: () => {
							void (async () => {
								try {
									const result = await deleteDeckFolderAndChildren(drizzle, {
										folderId: folder.id,
										languageId: activeLanguageId,
									});
									await refreshDecks();

									if (result.status === "missing_folder") {
										Alert.alert("Folder not found", "This folder is no longer available.");
									}
								} catch (error) {
									console.error("Failed to delete folder and children.", error);
									Alert.alert(
										"Delete failed",
										"The folder and child decks could not be deleted.",
									);
								}
							})();
						},
					},
				],
			);
		},
		[activeLanguageId, drizzle, refreshDecks],
	);

	const openFolderLimitsModal = useCallback((folder: DeckFolderListItem) => {
		setSelectedFolder(null);
		setFolderLimitTarget(folder);
		setFolderLimitSettings(getFolderReviewLimitSettings(folder));
		setFolderNewCardsPaused(Boolean(folder.newCardsPaused));
	}, []);

	const closeFolderLimitsModal = useCallback(() => {
		if (isSavingFolderLimits) {
			return;
		}

		setFolderLimitTarget(null);
		setFolderLimitSettings(normalizeReviewLimitSettings());
		setFolderNewCardsPaused(false);
	}, [isSavingFolderLimits]);

	const handleToggleFolderNewCardsPaused = useCallback(
		async (folder: DeckFolderListItem) => {
			if (isTogglingFolderNewCardsPaused) {
				return;
			}

			setSelectedFolder(null);
			setIsTogglingFolderNewCardsPaused(true);
			try {
					const result = await setFolderNewCardsPausedSetting(drizzle, {
					folderId: folder.id,
					languageId: activeLanguageId,
					paused: !Boolean(folder.newCardsPaused),
				});
				await refreshDecks();

				if (result.status === "missing_folder") {
					Alert.alert("Folder not found", "This folder is no longer available.");
				}
			} catch (error) {
				console.error("Failed to toggle folder new cards pause.", error);
				Alert.alert("Update failed", "The folder new-card setting could not be updated.");
			} finally {
				setIsTogglingFolderNewCardsPaused(false);
			}
		},
		[activeLanguageId, drizzle, isTogglingFolderNewCardsPaused, refreshDecks],
	);

	const handleSaveFolderLimits = useCallback(async () => {
		if (!folderLimitTarget || isSavingFolderLimits) {
			return;
		}

		setIsSavingFolderLimits(true);
		try {
			const result = await setFolderReviewLimits(drizzle, {
				folderId: folderLimitTarget.id,
				languageId: activeLanguageId,
				newLimitEnabled: folderLimitSettings.newLimitEnabled,
				newLimit: folderLimitSettings.newLimit,
				totalLimitEnabled: folderLimitSettings.totalLimitEnabled,
				totalLimit: folderLimitSettings.totalLimit,
			});

			if (result.status === "missing_folder") {
				Alert.alert("Folder not found", "This folder is no longer available.");
				return;
			}

				const newCardsPausedChanged =
					Boolean(folderLimitTarget.newCardsPaused) !== folderNewCardsPaused;
				if (newCardsPausedChanged) {
					const pauseResult = await setFolderNewCardsPausedSetting(drizzle, {
					folderId: folderLimitTarget.id,
					languageId: activeLanguageId,
					paused: folderNewCardsPaused,
				});

				if (pauseResult.status === "missing_folder") {
					Alert.alert("Folder not found", "This folder is no longer available.");
					return;
				}
			}

			closeFolderLimitsModal();
			Alert.alert("Saved", "Folder review settings were updated.");
		} catch (error) {
			console.error("Failed to save folder review limits.", error);
			Alert.alert("Save failed", "The folder review settings could not be updated.");
		} finally {
			setIsSavingFolderLimits(false);
		}
	}, [
		activeLanguageId,
		closeFolderLimitsModal,
		drizzle,
		folderLimitSettings.newLimit,
		folderLimitSettings.newLimitEnabled,
		folderLimitSettings.totalLimit,
		folderLimitSettings.totalLimitEnabled,
		folderNewCardsPaused,
		folderLimitTarget,
		isSavingFolderLimits,
	]);

	const handleManualSync = useCallback(async () => {
		if (!isSignedIn) {
			router.push("/sign-in");
			return;
		}

		if (isSyncing) {
			return;
		}

		setIsSyncing(true);
		setSyncProgress({
			label: "Check",
			completed: 0,
			total: 1,
		});

		try {
			let result = await runManualSync({
				db: drizzle,
				getToken: () => getToken(),
				source: "manual",
				onProgress: setSyncProgress,
			});

			if ("requiresConflictResolution" in result) {
				const strategy = await promptForConflictResolution(result.conflicts);
				if (!strategy) {
					return;
				}

				result = await runManualSync({
					db: drizzle,
					getToken: () => getToken(),
					conflictStrategy: strategy,
					source: "manual",
					onProgress: setSyncProgress,
				});
			}

			if ("requiresConflictResolution" in result) {
				throw new Error("Sync conflict resolution could not be completed.");
			}
			await syncSettings.refresh();
			await refreshDecks();
			Alert.alert(
				"Sync complete",
				`Uploaded: ${formatChangeSummary(result.localChanges, "no local changes")}.\n\nDownloaded: ${formatChangeSummary(result.remoteChanges, "no cloud changes")}.`,
			);
		} catch (error) {
			const message =
				error instanceof Error
					? error.message
					: "The app could not reach the sync service.";

			Alert.alert("Sync failed", message);
		} finally {
			setIsSyncing(false);
			setSyncProgress(null);
		}
	}, [
		drizzle,
		getToken,
		isSignedIn,
		isSyncing,
		refreshDecks,
		router,
		syncSettings,
	]);

	const openFolderModal = useCallback(
		(deck: DeckListItem) => {
			setSelectedDeck(null);
			setFolderTargetDeck(deck);
			setFolderSearch("");
			setIsFolderModalVisible(true);
			void loadFolders();
		},
		[loadFolders],
	);

	const closeFolderModal = useCallback(() => {
		if (isSavingFolderAssignment) {
			return;
		}

		setIsFolderModalVisible(false);
		setFolderTargetDeck(null);
		setFolderSearch("");
	}, [isSavingFolderAssignment]);

	const handleSetDeckFolder = useCallback(
		async (folderId: string | null) => {
			if (!folderTargetDeck || isSavingFolderAssignment) {
				return;
			}

			setIsSavingFolderAssignment(true);
			try {
				const result = await setDeckFolder(drizzle, {
					deckId: folderTargetDeck.id,
					folderId,
				});

				if (result.status === "missing_deck") {
					Alert.alert("Deck not found", "This deck is no longer available.");
					return;
				}

				if (result.status === "missing_folder") {
					Alert.alert("Folder not found", "That folder is no longer available.");
					void loadFolders();
					return;
				}

				if (result.status === "managed_by_primary") {
					Alert.alert(
						"Use the primary deck",
						"Linked decks are managed by their primary deck.",
					);
					return;
				}

				closeFolderModal();
			} catch (error) {
				console.error("Failed to update deck folder.", error);
				Alert.alert("Folder update failed", "The deck could not be moved.");
			} finally {
				setIsSavingFolderAssignment(false);
			}
		},
		[closeFolderModal, drizzle, folderTargetDeck, isSavingFolderAssignment, loadFolders],
	);

	const handleCreateFolder = useCallback(async () => {
		if (isCreatingFolder) {
			return;
		}

		const trimmed = newFolderName.trim();
		if (!trimmed) {
			Alert.alert("Folder name required", "Enter a name for the new folder.");
			return;
		}

		setIsCreatingFolder(true);
		try {
			const result = await createDeckFolder(drizzle, {
				name: trimmed,
				languageId: activeLanguageId,
			});

			if (result.status === "invalid_name") {
				Alert.alert("Folder name required", "Enter a name for the new folder.");
				return;
			}

			setNewFolderName("");
			setIsCreateFolderVisible(false);
			await loadFolders();
		} catch (error) {
			console.error("Failed to create folder.", error);
			Alert.alert("Create folder failed", "The folder could not be created.");
		} finally {
			setIsCreatingFolder(false);
		}
	}, [activeLanguageId, drizzle, isCreatingFolder, loadFolders, newFolderName]);

	const handleCreateDeck = useCallback(async () => {
		if (isCreatingDeck) {
			return;
		}

		const trimmed = newDeckName.trim();
		if (!trimmed) {
			Alert.alert("Deck name required", "Enter a name for the new deck.");
			return;
		}

		setIsCreatingDeck(true);
		try {
			const result = await createDeck(drizzle, {
				id: generateId(),
				name: trimmed,
				languageId: activeLanguageId,
			});

			if (result) {
				decks$.addDeck(result);
				setNewDeckName("");
				setIsCreateDeckVisible(false);
				await refreshDecks();
			}
		} catch (error) {
			console.error("Failed to create deck.", error);
			Alert.alert("Create deck failed", "The deck could not be created.");
		} finally {
			setIsCreatingDeck(false);
		}
	}, [activeLanguageId, drizzle, isCreatingDeck, newDeckName, refreshDecks]);

	useFocusEffect(
		useCallback(() => {
			const hasMatchingSnapshot =
				decks$.hasLoadedSnapshot.peek() &&
				decks$.snapshotLanguageId.peek() === normalizedActiveLanguageId;
			if (hasMatchingSnapshot) {
				return scheduleAfterNextPaint(refreshDecks);
			}

			void refreshDecks();
		}, [normalizedActiveLanguageId, refreshDecks]),
	);

	const filteredFolders = useMemo(() => {
		const query = folderSearch.trim().toLowerCase();
		if (!query) {
			return availableFolders;
		}

		return availableFolders.filter((folder) =>
			folder.name.toLowerCase().includes(query),
		);
	}, [availableFolders, folderSearch]);

	return (
		<View className="flex-1 bg-background">
			{decksState.hasMatchingSnapshot ? (
					<InnerDecksPage
						collections={decksState.collections}
						expandedFolders={expandedFolders}
						onToggleFolder={(folderId) =>
							setExpandedFolders((current) => ({
								...current,
								[folderId]: !current[folderId],
							}))
						}
						expandedPrimaryDecks={expandedPrimaryDecks}
						onTogglePrimaryDeck={(deckId) =>
							setExpandedPrimaryDecks((current) => ({
								...current,
								[deckId]: !current[deckId],
							}))
						}
						onCreateDeck={() => setIsCreateDeckVisible(true)}
						onCreateFolder={() => setIsCreateFolderVisible(true)}
						onOpenDeckReview={(deck) => router.push(`/deck/${deck.id}/review`)}
						onOpenFolderReview={(folder) => router.push(`/folder/${folder.id}/review`)}
						onOpenDeckMenu={setSelectedDeck}
						onOpenFolderMenu={setSelectedFolder}
						showManualSync={syncSettings.isReady}
						isSignedIn={Boolean(isSignedIn)}
						isSyncing={isSyncing}
						syncProgress={syncProgress}
						lastPushedAt={syncSettings.lastPushedAt}
						onManualSync={handleManualSync}
					/>
				) : decksState.refreshError ? (
					<View className="flex-1 items-center justify-center gap-3 px-4">
						<Text className="text-base font-medium text-zinc-100">Unable to load decks.</Text>
						<Text className="text-center text-sm leading-5 text-zinc-400">
							Try again. Your previous deck snapshot was not available for this language.
						</Text>
						<Button
							onPress={() => void refreshDecks()}
							className="rounded-2xl bg-zinc-100 px-5"
						>
							<Text className="font-medium text-zinc-900">Retry</Text>
						</Button>
					</View>
				) : (
					<View className="flex-1 items-center justify-center gap-3 px-4">
						<ActivityIndicator color="#A1A1AA" />
						<Text className="text-sm text-zinc-400">
							{decksState.isRefreshing ? "Loading decks..." : "Preparing decks..."}
						</Text>
					</View>
				)}
			<ActionMenuModal
				visible={Boolean(selectedDeck)}
				title={selectedDeck?.name ?? null}
				onClose={() => setSelectedDeck(null)}
				actions={selectedDeck ? [
					{ type: "action", label: "Review", icon: <Play size={16} color="#FBBF24" />, onPress: () => { setSelectedDeck(null); router.push(`/deck/${selectedDeck.id}/review`); } },
					{ type: "action", label: "Edit deck", icon: <PencilLine size={16} color="#D4D4D8" />, onPress: () => { setSelectedDeck(null); router.push(`/deck/${selectedDeck.id}`); } },
					...(!selectedDeck.primaryDeckId ? [
						{ type: "action" as const, label: "Add to folder", icon: <FolderPlus size={16} color="#D4D4D8" />, onPress: () => openFolderModal(selectedDeck) },
						{ type: "action" as const, label: selectedDeck.newCardsPaused ? "Resume new cards" : "Pause new cards", icon: selectedDeck.newCardsPaused ? <Play size={16} color="#D4D4D8" /> : <Pause size={16} color="#D4D4D8" />, onPress: () => void handleToggleDeckNewCardsPaused(selectedDeck), disabled: isTogglingDeckNewCardsPaused },
					] : []),
					...(selectedDeck.primaryDeckId ? [
						{ type: "action" as const, label: "Open primary deck", icon: <ExternalLink size={16} color="#7DD3FC" />, onPress: () => { setSelectedDeck(null); router.push(`/deck/${selectedDeck.primaryDeckId}`); } },
					] : []),
					{ type: "separator" as const },
					{ type: "destructive" as const, label: "Delete deck", icon: <Trash2 size={16} color="#F87171" />, onPress: () => handleTrashDeck(selectedDeck) },
				] : []}
			/>
			<ActionMenuModal
				visible={Boolean(selectedFolder)}
				title={selectedFolder?.name ?? null}
				onClose={() => setSelectedFolder(null)}
				actions={selectedFolder ? [
					{ type: "action", label: "Review folder", icon: <Play size={16} color="#FBBF24" />, onPress: () => { setSelectedFolder(null); router.push(`/folder/${selectedFolder.id}/review`); } },
					{ type: "action", label: "Review limits", icon: <PencilLine size={16} color="#D4D4D8" />, onPress: () => openFolderLimitsModal(selectedFolder) },
					{ type: "action", label: selectedFolder.newCardsPaused ? "Resume new cards" : "Pause new cards", icon: selectedFolder.newCardsPaused ? <Play size={16} color="#D4D4D8" /> : <Pause size={16} color="#D4D4D8" />, onPress: () => void handleToggleFolderNewCardsPaused(selectedFolder), disabled: isTogglingFolderNewCardsPaused },
					{ type: "separator" as const },
					{ type: "destructive", label: "Delete folder", icon: <Trash2 size={16} color="#F87171" />, onPress: () => handleDeleteFolder(selectedFolder) },
					{ type: "destructive", label: "Delete folder and decks", icon: <Trash2 size={16} color="#F87171" />, onPress: () => handleDeleteFolderAndChildren(selectedFolder) },
				] : []}
			/>
			<FolderReviewLimitsModal
				folder={folderLimitTarget}
				value={folderLimitSettings}
				newCardsPaused={folderNewCardsPaused}
				onChange={setFolderLimitSettings}
				onChangeNewCardsPaused={setFolderNewCardsPaused}
				onClose={closeFolderLimitsModal}
				onSave={() => void handleSaveFolderLimits()}
				isSaving={isSavingFolderLimits}
			/>
			<FolderAssignmentModal
				deck={folderTargetDeck}
				folders={filteredFolders}
				isVisible={isFolderModalVisible}
				searchValue={folderSearch}
				onChangeSearch={setFolderSearch}
				onClose={closeFolderModal}
				onSelectFolder={(folderId) => void handleSetDeckFolder(folderId)}
				onRemoveFromFolder={() => void handleSetDeckFolder(null)}
				isLoading={isLoadingFolders}
				isSaving={isSavingFolderAssignment}
			/>
			<CreateFolderModal
				isVisible={isCreateFolderVisible}
				name={newFolderName}
				onChangeName={setNewFolderName}
				onClose={() => {
					if (isCreatingFolder) {
						return;
					}
					setIsCreateFolderVisible(false);
					setNewFolderName("");
				}}
				onSubmit={() => void handleCreateFolder()}
				isSubmitting={isCreatingFolder}
			/>
			<CreateDeckModal
				isVisible={isCreateDeckVisible}
				name={newDeckName}
				onChangeName={setNewDeckName}
				onClose={() => {
					if (isCreatingDeck) {
						return;
					}
					setIsCreateDeckVisible(false);
					setNewDeckName("");
				}}
				onSubmit={() => void handleCreateDeck()}
				isSubmitting={isCreatingDeck}
			/>
		</View>
	);
}

const InnerDecksPage = ({
	collections,
	expandedFolders,
	onToggleFolder,
	expandedPrimaryDecks,
	onTogglePrimaryDeck,
	onCreateDeck,
	onCreateFolder,
	onOpenDeckReview,
	onOpenFolderReview,
	onOpenDeckMenu,
	onOpenFolderMenu,
	showManualSync,
	isSignedIn,
	isSyncing,
	syncProgress,
	lastPushedAt,
	onManualSync,
}: {
	collections: DeckCollectionResult;
	expandedFolders: Record<string, boolean>;
	onToggleFolder: (folderId: string) => void;
	expandedPrimaryDecks: Record<string, boolean>;
	onTogglePrimaryDeck: (deckId: string) => void;
	onCreateDeck: () => void;
	onCreateFolder: () => void;
	onOpenDeckReview: (deck: DeckListItem) => void;
	onOpenFolderReview: (folder: DeckFolderListItem) => void;
	onOpenDeckMenu: (deck: DeckListItem) => void;
	onOpenFolderMenu: (folder: DeckFolderListItem) => void;
	showManualSync: boolean;
	isSignedIn: boolean;
	isSyncing: boolean;
	syncProgress: ManualSyncProgress | null;
	lastPushedAt: string | null;
	onManualSync: () => void;
}) => {
	const totalDue = collections.reduce((sum, item) => sum + item.dueCount, 0);
	const totalCards = collections.reduce((sum, item) => sum + item.cardCount, 0);

	return (
		<ScrollView className="flex-1" contentContainerClassName="gap-2 px-3 pt-3 pb-4">
			<View className="gap-2.5">
				<View className="flex-row items-start justify-between gap-3">
					<View className="min-w-0 flex-1">
						<Text className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
							Study Queue
						</Text>
						<Text className="mt-0.5 text-lg font-semibold">Decks</Text>
					</View>
					<View className="shrink-0 flex-row items-center gap-2">
						<TouchableOpacity
							activeOpacity={0.85}
							className="h-11 w-11 items-center justify-center rounded-xl border border-secondary-foreground/20 bg-secondary/20"
							onPress={onCreateFolder}
							accessibilityLabel="Create folder"
						>
							<FolderPlus size={18} color="#E5E7EB" />
						</TouchableOpacity>
						<TouchableOpacity
							activeOpacity={0.85}
							className="h-11 w-11 items-center justify-center rounded-xl border border-secondary-foreground/20 bg-secondary/20"
							onPress={onCreateDeck}
							accessibilityLabel="Create deck"
						>
							<Plus size={18} color="#E5E7EB" />
						</TouchableOpacity>
					</View>
				</View>
				{showManualSync ? (
					<Pressable
						onPress={onManualSync}
						disabled={isSyncing}
						className="rounded-xl border border-sky-400/20 bg-sky-500/[0.08] px-3 py-2.5"
					>
						<View className="flex-row items-center gap-2.5">
							<View className="h-8 w-8 items-center justify-center rounded-lg border border-sky-400/20 bg-sky-400/10">
								{isSyncing ? (
									<LoaderCircle
										size={14}
										color="#7DD3FC"
										className="animate-spin"
									/>
								) : (
									<Cloud size={14} color="#7DD3FC" />
								)}
							</View>
							<View className="min-w-0 flex-1">
								<Text className="text-sm font-medium text-sky-50">
									{isSignedIn
										? isSyncing
											? "Syncing..."
											: "Sync data"
										: "Sign in to sync"}
								</Text>
								{isSignedIn && !isSyncing ? (
									<Text className="text-[11px] leading-4 text-sky-100/60">
										Last: {formatSyncTimestamp(lastPushedAt)}
									</Text>
								) : null}
								{isSignedIn && isSyncing && syncProgress ? (
									<Text className="text-[11px] font-medium tracking-[0.06em] text-sky-200/70">
										{syncProgress.label} {syncProgress.completed}/{syncProgress.total}
									</Text>
								) : null}
								{!isSignedIn ? (
									<Text className="text-[11px] leading-4 text-sky-100/60">
										Back up decks and progress
									</Text>
								) : null}
							</View>
						</View>
					</Pressable>
				) : null}
				<Text className="text-xs text-zinc-500">
					{totalDue} due across {totalCards} cards
				</Text>
			</View>
			{collections.length === 0 ? (
				<View className="rounded-xl border border-white/10 bg-[#111214] px-3 py-3">
					<Text className="text-sm font-semibold">No decks yet</Text>
					<Text className="mt-0.5 text-xs text-muted-foreground">
						Create a deck or folder to start organizing study material.
					</Text>
				</View>
			) : (
				collections.map((item) =>
					item.kind === "folder" ? (
						<FolderComponent
							key={item.id}
							folder={item.folder}
							isExpanded={Boolean(expandedFolders[item.id])}
							onToggle={() => onToggleFolder(item.id)}
							expandedPrimaryDecks={expandedPrimaryDecks}
							onTogglePrimaryDeck={onTogglePrimaryDeck}
							onOpenFolderReview={onOpenFolderReview}
							onOpenDeckReview={onOpenDeckReview}
							onOpenDeckMenu={onOpenDeckMenu}
							onOpenFolderMenu={onOpenFolderMenu}
						/>
					) : item.deck.primaryDeckId ? null : (
						<DeckComponent
							key={item.id}
							deck={item.deck}
							linkedDecks={collections
								.filter(
									(c): c is Extract<DeckCollectionListItem, { kind: "deck" }> =>
										c.kind === "deck" && c.deck.primaryDeckId === item.deck.id,
								)
								.map((c) => c.deck)}
							isExpanded={Boolean(expandedPrimaryDecks[item.id])}
							onToggle={() => onTogglePrimaryDeck(item.id)}
							onOpenReview={onOpenDeckReview}
							onOpenDeckMenu={onOpenDeckMenu}
						/>
					),
				)
			)}
		</ScrollView>
	);
};

const DeckComponent = ({
	deck,
	onOpenReview,
	onOpenDeckMenu,
	isChild = false,
	linkedDecks,
	isExpanded,
	onToggle,
}: {
	deck: DeckListItem;
	onOpenReview: (deck: DeckListItem) => void;
	onOpenDeckMenu: (deck: DeckListItem) => void;
	isChild?: boolean;
	linkedDecks?: DeckListItem[];
	isExpanded?: boolean;
	onToggle?: () => void;
}) => {
	const hasLinkedDecks = linkedDecks && linkedDecks.length > 0;

	if (hasLinkedDecks) {
		return (
			<View className={`rounded-xl border ${
				isChild ? "border-white/6 bg-[#17181B]" : "border-white/10 bg-[#111214]"
			}`}>
				<TouchableOpacity
					activeOpacity={0.85}
					className="px-3 py-2.5"
					onLongPress={() => onOpenDeckMenu(deck)}
					onPress={() => onOpenReview(deck)}
					delayLongPress={180}
				>
					<View className="flex-row items-center justify-between gap-2">
						<View className="min-w-0 flex-1 gap-0.5">
							<Text className="text-sm font-semibold leading-5 text-zinc-100" numberOfLines={1}>
								{deck.name}
							</Text>
							<View className="flex-row flex-wrap items-center gap-x-2">
								<Text className="text-xs text-zinc-500">
									{deck.cardCount} {deck.cardCount === 1 ? "card" : "cards"}
								</Text>
								<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-200">
									Primary
								</Text>
								{deck.newCardsPaused ? (
									<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-amber-200">
										Paused
									</Text>
								) : null}
								<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
									{linkedDecks.length} linked
								</Text>
							</View>
						</View>
						{deck.dueCount > 0 ? (
							<View className="rounded-lg bg-amber-400/10 px-2 py-0.5">
								<Text className="text-xs font-semibold text-amber-300">{deck.dueCount}</Text>
							</View>
						) : (
							<Text className="text-xs text-zinc-600">0</Text>
						)}
						<TouchableOpacity
							activeOpacity={0.85}
							className="h-11 w-11 items-center justify-center rounded-xl border border-white/8 bg-[#15171A]"
							onPress={onToggle}
							accessibilityLabel={isExpanded ? "Collapse linked decks" : "Expand linked decks"}
						>
							{isExpanded ? (
								<ChevronDown size={18} color="#A1A1AA" />
							) : (
								<ChevronRight size={18} color="#A1A1AA" />
							)}
						</TouchableOpacity>
					</View>
				</TouchableOpacity>
				{isExpanded ? (
					<View className="px-3 pb-2">
						<View className="gap-1.5">
							{linkedDecks.map((linked) => (
								<DeckComponent
									key={linked.id}
									deck={linked}
									onOpenReview={onOpenReview}
									onOpenDeckMenu={onOpenDeckMenu}
									isChild
								/>
							))}
						</View>
					</View>
				) : null}
			</View>
		);
	}

	return (
		<TouchableOpacity
			activeOpacity={0.85}
			className={`rounded-xl border px-3 py-2.5 ${
				isChild ? "border-white/6 bg-[#17181B]" : "border-white/10 bg-[#111214]"
			}`}
			onLongPress={() => onOpenDeckMenu(deck)}
			onPress={() => onOpenReview(deck)}
			delayLongPress={180}
		>
			<View className="flex-row items-center justify-between gap-2">
				<View className="min-w-0 flex-1 gap-0.5">
					<Text className="text-sm font-semibold leading-5 text-zinc-100" numberOfLines={1}>
						{deck.name}
					</Text>
					<View className="flex-row flex-wrap items-center gap-x-2">
						<Text className="text-xs text-zinc-500">
							{deck.cardCount} {deck.cardCount === 1 ? "card" : "cards"}
						</Text>
						{deck.primaryDeckId ? (
							<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-200">
								Linked
							</Text>
						) : deck.hasActiveLinkedDecks ? (
							<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-emerald-200">
								Primary
							</Text>
						) : null}
						{deck.newCardsPaused ? (
							<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-amber-200">
								Paused
							</Text>
						) : null}
					</View>
				</View>
				{deck.dueCount > 0 ? (
					<View className="rounded-lg bg-amber-400/10 px-2 py-0.5">
						<Text className="text-xs font-semibold text-amber-300">{deck.dueCount}</Text>
					</View>
				) : (
					<Text className="text-xs text-zinc-600">0</Text>
				)}
			</View>
		</TouchableOpacity>
	);
};

const FolderComponent = ({
	folder,
	isExpanded,
	onToggle,
	expandedPrimaryDecks,
	onTogglePrimaryDeck,
	onOpenFolderReview,
	onOpenDeckReview,
	onOpenDeckMenu,
	onOpenFolderMenu,
}: {
	folder: DeckFolderListItem;
	isExpanded: boolean;
	onToggle: () => void;
	expandedPrimaryDecks: Record<string, boolean>;
	onTogglePrimaryDeck: (deckId: string) => void;
	onOpenFolderReview: (folder: DeckFolderListItem) => void;
	onOpenDeckReview: (deck: DeckListItem) => void;
	onOpenDeckMenu: (deck: DeckListItem) => void;
	onOpenFolderMenu: (folder: DeckFolderListItem) => void;
}) => {
	const suppressNextPressRef = useRef(false);

	return (
		<View className="rounded-2xl border border-white/10 bg-[#101114] p-2.5">
			<View className="flex-row items-center gap-2.5">
				<TouchableOpacity
					activeOpacity={0.85}
					className="min-w-0 flex-1"
					onLongPress={() => {
						suppressNextPressRef.current = true;
						onOpenFolderMenu(folder);
					}}
					onPress={() => {
						if (suppressNextPressRef.current) {
							suppressNextPressRef.current = false;
							return;
						}

						onOpenFolderReview(folder);
					}}
					delayLongPress={180}
				>
					<View className="flex-row items-center gap-2.5">
						<View className="rounded-xl border border-white/8 bg-white/[0.04] p-2">
							<FolderOpen size={16} color="#E4E4E7" />
						</View>
						<View className="min-w-0 flex-1">
							<View className="flex-row items-center gap-2">
								<Text className="text-sm font-semibold text-zinc-100" numberOfLines={1}>{folder.name}</Text>
								{folder.newCardsPaused ? (
									<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-amber-200">
										Paused
									</Text>
								) : null}
							</View>
							<Text className="mt-0.5 text-xs text-zinc-500">
								{folder.childDeckCount} {folder.childDeckCount === 1 ? "deck" : "decks"} • {folder.cardCount} cards • {folder.dueCount} due
							</Text>
						</View>
					</View>
				</TouchableOpacity>
				{folder.dueCount > 0 ? (
					<View className="rounded-lg bg-amber-400/10 px-2 py-0.5">
						<Text className="text-xs font-semibold text-amber-300">{folder.dueCount}</Text>
					</View>
				) : null}
				<TouchableOpacity
					activeOpacity={0.85}
					className="h-11 w-11 items-center justify-center rounded-xl border border-white/8 bg-[#15171A]"
					onPress={onToggle}
					accessibilityLabel={isExpanded ? "Collapse folder" : "Expand folder"}
				>
					{isExpanded ? (
						<ChevronDown size={18} color="#A1A1AA" />
					) : (
						<ChevronRight size={18} color="#A1A1AA" />
					)}
				</TouchableOpacity>
			</View>
			{isExpanded ? (
				<View className="mt-2 gap-1.5 border-t border-white/8 pt-2">
					{folder.decks.length === 0 ? (
						<View className="rounded-lg border border-white/8 bg-[#15171A] px-3 py-2">
							<Text className="text-xs text-zinc-400">
								Empty folder. Add decks from a deck’s action menu.
							</Text>
						</View>
					) : (
						folder.decks
							.filter((deck) => !deck.primaryDeckId)
							.map((deck) => (
								<DeckComponent
									key={deck.id}
									deck={deck}
									onOpenReview={onOpenDeckReview}
									onOpenDeckMenu={onOpenDeckMenu}
									isChild
									linkedDecks={folder.decks.filter(
										(d) => d.primaryDeckId === deck.id,
									)}
									isExpanded={Boolean(expandedPrimaryDecks[deck.id])}
									onToggle={() => onTogglePrimaryDeck(deck.id)}
								/>
							))
					)}
				</View>
			) : null}
		</View>
	);
};

type ActionMenuItem =
	| { type: "action"; label: string; icon: React.ReactNode; onPress: () => void; disabled?: boolean }
	| { type: "destructive"; label: string; icon: React.ReactNode; onPress: () => void }
	| { type: "separator" };

const ActionMenuModal = ({
	visible,
	title,
	actions,
	onClose,
}: {
	visible: boolean;
	title: string | null;
	actions: ActionMenuItem[];
	onClose: () => void;
}) => {
	return (
		<Modal transparent visible={visible} animationType="fade" onRequestClose={onClose}>
			<Pressable className="flex-1 bg-black/60 px-4" onPress={onClose}>
				<View className="flex-1 justify-end">
					<Pressable
						className="mb-4 rounded-xl border border-white/10 bg-[#111214] p-2"
						onPress={(event) => event.stopPropagation()}
					>
						{title ? (
							<View className="px-2 pb-2 pt-1.5">
								<Text className="text-sm font-semibold text-zinc-100" numberOfLines={1}>
									{title}
								</Text>
							</View>
						) : null}
						{actions.map((item, index) => {
							if (item.type === "separator") {
								return <View key={`sep-${index}`} className="mx-2 my-1 border-t border-white/6" />;
							}

							const isDestructive = item.type === "destructive";
							return (
								<Pressable
									key={`${item.label}-${index}`}
									className="flex-row items-center gap-3 rounded-lg px-3 py-3"
									onPress={item.onPress}
									disabled={"disabled" in item ? item.disabled : false}
								>
									{item.icon}
									<Text className={`text-sm ${isDestructive ? "text-red-200" : "text-zinc-100"}`}>
										{item.label}
									</Text>
								</Pressable>
							);
						})}
					</Pressable>
				</View>
			</Pressable>
		</Modal>
	);
};

const FolderReviewLimitsModal = ({
	folder,
	value,
	newCardsPaused,
	onChange,
	onChangeNewCardsPaused,
	onClose,
	onSave,
	isSaving,
}: {
	folder: DeckFolderListItem | null;
	value: ReviewLimitSettings;
	newCardsPaused: boolean;
	onChange: (value: ReviewLimitSettings) => void;
	onChangeNewCardsPaused: (value: boolean) => void;
	onClose: () => void;
	onSave: () => void;
	isSaving: boolean;
}) => {
	const savedValue = folder ? getFolderReviewLimitSettings(folder) : normalizeReviewLimitSettings();
	const hasChanges =
		newCardsPaused !== Boolean(folder?.newCardsPaused) ||
		value.newLimitEnabled !== savedValue.newLimitEnabled ||
		value.newLimit !== savedValue.newLimit ||
		value.totalLimitEnabled !== savedValue.totalLimitEnabled ||
		value.totalLimit !== savedValue.totalLimit;

	return (
		<Modal transparent visible={Boolean(folder)} animationType="fade" onRequestClose={onClose}>
			<View className="flex-1 items-center justify-center bg-black/60 px-4">
				<View className="w-full rounded-[28px] border border-white/10 bg-[#111214] p-4">
					<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
						Folder Review Limits
					</Text>
					<Text className="mt-2 text-2xl font-semibold text-zinc-100">
						{folder?.name ?? "Folder"}
					</Text>
					<Text className="mt-2 text-sm leading-5 text-zinc-400">
						These caps apply when reviewing this folder. Child deck limits still apply first.
					</Text>

					<View className="mt-5 rounded-3xl border border-white/8 bg-[#17181B] p-4">
						<Text className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
							New Cards
						</Text>
						<Text className="mt-2 text-sm leading-5 text-zinc-300">
							Pause FSRS new cards across this folder before deck and folder review limits
							are applied.
						</Text>
						<Button
							onPress={() => onChangeNewCardsPaused(!newCardsPaused)}
							disabled={isSaving}
							variant="secondary"
							className="mt-4 h-11 rounded-2xl border border-white/8 bg-[#1C1E22]"
						>
							<Text className="font-medium text-zinc-100">
								{newCardsPaused ? "Resume new cards" : "Pause new cards"}
							</Text>
						</Button>
					</View>

					<View className="mt-5">
						<ReviewLimitEditor value={value} onChange={onChange} />
					</View>

					<View className="mt-4 flex-row gap-2">
						<Button
							onPress={onClose}
							disabled={isSaving}
							variant="secondary"
							className="h-11 flex-1 rounded-2xl border border-white/8 bg-[#17181B]"
						>
							<Text className="font-medium text-zinc-200">Cancel</Text>
						</Button>
						<Button
							onPress={onSave}
							disabled={!hasChanges || isSaving}
							className="h-11 flex-1 rounded-2xl bg-zinc-100 disabled:bg-zinc-700"
						>
							<Text className="font-medium text-zinc-900">
								{isSaving ? "Saving..." : "Save limits"}
							</Text>
						</Button>
					</View>
				</View>
			</View>
		</Modal>
	);
};

const FolderAssignmentModal = ({
	deck,
	folders,
	isVisible,
	searchValue,
	onChangeSearch,
	onClose,
	onSelectFolder,
	onRemoveFromFolder,
	isLoading,
	isSaving,
}: {
	deck: DeckListItem | null;
	folders: DeckFolderListItem[];
	isVisible: boolean;
	searchValue: string;
	onChangeSearch: (value: string) => void;
	onClose: () => void;
	onSelectFolder: (folderId: string) => void;
	onRemoveFromFolder: () => void;
	isLoading: boolean;
	isSaving: boolean;
}) => {
	return (
		<Modal transparent visible={isVisible} animationType="fade" onRequestClose={onClose}>
			<View className="flex-1 items-center justify-center bg-black/60 px-4">
				<View className="max-h-[85%] w-full rounded-[28px] border border-white/10 bg-[#111214] p-4">
					<ScrollView showsVerticalScrollIndicator={false}>
						<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
							Add to Folder
						</Text>
						<Text className="mt-2 text-2xl font-semibold text-zinc-100">
							{deck?.name ?? "Deck"}
						</Text>
						<Text className="mt-2 text-sm leading-5 text-zinc-400">
							Choose a folder for this deck. Folder review will merge reviews from all
							child decks.
						</Text>

						<View className="mt-5 gap-2">
							<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
								Search folders
							</Text>
							<Input
								value={searchValue}
								onChangeText={onChangeSearch}
								placeholder="Search folders"
								placeholderTextColor="#71717a"
								className="rounded-2xl border border-white/8 bg-[#17181B] px-4 py-3 text-base text-zinc-100"
							/>
						</View>

						{deck?.folderId ? (
							<Button
								onPress={onRemoveFromFolder}
								disabled={isSaving}
								variant="secondary"
								className="mt-5 h-11 rounded-2xl border border-white/8 bg-[#17181B]"
							>
								<Text className="font-medium text-zinc-100">Remove from current folder</Text>
							</Button>
						) : null}

						<View className="mt-5 gap-2">
							<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
								Folders
							</Text>
							{isLoading ? (
								<View className="rounded-2xl border border-white/8 bg-[#17181B] px-4 py-3">
									<View className="flex-row items-center gap-2">
										<LoaderCircle size={16} color="#E4E4E7" />
										<Text className="text-sm text-zinc-300">Loading folders...</Text>
									</View>
								</View>
							) : folders.length === 0 ? (
								<View className="rounded-2xl border border-white/8 bg-[#17181B] px-4 py-3">
									<Text className="text-sm leading-5 text-zinc-400">
										No folders yet. Create one from the decks page header.
									</Text>
								</View>
							) : (
								folders.map((folder) => (
									<Pressable
										key={folder.id}
										onPress={() => onSelectFolder(folder.id)}
										className={`rounded-2xl border px-4 py-3 ${
											deck?.folderId === folder.id
												? "border-white/12 bg-white/[0.06]"
												: "border-white/8 bg-[#17181B]"
										}`}
									>
										<Text className="text-base font-medium text-zinc-100">
											{folder.name}
										</Text>
										<Text className="mt-1 text-sm text-zinc-500">
											{folder.childDeckCount} {folder.childDeckCount === 1 ? "deck" : "decks"} •{" "}
											{folder.dueCount} due
										</Text>
									</Pressable>
								))
							)}
						</View>
					</ScrollView>

					<View className="mt-4 flex-row gap-2">
						<Button
							onPress={onClose}
							disabled={isSaving}
							variant="secondary"
							className="h-11 flex-1 rounded-2xl border border-white/8 bg-[#17181B]"
						>
							<Text className="font-medium text-zinc-200">Close</Text>
						</Button>
					</View>
				</View>
			</View>
		</Modal>
	);
};

const CreateFolderModal = ({
	isVisible,
	name,
	onChangeName,
	onClose,
	onSubmit,
	isSubmitting,
}: {
	isVisible: boolean;
	name: string;
	onChangeName: (value: string) => void;
	onClose: () => void;
	onSubmit: () => void;
	isSubmitting: boolean;
}) => {
	return (
		<Modal transparent visible={isVisible} animationType="fade" onRequestClose={onClose}>
			<Pressable className="flex-1 bg-black/60 px-4" onPress={onClose}>
				<View className="flex-1 justify-end">
					<Pressable
						className="mb-4 rounded-xl border border-white/10 bg-[#111214] p-3"
						onPress={(event) => event.stopPropagation()}
					>
						<Text className="text-sm font-semibold text-zinc-100">
							New Folder
						</Text>

						<View className="mt-3 gap-1.5">
							<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
								Name
							</Text>
							<Input
								value={name}
								onChangeText={onChangeName}
								placeholder="Example: Tobira 1"
								placeholderTextColor="#71717a"
								autoFocus
								className="rounded-lg border border-white/8 bg-[#17181B] px-3 py-2.5 text-sm text-zinc-100"
							/>
						</View>

						<View className="mt-3 flex-row gap-1.5">
							<Button
								onPress={onClose}
								disabled={isSubmitting}
								variant="secondary"
								className="h-10 flex-1 rounded-xl border border-white/8 bg-[#17181B]"
							>
								<Text className="text-sm font-medium text-zinc-200">Cancel</Text>
							</Button>
							<Button
								onPress={onSubmit}
								disabled={isSubmitting}
								className="h-10 flex-1 rounded-xl bg-zinc-100"
							>
								<Text className="text-sm font-medium text-zinc-900">
									{isSubmitting ? "Creating..." : "Create"}
								</Text>
							</Button>
						</View>
					</Pressable>
				</View>
			</Pressable>
		</Modal>
	);
};

const CreateDeckModal = ({
	isVisible,
	name,
	onChangeName,
	onClose,
	onSubmit,
	isSubmitting,
}: {
	isVisible: boolean;
	name: string;
	onChangeName: (value: string) => void;
	onClose: () => void;
	onSubmit: () => void;
	isSubmitting: boolean;
}) => {
	return (
		<Modal transparent visible={isVisible} animationType="fade" onRequestClose={onClose}>
			<Pressable className="flex-1 bg-black/60 px-4" onPress={onClose}>
				<View className="flex-1 justify-end">
					<Pressable
						className="mb-4 rounded-xl border border-white/10 bg-[#111214] p-3"
						onPress={(event) => event.stopPropagation()}
					>
						<Text className="text-sm font-semibold text-zinc-100">
							New Deck
						</Text>

						<View className="mt-3 gap-1.5">
							<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
								Name
							</Text>
							<Input
								value={name}
								onChangeText={onChangeName}
								placeholder="Example: HSK 1 Core"
								placeholderTextColor="#71717a"
								autoFocus
								className="rounded-lg border border-white/8 bg-[#17181B] px-3 py-2.5 text-sm text-zinc-100"
							/>
						</View>

						<View className="mt-3 flex-row gap-1.5">
							<Button
								onPress={onClose}
								disabled={isSubmitting}
								variant="secondary"
								className="h-10 flex-1 rounded-xl border border-white/8 bg-[#17181B]"
							>
								<Text className="text-sm font-medium text-zinc-200">Cancel</Text>
							</Button>
							<Button
								onPress={onSubmit}
								disabled={isSubmitting}
								className="h-10 flex-1 rounded-xl bg-zinc-100"
							>
								<Text className="text-sm font-medium text-zinc-900">
									{isSubmitting ? "Creating..." : "Create"}
								</Text>
							</Button>
						</View>
					</Pressable>
				</View>
			</Pressable>
		</Modal>
	);
};
