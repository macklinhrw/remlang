import * as React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useRouter } from "expo-router";
import { useAccount } from "@/lib/auth/account";
import { ReviewLimitEditor } from "@/components/review/review-limit-editor";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import {
	getGlobalReviewLimitSettings,
	normalizeReviewLimitSettings,
	setGlobalReviewLimitSettings,
	type ReviewLimitSettings,
} from "@/lib/review/reviewLimits";
import { useAppLanguage } from "@/lib/store/appLanguageStore";
import {
	useStrokeAnimationSpeed,
	type StrokeAnimationSpeed,
} from "@/lib/store/strokeAnimationSpeedStore";
import { useSyncSettings } from "@/lib/sync/settings";
import {
	Check,
	ChevronRight,
	Cloud,
	Info,
	Languages,
	LogIn,
	LogOut,
	Play,
	Shield,
	Smartphone,
	UserPlus,
} from "lucide-react-native";

const formatSyncTimestamp = (value: string | null) => {
	if (!value) return "Not yet";

	const parsed = new Date(value);
	if (Number.isNaN(parsed.getTime())) {
		return value;
	}

	return parsed.toLocaleString();
};

export default function SettingsPage() {
	const router = useRouter();
	const drizzle = useDrizzle();
	const account = useAccount();
	const { isSignedIn, signOut } = account;
	const { activeLanguageId, availableLanguages, setActiveLanguageId } =
		useAppLanguage();
	const strokeAnimationSpeed = useStrokeAnimationSpeed();
	const syncSettings = useSyncSettings();
	const [reviewLimitSettings, setReviewLimitSettings] =
		React.useState<ReviewLimitSettings>(normalizeReviewLimitSettings());
	const [savedReviewLimitSettings, setSavedReviewLimitSettings] =
		React.useState<ReviewLimitSettings>(normalizeReviewLimitSettings());
	const [isSavingReviewLimits, setIsSavingReviewLimits] = React.useState(false);
	const syncModeOptions = React.useMemo(
		() => [
			{
				id: "manual" as const,
				title: "Manual",
				description: "Sync only when you trigger it.",
			},
			{
				id: "automatic" as const,
				title: "Automatic",
				description: "Sync after changes on a schedule.",
			},
		],
		[],
	);
	const strokeAnimationSpeedOptions = React.useMemo(
		() =>
			[
				{
					id: "normal" as const,
					title: "Normal",
					description: "Default stroke playback speed.",
				},
				{
					id: "fast" as const,
					title: "Fast",
					description: "About 50% faster stroke playback.",
				},
				{
					id: "fast_plus" as const,
					title: "Fast+",
					description: "About 100% faster stroke playback.",
				},
			] satisfies {
				id: StrokeAnimationSpeed;
				title: string;
				description: string;
			}[],
		[],
	);
	const normalizedReviewLimitSettings = React.useMemo(
		() => normalizeReviewLimitSettings(reviewLimitSettings),
		[reviewLimitSettings],
	);
	const hasReviewLimitChanges =
		normalizedReviewLimitSettings.newLimitEnabled !== savedReviewLimitSettings.newLimitEnabled ||
		normalizedReviewLimitSettings.newLimit !== savedReviewLimitSettings.newLimit ||
		normalizedReviewLimitSettings.totalLimitEnabled !==
			savedReviewLimitSettings.totalLimitEnabled ||
		normalizedReviewLimitSettings.totalLimit !== savedReviewLimitSettings.totalLimit;

	React.useEffect(() => {
		let cancelled = false;

		const loadReviewLimits = async () => {
			const result = await getGlobalReviewLimitSettings(drizzle, activeLanguageId);
			if (!cancelled) {
				setReviewLimitSettings(result);
				setSavedReviewLimitSettings(result);
			}
		};

		void loadReviewLimits();

		return () => {
			cancelled = true;
		};
	}, [activeLanguageId, drizzle]);

	const handleSaveReviewLimits = React.useCallback(async () => {
		if (isSavingReviewLimits) {
			return;
		}

		setIsSavingReviewLimits(true);
		try {
			const saved = await setGlobalReviewLimitSettings(
				drizzle,
				activeLanguageId,
				normalizedReviewLimitSettings,
			);
			setReviewLimitSettings(saved);
			setSavedReviewLimitSettings(saved);
		} finally {
			setIsSavingReviewLimits(false);
		}
	}, [activeLanguageId, drizzle, isSavingReviewLimits, normalizedReviewLimitSettings]);

	return (
		<ScrollView
			className="flex-1 bg-[#0F1012]"
			contentContainerClassName="px-3 pb-4 pt-3"
			showsVerticalScrollIndicator={false}
		>
			<View className="border-b border-white/8 pb-2.5">
				<Text className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
					Settings
				</Text>
				<Text className="mt-0.5 text-lg font-semibold text-zinc-100">
					Language & Preferences
				</Text>
			</View>

			{/* Language selector */}
			<View className="mt-2.5 rounded-xl border border-white/8 bg-[#141518] p-2.5">
				<View className="flex-row items-center gap-2.5">
					<View className="rounded-xl border border-white/8 bg-white/[0.05] p-2">
						<Languages size={16} color="#E4E4E7" />
					</View>
					<View className="flex-1">
						<Text className="text-sm font-semibold text-zinc-100">
							Active Language
						</Text>
						<Text className="mt-0.5 text-xs text-zinc-400">
							Dictionary, decks, and reviews follow this selection.
						</Text>
					</View>
				</View>

				<View className="mt-2.5 gap-1.5">
					{availableLanguages.map((language) => {
						const isActive = language.id === activeLanguageId;
						return (
							<Pressable
								key={language.id}
								onPress={() => setActiveLanguageId(language.id)}
								className={`rounded-lg border px-3 py-2.5 ${
									isActive
										? "border-white/12 bg-white/[0.06]"
										: "border-white/8 bg-[#101114]"
								}`}
							>
								<View className="flex-row items-center gap-2.5">
									<View
										className={`h-8 w-8 items-center justify-center rounded-lg border ${
											isActive
												? "border-white/10 bg-white/[0.08]"
												: "border-white/8 bg-white/[0.04]"
										}`}
									>
										<Text className="text-xs font-semibold text-zinc-100">
											{language.name.slice(0, 2).toUpperCase()}
										</Text>
									</View>
									<View className="min-w-0 flex-1">
										<Text className="text-sm font-medium text-zinc-100">
											{language.name}
										</Text>
									</View>
									<View
										className={`h-5 w-5 items-center justify-center rounded-full border ${
											isActive
												? "border-emerald-400/40 bg-emerald-400/15"
												: "border-white/8 bg-transparent"
										}`}
									>
										{isActive && <Check size={11} color="#6EE7B7" />}
									</View>
								</View>
							</Pressable>
						);
					})}
				</View>
			</View>

			{/* Global review limits */}
			<View className="mt-2 rounded-xl border border-white/8 bg-[#141518] p-2.5">
				<Text className="text-sm font-semibold text-zinc-100">
					Global Review Limits
				</Text>
				<Text className="mt-0.5 text-xs text-zinc-400">
					Cap daily reviews across this language, applied after deck and folder limits.
				</Text>
				<View className="mt-2.5">
					<ReviewLimitEditor
						value={reviewLimitSettings}
						onChange={setReviewLimitSettings}
					/>
				</View>
				<Pressable
					onPress={() => void handleSaveReviewLimits()}
					disabled={!hasReviewLimitChanges || isSavingReviewLimits}
					className={`mt-2.5 items-center justify-center rounded-xl px-3 py-2.5 ${
						!hasReviewLimitChanges || isSavingReviewLimits
							? "bg-zinc-700"
							: "bg-zinc-100"
					}`}
				>
					<Text
						className={`text-sm font-medium ${
							!hasReviewLimitChanges || isSavingReviewLimits
								? "text-zinc-300"
								: "text-zinc-900"
						}`}
					>
						{isSavingReviewLimits ? "Saving..." : "Save global limits"}
					</Text>
				</Pressable>
			</View>

			<View className="mt-2 rounded-xl border border-white/8 bg-[#141518] p-2.5">
				<View className="flex-row items-center gap-2.5">
					<View className="rounded-xl border border-white/8 bg-white/[0.05] p-2">
						<Play size={16} color="#E4E4E7" />
					</View>
					<View className="flex-1">
						<Text className="text-sm font-semibold text-zinc-100">
							Stroke Animation Speed
						</Text>
						<Text className="mt-0.5 text-xs text-zinc-400">
							Controls the stroke play button speed everywhere in the app.
						</Text>
					</View>
				</View>

				<View className="mt-2.5 gap-1.5">
					{strokeAnimationSpeedOptions.map((option) => {
						const isActive = strokeAnimationSpeed.speed === option.id;
						return (
							<Pressable
								key={option.id}
								onPress={() => void strokeAnimationSpeed.setSpeed(option.id)}
								className={`rounded-lg border px-3 py-2.5 ${
									isActive
										? "border-white/12 bg-white/[0.06]"
										: "border-white/8 bg-[#101114]"
								}`}
								disabled={!strokeAnimationSpeed.isReady}
							>
								<View className="flex-row items-center justify-between">
									<View className="min-w-0 flex-1">
										<Text className="text-sm font-medium text-zinc-100">
											{option.title}
										</Text>
										<Text className="text-xs text-zinc-500">
											{option.description}
										</Text>
									</View>
									<View
										className={`h-5 w-5 items-center justify-center rounded-full border ${
											isActive
												? "border-emerald-400/40 bg-emerald-400/15"
												: "border-white/8 bg-transparent"
										}`}
									>
										{isActive && <Check size={11} color="#6EE7B7" />}
									</View>
								</View>
							</Pressable>
						);
					})}
				</View>
			</View>

			{/* Account */}
			<View className="mt-2 rounded-xl border border-white/8 bg-[#141518] p-2.5">
				<View className="flex-row items-center gap-2.5">
					<View className="rounded-xl border border-white/8 bg-white/[0.05] p-2">
						<Shield size={16} color="#E4E4E7" />
					</View>
					<View className="flex-1">
						<Text className="text-sm font-semibold text-zinc-100">
							Account
						</Text>
						<Text className="mt-0.5 text-xs text-zinc-400">
							Controls access to cloud sync.
						</Text>
					</View>
				</View>

				<View className="mt-2.5 rounded-lg border border-white/8 bg-[#101114] px-3 py-2.5">
					<Text className="text-sm font-medium text-zinc-100">
						{!account.isEnabled
							? "Offline build"
							: isSignedIn
								? account.email ?? "No email available"
								: "Not signed in"}
					</Text>
					<Text className="mt-0.5 text-xs text-zinc-500">
						{!account.isEnabled
							? "Set EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY to enable accounts and cloud sync."
							: isSignedIn
								? `ID: ${account.userId ?? "Loading..."}`
								: "Sign in for cloud backup and sync."}
					</Text>
				</View>

				{!account.isEnabled ? null : isSignedIn ? (
					<Pressable
						onPress={() => void signOut()}
						className="mt-2 flex-row items-center justify-center gap-1.5 rounded-xl border border-white/8 bg-[#101114] px-3 py-2.5"
					>
						<LogOut size={14} color="#E4E4E7" />
						<Text className="text-sm font-medium text-zinc-100">Sign out</Text>
					</Pressable>
				) : (
					<View className="mt-2 gap-1.5">
						<Pressable
							onPress={() => router.push("/sign-in")}
							className="flex-row items-center justify-center gap-1.5 rounded-xl border border-white/8 bg-[#101114] px-3 py-2.5"
						>
							<LogIn size={14} color="#E4E4E7" />
							<Text className="text-sm font-medium text-zinc-100">Sign in</Text>
						</Pressable>
						<Pressable
							onPress={() => router.push("/sign-up")}
							className="flex-row items-center justify-center gap-1.5 rounded-xl border border-white/8 bg-transparent px-3 py-2.5"
						>
							<UserPlus size={14} color="#E4E4E7" />
							<Text className="text-sm font-medium text-zinc-200">Create account</Text>
						</Pressable>
					</View>
				)}
			</View>

			{/* Sync & Backup */}
			<View className="mt-2 rounded-xl border border-white/8 bg-[#141518] p-2.5">
				<View className="flex-row items-center gap-2.5">
					<View className="rounded-xl border border-white/8 bg-white/[0.05] p-2">
						<Cloud size={16} color="#E4E4E7" />
					</View>
					<View className="flex-1">
						<Text className="text-sm font-semibold text-zinc-100">
							Sync & Backup
						</Text>
						<Text className="mt-0.5 text-xs text-zinc-400">
							{isSignedIn
								? "Local data syncs with an authenticated backend."
								: "Local-first by default. Sign in for cloud sync."}
						</Text>
					</View>
				</View>

				<View className="mt-2.5 gap-1.5">
					{syncModeOptions.map((option) => {
						const isActive = syncSettings.mode === option.id;
						return (
							<Pressable
								key={option.id}
								onPress={() => void syncSettings.setMode(option.id)}
								className={`rounded-lg border px-3 py-2.5 ${
									isActive
										? "border-white/12 bg-white/[0.06]"
										: "border-white/8 bg-[#101114]"
								}`}
								disabled={!syncSettings.isReady}
							>
								<View className="flex-row items-center justify-between">
									<View className="min-w-0 flex-1">
										<Text className="text-sm font-medium text-zinc-100">
											{option.title}
										</Text>
										<Text className="text-xs text-zinc-500">
											{option.description}
										</Text>
									</View>
									<View
										className={`h-5 w-5 items-center justify-center rounded-full border ${
											isActive
												? "border-emerald-400/40 bg-emerald-400/15"
												: "border-white/8 bg-transparent"
										}`}
									>
										{isActive && <Check size={11} color="#6EE7B7" />}
									</View>
								</View>
							</Pressable>
						);
					})}
				</View>

				<View className="mt-2.5 rounded-lg border border-white/8 bg-[#101114] px-3 py-2.5">
					<View className="flex-row items-center gap-1.5">
						<Smartphone size={12} color="#A1A1AA" />
						<Text className="text-[10px] font-medium uppercase tracking-[0.14em] text-zinc-500">
							Device
						</Text>
					</View>
					<Text className="mt-1 text-xs text-zinc-400">
						{syncSettings.deviceId || "Loading..."}
					</Text>
					<Text className="mt-0.5 text-xs text-zinc-500">
						Push: {formatSyncTimestamp(syncSettings.lastPushedAt)} • Pull: {formatSyncTimestamp(syncSettings.lastPulledAt)}
					</Text>
				</View>
			</View>

			{/* About */}
			<Pressable
				onPress={() => router.push("/about")}
				className="mt-2 flex-row items-center gap-2.5 rounded-xl border border-white/8 bg-[#141518] p-2.5"
			>
				<View className="rounded-xl border border-white/8 bg-white/[0.05] p-2">
					<Info size={16} color="#E4E4E7" />
				</View>
				<View className="min-w-0 flex-1">
					<Text className="text-sm font-semibold text-zinc-100">
						About & Attributions
					</Text>
					<Text className="mt-0.5 text-xs text-zinc-400">
						Dataset sources, licenses, and provenance.
					</Text>
				</View>
				<ChevronRight size={14} color="#71717A" />
			</Pressable>
		</ScrollView>
	);
}
