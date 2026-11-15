import { useCallback, useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { RotateCcw, Trash2 } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import {
	emptyTrash,
	getDeletedTrashSnapshot,
	type DeletedDeckFolderListItem,
	type DeletedDeckListItem,
	restoreDeck,
	restoreDeckFolder,
} from "@/lib/store/decksStore";
import { useAppLanguage } from "@/lib/store/appLanguageStore";

const formatDeletedAt = (value: string | null | undefined) => {
	if (!value) return "Unknown";

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return parsed.toLocaleString();
};

export default function TrashPage() {
	const drizzle = useDrizzle();
	const { activeLanguageId } = useAppLanguage();
	const [deletedFolders, setDeletedFolders] = useState<DeletedDeckFolderListItem[]>([]);
	const [deletedDecks, setDeletedDecks] = useState<DeletedDeckListItem[]>([]);
	const [restoringItemId, setRestoringItemId] = useState<string | null>(null);
	const [isEmptyingTrash, setIsEmptyingTrash] = useState(false);

	const loadDeletedDecks = useCallback(async () => {
		const snapshot = await getDeletedTrashSnapshot(drizzle, activeLanguageId);
		setDeletedFolders(snapshot.folders);
		setDeletedDecks(snapshot.decks);
	}, [activeLanguageId, drizzle]);

	const runRestoreDeck = useCallback(
		async (deck: DeletedDeckListItem) => {
			if (restoringItemId) {
				return;
			}

			setRestoringItemId(deck.id);
			try {
				const result = await restoreDeck(drizzle, deck.id);
				await loadDeletedDecks();

				if (result.status === "missing_deck") {
					Alert.alert("Deck not found", "This deck is no longer available.");
				}
			} catch (error) {
				console.error("Failed to restore deck.", error);
				Alert.alert("Restore failed", "The deck could not be restored.");
			} finally {
				setRestoringItemId(null);
			}
		},
		[drizzle, loadDeletedDecks, restoringItemId],
	);

	const runRestoreFolder = useCallback(
		async (folder: DeletedDeckFolderListItem) => {
			if (restoringItemId) {
				return;
			}

			setRestoringItemId(folder.id);
			try {
				const result = await restoreDeckFolder(drizzle, folder.id);
				await loadDeletedDecks();

				if (result.status === "missing_folder") {
					Alert.alert("Folder not found", "This folder is no longer available.");
				}
			} catch (error) {
				console.error("Failed to restore folder.", error);
				Alert.alert("Restore failed", "The folder could not be restored.");
			} finally {
				setRestoringItemId(null);
			}
		},
		[drizzle, loadDeletedDecks, restoringItemId],
	);

	const handleRestoreDeckPress = useCallback(
		(deck: DeletedDeckListItem) => {
			if (restoringItemId) {
				return;
			}

			Alert.alert(
				`Restore "${deck.name}"?`,
				"This moves the deck and its cards back to your main deck list.",
				[
					{ text: "Cancel", style: "cancel" },
					{
						text: "Restore",
						onPress: () => {
							void runRestoreDeck(deck);
						},
					},
				],
			);
		},
		[restoringItemId, runRestoreDeck],
	);

	const handleRestoreFolderPress = useCallback(
		(folder: DeletedDeckFolderListItem) => {
			if (restoringItemId) {
				return;
			}

			Alert.alert(
				`Restore "${folder.name}"?`,
				"This restores the folder and all decks currently inside it.",
				[
					{ text: "Cancel", style: "cancel" },
					{
						text: "Restore",
						onPress: () => {
							void runRestoreFolder(folder);
						},
					},
				],
			);
		},
		[restoringItemId, runRestoreFolder],
	);

	const runEmptyTrash = useCallback(async () => {
		if (isEmptyingTrash || restoringItemId) {
			return;
		}

		setIsEmptyingTrash(true);
		try {
			const result = await emptyTrash(drizzle, activeLanguageId);
			await loadDeletedDecks();

			if (result.status === "emptied") {
				Alert.alert(
					"Trash emptied",
					`Deleted ${result.deletedFolderCount} ${result.deletedFolderCount === 1 ? "folder" : "folders"} and ${result.deletedDeckCount} ${result.deletedDeckCount === 1 ? "deck" : "decks"} permanently.`,
				);
			}
		} catch (error) {
			console.error("Failed to empty trash.", error);
			Alert.alert("Empty trash failed", "Trash could not be emptied.");
		} finally {
			setIsEmptyingTrash(false);
		}
	}, [activeLanguageId, drizzle, isEmptyingTrash, loadDeletedDecks, restoringItemId]);

	const handleEmptyTrashPress = useCallback(() => {
		if (
			deletedDecks.length === 0 &&
			deletedFolders.length === 0
		) {
			return;
		}

		if (isEmptyingTrash || restoringItemId) {
			return;
		}

		Alert.alert(
			"Empty trash?",
			"This permanently deletes all trashed decks and folders in this language. This cannot be undone.",
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Empty trash",
					style: "destructive",
					onPress: () => {
						void runEmptyTrash();
					},
				},
			],
		);
	}, [deletedDecks.length, deletedFolders.length, isEmptyingTrash, restoringItemId, runEmptyTrash]);

	useFocusEffect(
		useCallback(() => {
			void loadDeletedDecks();
		}, [loadDeletedDecks]),
	);

	return (
		<ScrollView className="flex-1 bg-[#0F1012]" contentContainerClassName="gap-2 px-3 pb-4 pt-3">
			<View className="border-b border-white/8 pb-2.5">
				<View className="flex-row items-center justify-between gap-2">
					<View className="min-w-0 flex-1">
						<Text className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
							Archive
						</Text>
						<Text className="mt-0.5 text-lg font-semibold text-zinc-100">
							Trash
						</Text>
					</View>
					<Button
						onPress={handleEmptyTrashPress}
						disabled={
							(deletedDecks.length === 0 && deletedFolders.length === 0) ||
							isEmptyingTrash ||
							restoringItemId !== null
						}
						className="h-9 rounded-xl border border-red-500/30 bg-red-500/[0.12] px-3"
					>
						<View className="flex-row items-center gap-1.5">
							<Trash2 size={14} color="#FCA5A5" />
							<Text className="text-sm text-red-100">
								{isEmptyingTrash ? "Emptying..." : "Empty"}
							</Text>
						</View>
					</Button>
				</View>
			</View>

			{deletedFolders.length === 0 && deletedDecks.length === 0 ? (
				<View className="rounded-xl border border-white/10 bg-[#111214] px-3 py-3">
					<Text className="text-sm font-semibold text-zinc-100">Trash is empty</Text>
					<Text className="mt-0.5 text-xs text-zinc-400">
						Deleted decks and folders will appear here.
					</Text>
				</View>
			) : (
				<>
					{deletedFolders.map((folder) => (
						<View
							key={folder.id}
							className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2.5"
						>
							<View className="flex-row items-center justify-between gap-2">
								<View className="min-w-0 flex-1 gap-0.5">
									<Text className="text-sm font-semibold text-zinc-100" numberOfLines={1}>
										{folder.name}
									</Text>
									<Text className="text-xs text-zinc-500">
										{folder.childDeckCount} {folder.childDeckCount === 1 ? "deck" : "decks"} • {folder.deletedCardCount} cards • {formatDeletedAt(folder.deletedAt)}
									</Text>
								</View>
								<Button
									onPress={() => handleRestoreFolderPress(folder)}
									disabled={restoringItemId !== null}
									className="h-8 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.12] px-2.5"
								>
									<View className="flex-row items-center gap-1.5">
										<RotateCcw size={12} color="#86EFAC" />
										<Text className="text-xs text-emerald-100">
											{restoringItemId === folder.id ? "..." : "Restore"}
										</Text>
									</View>
								</Button>
							</View>
							{folder.decks.length > 0 ? (
								<View className="mt-2 border-t border-white/6 pt-2">
									{folder.decks.map((deck, index) => (
										<View
											key={deck.id}
											className={index > 0 ? "mt-1.5 border-t border-white/6 pt-1.5" : ""}
										>
											<Text className="text-xs font-medium text-zinc-300">
												{deck.name}
											</Text>
											<Text className="text-[11px] text-zinc-500">
												{deck.deletedCardCount} {deck.deletedCardCount === 1 ? "card" : "cards"}
											</Text>
										</View>
									))}
								</View>
							) : null}
						</View>
					))}

					{deletedDecks.map((deck) => (
						<View
							key={deck.id}
							className="rounded-xl border border-white/10 bg-[#111214] px-3 py-2.5"
						>
							<View className="flex-row items-center justify-between gap-2">
								<View className="min-w-0 flex-1 gap-0.5">
									<Text className="text-sm font-semibold text-zinc-100" numberOfLines={1}>
										{deck.name}
									</Text>
									<Text className="text-xs text-zinc-500">
										{deck.deletedCardCount} {deck.deletedCardCount === 1 ? "card" : "cards"} • {formatDeletedAt(deck.deletedAt)}
									</Text>
								</View>
								<Button
									onPress={() => handleRestoreDeckPress(deck)}
									disabled={restoringItemId !== null}
									className="h-8 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.12] px-2.5"
								>
									<View className="flex-row items-center gap-1.5">
										<RotateCcw size={12} color="#86EFAC" />
										<Text className="text-xs text-emerald-100">
											{restoringItemId === deck.id ? "..." : "Restore"}
										</Text>
									</View>
								</Button>
							</View>
						</View>
					))}
				</>
			)}
		</ScrollView>
	);
}
