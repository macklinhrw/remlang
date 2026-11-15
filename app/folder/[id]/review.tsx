import { useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { useFocusEffect } from "@react-navigation/native";
import {
	ActivityIndicator,
	ScrollView,
	TouchableOpacity,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, RotateCcw } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import {
	getKnowledgeVariantLabel,
	Pill,
	ReviewAnswerCard,
	ReviewBottomBar,
	ReviewPromptCard,
} from "@/components/review/review-cards";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { useFolderReviewSession } from "@/lib/store/deckReviewStore";
import { useAppLanguage } from "@/lib/store/appLanguageStore";
import { getReviewTypeLabel } from "@/lib/review/fsrs";

export default function FolderReviewPage() {
	const router = useRouter();
	const drizzle = useDrizzle();
	const insets = useSafeAreaInsets();
	const { id } = useLocalSearchParams<{ id?: string }>();
	const { activeLanguageId } = useAppLanguage();
	const {
		session,
		isLoading,
		isAnswerVisible,
		preview,
		isSubmitting,
		isUndoing,
		isRefreshingSession,
		reviewedCount,
		errorMessage,
		undoErrorMessage,
		canUndoPreviousReview,
		reviewIndex,
		currentCard,
		reviewCount,
		remainingCount,
		isFinished,
		reload,
		revealAnswer,
		submitRating,
		undoPrevious,
	} = useFolderReviewSession({
		db: drizzle,
		folderId: id ?? null,
		languageId: activeLanguageId,
	});
	const [isRevealUiVisible, setIsRevealUiVisible] = useState(false);

	useEffect(() => {
		setIsRevealUiVisible(false);
	}, [currentCard?.id]);

	useEffect(() => {
		if (!isAnswerVisible) {
			setIsRevealUiVisible(false);
		}
	}, [isAnswerVisible]);

	const showAnswerUi = isRevealUiVisible || isAnswerVisible;

	const handleRevealAnswer = useCallback(() => {
		if (!currentCard) {
			return;
		}
		setIsRevealUiVisible(true);

		requestAnimationFrame(() => {
			revealAnswer();
		});
	}, [currentCard, revealAnswer]);

	useFocusEffect(
		useCallback(() => {
			void reload({
				showSpinner: false,
				indicateRefresh: false,
				resetProgressState: true,
			});
		}, [reload]),
	);

	if (isLoading) {
		return (
			<View className="flex-1 items-center justify-center bg-[#0F1012]">
				<ActivityIndicator color="#A1A1AA" />
				<Text className="mt-3 text-zinc-400">Loading review queue...</Text>
			</View>
		);
	}

	if (!session) {
		return (
			<View className="flex-1 items-center justify-center gap-3 bg-[#0F1012] p-4">
				<Text className="text-zinc-100">Folder not found.</Text>
				<TouchableOpacity
					activeOpacity={0.85}
					className="rounded-xl border border-white/8 bg-[#141518] px-4 py-3"
					onPress={() => router.replace("/decks")}
				>
					<Text className="font-medium text-zinc-200">Back to decks</Text>
				</TouchableOpacity>
			</View>
		);
	}

	if (session.target.type !== "folder") {
		return (
			<View className="flex-1 items-center justify-center bg-[#0F1012]">
				<ActivityIndicator color="#A1A1AA" />
				<Text className="mt-3 text-zinc-400">Loading review queue...</Text>
			</View>
		);
	}

	if (isFinished) {
		return (
			<View className="flex-1 bg-[#0F1012] px-3 pb-4 pt-3">
				<View className="border-b border-white/8 pb-3">
					<View className="flex-row items-start justify-between gap-3">
						<View className="min-w-0 flex-1">
							<Text className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
								Folder Review
							</Text>
							<Text className="mt-1 text-lg font-semibold text-zinc-100">
								{session.folder.name}
							</Text>
						</View>
						<TouchableOpacity
							activeOpacity={0.85}
							disabled={!canUndoPreviousReview || isUndoing || isRefreshingSession}
							className="h-9 flex-row items-center gap-2 rounded-xl border border-white/8 bg-[#141518] px-3"
							style={{
								opacity:
									canUndoPreviousReview && !isRefreshingSession ? 1 : 0.45,
							}}
							onPress={() => void undoPrevious()}
						>
							{isUndoing ? (
								<ActivityIndicator size="small" color="#E4E4E7" />
							) : (
								<RotateCcw size={14} color="#E4E4E7" />
							)}
							<Text className="text-sm text-zinc-100">
								{isUndoing ? "Undoing..." : "Undo"}
							</Text>
						</TouchableOpacity>
					</View>
				</View>
				<View className="flex-1 items-center justify-center">
					<View className="w-full max-w-[420px] rounded-xl border border-white/8 bg-[#121315] px-4 py-4">
						<View className="h-10 w-10 items-center justify-center rounded-xl border border-emerald-500/30 bg-emerald-500/10">
							<Check size={18} color="#86EFAC" />
						</View>
						<Text className="mt-3 text-lg font-semibold text-zinc-100">
							Session complete
						</Text>
						<Text className="mt-1 text-sm leading-5 text-zinc-400">
							Reviewed {reviewedCount} {reviewedCount === 1 ? "card" : "cards"} from this folder.
						</Text>
						<View className="mt-4 flex-row gap-2">
							<Button
								onPress={() =>
									void reload({
										showSpinner: false,
										indicateRefresh: true,
										resetProgressState: true,
									})
								}
								disabled={isRefreshingSession}
								className="h-10 flex-1 rounded-xl border border-white/8 bg-[#17191c]"
							>
								<View className="flex-row items-center gap-2">
									{isRefreshingSession ? (
										<ActivityIndicator size="small" color="#E4E4E7" />
									) : (
										<RotateCcw size={14} color="#E4E4E7" />
									)}
									<Text className="text-sm text-zinc-100">
										{isRefreshingSession ? "Reloading..." : "Reload queue"}
									</Text>
								</View>
							</Button>
							<Button
								onPress={() => router.replace("/decks")}
								className="h-10 flex-1 rounded-xl border border-white/8 bg-[#17191c]"
							>
								<Text className="text-sm text-zinc-100">Back to decks</Text>
							</Button>
						</View>
						<TouchableOpacity
							activeOpacity={0.85}
							disabled={!canUndoPreviousReview || isUndoing || isSubmitting}
							className="h-9 flex-row items-center gap-2 rounded-xl border border-white/8 bg-[#141518] px-3"
							style={{
								opacity:
									canUndoPreviousReview && !isSubmitting ? 1 : 0.45,
							}}
							onPress={() => void undoPrevious()}
						>
							{isUndoing ? (
								<ActivityIndicator size="small" color="#E4E4E7" />
							) : (
								<RotateCcw size={14} color="#E4E4E7" />
							)}
							<Text className="text-sm text-zinc-100">
								{isUndoing ? "Undoing..." : "Undo"}
							</Text>
						</TouchableOpacity>
					</View>
				</View>
			</View>
		);
	}

	if (!currentCard) {
		if (!isFinished) {
			return (
				<View className="flex-1 items-center justify-center gap-3 bg-[#0F1012] p-4">
					<ActivityIndicator color="#A1A1AA" />
					<Text className="text-zinc-100">
						{isRefreshingSession ? "Refreshing queue..." : "Loading next reviews..."}
					</Text>
					{errorMessage ? (
						<>
							<Text className="text-center text-zinc-500">{errorMessage}</Text>
							<Button
								onPress={() =>
									void reload({
										showSpinner: false,
										indicateRefresh: true,
										resetProgressState: false,
									})
								}
								className="mt-2 rounded-xl border border-white/8 bg-[#141518]"
							>
								<Text className="text-zinc-100">Retry queue refresh</Text>
							</Button>
						</>
					) : null}
				</View>
			);
		}

		return (
			<View className="flex-1 items-center justify-center gap-3 bg-[#0F1012] p-4">
				<Text className="text-zinc-100">Nothing due</Text>
				<Text className="text-center text-zinc-500">This folder is clear for now.</Text>
				<Button
					onPress={() => router.replace("/decks")}
					className="mt-2 rounded-xl border border-white/8 bg-[#141518]"
				>
					<Text className="text-zinc-100">Back to decks</Text>
				</Button>
			</View>
		);
	}

	const isStrokeReview = currentCard.knowledge.reviewType === "Stroke";
	const bottomAlignStroke = isStrokeReview && !isAnswerVisible;

	return (
		<View className="flex-1 bg-[#0F1012]">
			<ScrollView
				className="flex-1"
				contentContainerClassName={`px-4 pt-3${bottomAlignStroke ? " flex-1" : ""}`}
				contentContainerStyle={{
					paddingBottom:
						(isAnswerVisible ? 180 : 80) + Math.max(insets.bottom, 12),
				}}
				showsVerticalScrollIndicator={false}
				scrollEnabled={
					isAnswerVisible || currentCard.knowledge.reviewType !== "Stroke"
				}
			>
				<View className="border-b border-white/8 pb-2.5">
					<View className="flex-row items-center justify-between gap-2">
						<View className="min-w-0 flex-1">
							<View className="flex-row items-center gap-2">
								<Text className="text-sm font-semibold text-zinc-100" numberOfLines={1}>
									{session.folder.name}
								</Text>
								<Text className="text-xs text-zinc-500">
									{reviewIndex + 1}/{reviewCount}
								</Text>
							</View>
							<View className="mt-1 flex-row flex-wrap gap-1.5">
								<Pill>{remainingCount} left</Pill>
								<Pill>{getReviewTypeLabel(currentCard.knowledge.reviewType)}</Pill>
								<Pill>{getKnowledgeVariantLabel(currentCard.knowledge)}</Pill>
							</View>
						</View>
					</View>
				</View>

				{bottomAlignStroke ? <View className="flex-1" /> : null}

				<View className="pt-4">
					<ReviewPromptCard card={currentCard} />
				</View>

				{isAnswerVisible ? (
					<View className="pt-4">
						<ReviewAnswerCard
							card={currentCard}
							originPath={`/folder/${session.folder.id}/review`}
						/>
					</View>
				) : null}

				{errorMessage ? (
					<View className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2">
						<Text className="text-sm text-red-200">{errorMessage}</Text>
					</View>
				) : null}

				{undoErrorMessage ? (
					<View className="mt-3 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2">
						<Text className="text-sm text-red-200">{undoErrorMessage}</Text>
					</View>
				) : null}
			</ScrollView>

			<ReviewBottomBar
				isAnswerVisible={showAnswerUi}
				isSubmitting={isSubmitting}
				onReveal={handleRevealAnswer}
				onRate={submitRating}
				preview={preview}
			/>
		</View>
	);
}
