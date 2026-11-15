import * as React from "react";
import { useFocusEffect } from "@react-navigation/native";
import { ActivityIndicator, Pressable, ScrollView, View } from "react-native";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { getReviewTypeLabel } from "@/lib/review/fsrs";
import {
	VISIBLE_REVIEW_TYPES,
	type VisibleReviewType,
} from "@/lib/review/reviewTypeConfig";
import {
	getKnownCardsCount,
	getReviewHistoryStats,
	getTodayReviewStats,
	type ReviewHistoryStat,
	type StatsReviewTypeFilter,
} from "@/lib/stats/queries";
import { useAppLanguage } from "@/lib/store/appLanguageStore";

type ChartMode = "total" | "new";
type StatisticsReviewTypeFilter = "all" | VisibleReviewType;

type StatisticsSnapshot = {
	newReviewedToday: number;
	totalReviewedToday: number;
	knownCardsCount: number;
	history: ReviewHistoryStat[];
};

const CHART_DAYS = 30;

const formatChartLabel = (value: string) => {
	const date = new Date(`${value}T12:00:00`);
	return date.toLocaleDateString(undefined, {
		month: "short",
		day: "numeric",
	});
};

export default function StatisticsPage() {
	const drizzle = useDrizzle();
	const { activeLanguageId, availableLanguages } = useAppLanguage();
	const [snapshot, setSnapshot] = React.useState<StatisticsSnapshot | null>(
		null,
	);
	const [isLoading, setIsLoading] = React.useState(true);
	const [errorMessage, setErrorMessage] = React.useState<string | null>(null);
	const [chartMode, setChartMode] = React.useState<ChartMode>("total");
	const [selectedReviewType, setSelectedReviewType] =
		React.useState<StatisticsReviewTypeFilter>("all");

	const activeLanguage =
		availableLanguages.find((language) => language.id === activeLanguageId) ??
		null;
	const reviewTypeFilter: StatsReviewTypeFilter =
		selectedReviewType === "all" ? null : selectedReviewType;

	const loadStatistics = React.useCallback(
		async ({ showSpinner = false }: { showSpinner?: boolean } = {}) => {
			if (showSpinner) {
				setIsLoading(true);
			}

			try {
				const [todayStats, history, knownCardsCount] = await Promise.all([
					getTodayReviewStats(drizzle, activeLanguageId, reviewTypeFilter),
					getReviewHistoryStats(
						drizzle,
						activeLanguageId,
						CHART_DAYS,
						undefined,
						reviewTypeFilter,
					),
					getKnownCardsCount(drizzle, activeLanguageId, reviewTypeFilter),
				]);

				setSnapshot({
					newReviewedToday: todayStats.newReviewedToday,
					totalReviewedToday: todayStats.totalReviewedToday,
					knownCardsCount,
					history,
				});
				setErrorMessage(null);
			} catch (error) {
				console.error("Failed to load statistics.", error);
				setErrorMessage("Unable to load study statistics.");
			} finally {
				setIsLoading(false);
			}
		},
		[activeLanguageId, drizzle, reviewTypeFilter],
	);

	React.useEffect(() => {
		void loadStatistics({ showSpinner: true });
	}, [loadStatistics]);

	useFocusEffect(
		React.useCallback(() => {
			void loadStatistics({ showSpinner: false });
		}, [loadStatistics]),
	);

	if (isLoading && !snapshot) {
		return (
			<View className="flex-1 items-center justify-center bg-[#0F1012]">
				<ActivityIndicator color="#A1A1AA" />
				<Text className="mt-3 text-zinc-400">Loading statistics...</Text>
			</View>
		);
	}

	const activeLanguageLabel = activeLanguage?.name ?? "Active language";

	return (
		<ScrollView
			className="flex-1 bg-[#0F1012]"
			contentContainerClassName="px-3 pb-5 pt-2"
			showsVerticalScrollIndicator={false}
		>
			{/* Language indicator */}
			<Text className="text-xs text-zinc-500">{activeLanguageLabel}</Text>

			{errorMessage ? (
				<View className="mt-2 rounded-xl border border-red-500/20 bg-red-500/[0.06] px-3 py-2.5">
					<Text className="text-sm text-red-200">{errorMessage}</Text>
				</View>
			) : null}

			{/* Review type filter pills - no container box */}
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerClassName="gap-2 pb-3 pt-2.5"
			>
				<ReviewTypeFilterChip
					label="All"
					active={selectedReviewType === "all"}
					onPress={() => setSelectedReviewType("all")}
				/>
				{VISIBLE_REVIEW_TYPES.map((reviewType) => (
					<ReviewTypeFilterChip
						key={reviewType}
						label={getReviewTypeLabel(reviewType)}
						active={selectedReviewType === reviewType}
						onPress={() => setSelectedReviewType(reviewType)}
					/>
				))}
			</ScrollView>

			{/* Metric cards - all 3 in one compact row */}
			<View className="flex-row gap-2">
				<MetricCard
					label="New"
					value={snapshot?.newReviewedToday ?? 0}
					tone="amber"
				/>
				<MetricCard
					label="Total Today"
					value={snapshot?.totalReviewedToday ?? 0}
					tone="sky"
				/>
				<MetricCard
					label="Known"
					value={snapshot?.knownCardsCount ?? 0}
					tone="emerald"
				/>
			</View>

			{/* 30-day chart */}
			<View className="mt-3 rounded-2xl border border-white/8 bg-[#141518] p-3">
				<View className="flex-row items-center justify-between">
					<Text className="text-sm font-semibold text-zinc-100">
						30-Day History
					</Text>
					<ChartToggle value={chartMode} onChange={setChartMode} />
				</View>
				<View className="mt-3">
					<ReviewHistoryChart
						history={snapshot?.history ?? []}
						mode={chartMode}
					/>
				</View>
			</View>
		</ScrollView>
	);
}

/* ------------------------------------------------------------------ */
/*  Sub-components                                                     */
/* ------------------------------------------------------------------ */

const MetricCard = ({
	label,
	value,
	tone,
}: {
	label: string;
	value: number;
	tone: "amber" | "sky" | "emerald";
}) => {
	const valueColor = {
		amber: "text-amber-200",
		sky: "text-sky-200",
		emerald: "text-emerald-200",
	}[tone];

	return (
		<View className="flex-1 rounded-xl bg-[#141518] px-2.5 pb-2.5 pt-2">
			<Text className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
				{label}
			</Text>
			<Text
				className={`mt-0.5 text-[26px] font-bold leading-tight ${valueColor}`}
			>
				{value.toLocaleString()}
			</Text>
		</View>
	);
};

const ChartToggle = ({
	value,
	onChange,
}: {
	value: ChartMode;
	onChange: (value: ChartMode) => void;
}) => (
	<View className="flex-row items-center rounded-full border border-white/8 bg-[#101114] p-1">
		{(
			[
				{ id: "total" as const, label: "Total" },
				{ id: "new" as const, label: "New" },
			] satisfies Array<{ id: ChartMode; label: string }>
		).map((option) => {
			const active = option.id === value;
			return (
				<Pressable
					key={option.id}
					onPress={() => onChange(option.id)}
					className={`rounded-full px-3 py-1.5 ${active ? "bg-white/[0.08]" : ""}`}
				>
					<Text
						className={`text-xs font-medium ${
							active ? "text-zinc-100" : "text-zinc-500"
						}`}
					>
						{option.label}
					</Text>
				</Pressable>
			);
		})}
	</View>
);

const ReviewTypeFilterChip = ({
	label,
	active,
	onPress,
}: {
	label: string;
	active: boolean;
	onPress: () => void;
}) => (
	<Pressable
		onPress={onPress}
		className={`rounded-full border px-3 py-1.5 ${
			active
				? "border-sky-300/30 bg-sky-400/12"
				: "border-white/8 bg-[#101114]"
		}`}
	>
		<Text
			className={`text-xs font-medium ${
				active ? "text-sky-100" : "text-zinc-400"
			}`}
		>
			{label}
		</Text>
	</Pressable>
);

const ReviewHistoryChart = ({
	history,
	mode,
}: {
	history: ReviewHistoryStat[];
	mode: ChartMode;
}) => {
	const values = history.map((entry) =>
		mode === "total" ? entry.totalReviewedCount : entry.newReviewedCount,
	);
	const maxValue = Math.max(...values, 0);
	const hasActivity = maxValue > 0;

	if (history.length === 0 || !hasActivity) {
		return (
			<View className="rounded-xl border border-dashed border-white/8 bg-[#101114] px-3 py-8">
				<Text className="text-center text-sm text-zinc-300">
					No reviews in the last 30 days.
				</Text>
				<Text className="mt-1 text-center text-xs leading-5 text-zinc-500">
					Study history will appear here once reviews are logged.
				</Text>
			</View>
		);
	}

	const total = values.reduce((a, b) => a + b, 0);
	const average = values.length > 0 ? Math.round(total / values.length) : 0;

	const lastIndex = history.length - 1;
	const labelPositions = [
		0,
		Math.round(lastIndex * 0.25),
		Math.round(lastIndex * 0.5),
		Math.round(lastIndex * 0.75),
		lastIndex,
	];

	return (
		<View className="gap-2">
			{/* Bar chart */}
			<View
				className="flex-row items-end gap-[3px] rounded-xl border border-white/8 bg-[#101114] px-2.5 pb-2 pt-4"
				style={{ height: 140 }}
			>
				{history.map((entry) => {
					const value =
						mode === "total"
							? entry.totalReviewedCount
							: entry.newReviewedCount;
					const ratio = maxValue > 0 ? value / maxValue : 0;
					const height =
						value === 0 ? 4 : Math.max(6, Math.round(ratio * 108));
					return (
						<View
							key={entry.date}
							className="min-w-0 flex-1 items-center justify-end"
						>
							<View
								className={`w-full rounded-sm ${
									mode === "total" ? "bg-sky-400/80" : "bg-amber-300/85"
								}`}
								style={{ height, opacity: value === 0 ? 0.25 : 1 }}
							/>
						</View>
					);
				})}
			</View>

			{/* Date labels - spaced independently to avoid wrapping */}
			<View className="flex-row justify-between px-2.5">
				{labelPositions.map((index) => (
					<Text key={index} className="text-[10px] text-zinc-600">
						{formatChartLabel(history[index].date)}
					</Text>
				))}
			</View>

			{/* Peak + Average */}
			<View className="flex-row gap-2">
				<View className="flex-1 flex-row items-center justify-between rounded-lg border border-white/8 bg-[#101114] px-2.5 py-1.5">
					<Text className="text-[11px] text-zinc-500">Peak</Text>
					<Text className="text-sm font-semibold text-zinc-200">
						{maxValue}
					</Text>
				</View>
				<View className="flex-1 flex-row items-center justify-between rounded-lg border border-white/8 bg-[#101114] px-2.5 py-1.5">
					<Text className="text-[11px] text-zinc-500">Daily avg</Text>
					<Text className="text-sm font-semibold text-zinc-200">
						{average}
					</Text>
				</View>
			</View>
		</View>
	);
};
