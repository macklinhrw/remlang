import { useCallback, useEffect, useMemo, useState } from "react";
import { BackHandler, ScrollView, TouchableOpacity, View } from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
	ArrowLeft,
	ArrowRight,
	ArrowRightLeft,
	ArrowUpRight,
	Check,
	PenTool,
} from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { type ReviewType } from "@/lib/database/schema";
import { getEntryDetail } from "@/lib/database/lexicon";
import {
	DEFAULT_REVIEW_TYPE,
	VISIBLE_REVIEW_TYPES,
	type VisibleReviewType,
} from "@/lib/review/reviewTypeConfig";
import { hasPitchAccentReviewSupport } from "@/lib/review/pitchEligibility";
import { hasStrokeEligibleCharacters } from "@/lib/review/strokeEligibility";

const REVIEW_TYPE_META: Record<
	VisibleReviewType,
	{ label: string; description: string; icon: typeof ArrowRight }
> = {
	"Front-Back": {
		label: "Front / Back",
		description: "See the word, recall the meaning.",
		icon: ArrowRight,
	},
	"Back-Front": {
		label: "Back / Front",
		description: "See the meaning, recall the word.",
		icon: ArrowRightLeft,
	},
	Pitch: {
		label: "Pitch",
		description: "See the word, recall its pitch accent.",
		icon: ArrowUpRight,
	},
	Stroke: {
		label: "Stroke",
		description: "Draw the character from memory.",
		icon: PenTool,
	},
};

export default function SelectCardTypePage() {
	const router = useRouter();
	const drizzle = useDrizzle();
	const { entryId, config: configParam } = useLocalSearchParams<{
		entryId?: string;
		config?: string;
	}>();
	const [selectedType, setSelectedType] = useState<ReviewType>(DEFAULT_REVIEW_TYPE);
	const [supportsStroke, setSupportsStroke] = useState(false);
	const [supportsPitch, setSupportsPitch] = useState(false);

	useEffect(() => {
		let cancelled = false;

		const loadReviewTypeSupport = async () => {
			if (!entryId) {
				setSupportsStroke(false);
				setSupportsPitch(false);
				return;
			}

			const entry = await getEntryDetail(drizzle, entryId);
			if (cancelled) {
				return;
			}

			const strokeCandidate =
				entry?.canonicalForm ?? entry?.forms[0]?.text ?? entryId;
			setSupportsStroke(hasStrokeEligibleCharacters(strokeCandidate));
			setSupportsPitch(hasPitchAccentReviewSupport(entry));
		};

		void loadReviewTypeSupport();

		return () => {
			cancelled = true;
		};
	}, [drizzle, entryId]);

	const selectableReviewTypes = useMemo(
		() =>
			VISIBLE_REVIEW_TYPES.filter((type) => {
				if (type === "Stroke") return supportsStroke;
				if (type === "Pitch") return supportsPitch;
				return true;
			}),
		[supportsPitch, supportsStroke],
	);

	useEffect(() => {
		if (
			(selectedType === "Stroke" && !supportsStroke) ||
			(selectedType === "Pitch" && !supportsPitch)
		) {
			setSelectedType(DEFAULT_REVIEW_TYPE);
		}
	}, [selectedType, supportsPitch, supportsStroke]);

	const handleBack = useCallback(() => {
		if (!entryId) {
			router.back();
			return;
		}
		const configQuery = configParam
			? `&config=${encodeURIComponent(configParam)}`
			: "";
		router.replace(
			`/add-from-dictionary-to-deck?entryId=${encodeURIComponent(entryId)}${configQuery}`,
		);
	}, [configParam, entryId, router]);

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

	const handleNext = () => {
		if (!entryId || !configParam) return;
		router.push(
			`/select-deck?entryId=${encodeURIComponent(entryId)}&config=${encodeURIComponent(configParam)}&reviewType=${encodeURIComponent(selectedType)}`,
		);
	};

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
								Step 2 of 3
							</Text>
							<Text className="mt-2 text-[28px] font-semibold leading-8 text-zinc-100">
								Card Type
							</Text>
						</View>
					</View>

					<Text className="mt-3 text-sm leading-5 text-zinc-400">
						Choose how you want to be quizzed on this knowledge card.
					</Text>
				</View>

				<View className="mt-5 gap-2">
					{selectableReviewTypes.map((type) => {
						const meta = REVIEW_TYPE_META[type];
						const selected = selectedType === type;
						const Icon = meta.icon;
						return (
							<TouchableOpacity
								key={type}
								activeOpacity={0.85}
								className={[
									"rounded-[22px] border px-4 py-4",
									selected
										? "border-white/16 bg-[#17191c]"
										: "border-white/8 bg-[#141518]",
								].join(" ")}
								onPress={() => setSelectedType(type)}
							>
								<View className="flex-row items-center gap-3">
									<View
										className={[
											"h-10 w-10 items-center justify-center rounded-2xl",
											selected ? "bg-zinc-100" : "bg-[#1c1e22]",
										].join(" ")}
									>
										<Icon
											size={18}
											color={selected ? "#18181b" : "#a1a1aa"}
										/>
									</View>
									<View className="min-w-0 flex-1 gap-1">
										<Text className="text-base font-medium leading-5 text-zinc-100">
											{meta.label}
										</Text>
										<Text className="text-sm leading-5 text-zinc-500">
											{meta.description}
										</Text>
									</View>
									<View
										className={[
											"h-5 w-5 items-center justify-center rounded-full border",
											selected
												? "border-zinc-200 bg-zinc-100"
												: "border-white/12 bg-transparent",
										].join(" ")}
									>
										{selected ? (
											<Check size={12} color="#111214" strokeWidth={3} />
										) : null}
									</View>
								</View>
							</TouchableOpacity>
						);
					})}
				</View>
			</ScrollView>

			<View className="border-t border-white/8 bg-[#0F1012] px-4 pb-5 pt-3">
				<TouchableOpacity
					activeOpacity={0.85}
					className="h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-zinc-100"
					onPress={handleNext}
				>
					<Text className="text-base font-medium text-zinc-900">Choose Deck</Text>
					<ArrowRight size={18} color="#18181b" />
				</TouchableOpacity>
			</View>
		</View>
	);
}
