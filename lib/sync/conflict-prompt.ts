import { Alert } from "react-native";
import type { ManualSyncConflictSummary, SyncConflictStrategy } from "@/lib/sync/client";

const formatConflictSummary = (summary: ManualSyncConflictSummary) => {
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

export const promptForConflictResolution = (
	summary: ManualSyncConflictSummary,
): Promise<SyncConflictStrategy | null> =>
	new Promise((resolve) => {
		Alert.alert(
			"Sync conflict detected",
			`Both this device and the cloud changed ${summary.total} item${
				summary.total === 1 ? "" : "s"
			}.\n\nConflicts: ${formatConflictSummary(summary)}\n\nChoose which version should win for this sync.`,
			[
				{
					text: "Cancel",
					style: "cancel",
					onPress: () => resolve(null),
				},
				{
					text: "Keep Remote",
					onPress: () => resolve("remote"),
				},
				{
					text: "Keep Local",
					onPress: () => resolve("local"),
				},
			],
		);
	});
