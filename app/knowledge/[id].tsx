import { useCallback, useEffect, useMemo, useState } from "react";
import {
	ActivityIndicator,
	Alert,
	ScrollView,
	TouchableOpacity,
	View,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { useLocalSearchParams, useRouter } from "expo-router";
import {
	ArrowUpRight,
	Check,
	Copy,
	Save,
	Trash2,
} from "lucide-react-native";
import {
	PitchAccentPattern,
	PitchAccentSection,
} from "@/components/japanese/pitch-accent-section";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import {
	getPitchAccentDisplayReading,
	getPitchAccentVariantKey,
	getSortedPitchAccents,
	resolveKnowledgePitchAccent,
	validateCustomPitchAccent,
	type KnowledgePitchAccentOverride,
} from "@/lib/japanesePitchAccent";
import {
	type KnowledgeDefinitionConfig,
	buildKnowledgeConfigSignature,
	getGlossKey,
	getNextKnowledgeConfigLabel,
	normalizeKnowledgeDefinitionConfig,
	parseKnowledgeDefinitionConfig,
	serializeKnowledgeDefinitionConfig,
} from "@/lib/knowledge/config";
import {
	getKnowledgeRoute,
	parseKnowledgeRouteOrigin,
} from "@/lib/knowledge/routes";
import { cn } from "@/lib/utils";
import { useAppLanguage } from "@/lib/store/appLanguageStore";
import {
	forkKnowledgeForCard,
	getKnowledgeDetail,
	trashKnowledge,
	updateKnowledgeInPlace,
} from "@/lib/store/knowledgeStore";

const PART_OF_SPEECH_LABELS: Record<string, string> = {
	"adj-f": "Prenominal adjective",
	"adj-i": "I-adjective",
	"adj-na": "Na-adjective",
	"adj-no": "Noun modifier",
	adj: "Adjective",
	adv: "Adverb",
	aux: "Auxiliary",
	ctr: "Counter",
	exp: "Expression",
	int: "Interjection",
	n: "Noun",
	pn: "Pronoun",
	pref: "Prefix",
	prt: "Particle",
	suf: "Suffix",
	v1: "Ichidan verb",
	v5: "Godan verb",
	vi: "Intransitive verb",
	vs: "Suru verb",
	vt: "Transitive verb",
};

const trimOrNull = (value: string | null | undefined) => {
	const trimmed = value?.trim();
	return trimmed ? trimmed : null;
};

const firstGlossPreview = (
	sense: {
		glosses: { text: string }[];
	},
) =>
	sense.glosses
		.slice(0, 2)
		.map((gloss) => gloss.text)
		.join(" · ");

const formatPartOfSpeech = (value: string | null | undefined) => {
	if (!value) return null;
	try {
		const parsed = JSON.parse(value);
		const parts = (Array.isArray(parsed) ? parsed : [value])
			.map((part) => String(part).trim())
			.filter(Boolean)
			.map((part) => PART_OF_SPEECH_LABELS[part] ?? part);
		return [...new Set(parts)].join(" · ");
	} catch {
		return PART_OF_SPEECH_LABELS[value] ?? value;
	}
};

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

type PitchAccentMode = "default" | "variant" | "custom";

const getPitchVariantSelectionKey = ({
	pitchAccent,
}: {
	pitchAccent: Parameters<typeof getPitchAccentVariantKey>[0];
}) => getPitchAccentVariantKey(pitchAccent);

export default function KnowledgeDetailPage() {
	const router = useRouter();
	const drizzle = useDrizzle();
	const { activeLanguageId } = useAppLanguage();
	const params = useLocalSearchParams<{
		id?: string;
		cardId?: string | string[];
		deckId?: string | string[];
		deckName?: string | string[];
		originPath?: string | string[];
	}>();
	const origin = useMemo(
		() =>
			parseKnowledgeRouteOrigin({
				cardId: params.cardId,
				deckId: params.deckId,
				deckName: params.deckName,
				originPath: params.originPath,
			}),
		[params.cardId, params.deckId, params.deckName, params.originPath],
	);
	const knowledgeId = Array.isArray(params.id) ? params.id[0] : params.id;
	const [detail, setDetail] = useState<Awaited<ReturnType<typeof getKnowledgeDetail>>>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [note, setNote] = useState("");
	const [tags, setTags] = useState("");
	const [suspended, setSuspended] = useState(false);
	const [config, setConfig] = useState<KnowledgeDefinitionConfig | null>(null);
	const [pitchAccentMode, setPitchAccentMode] = useState<PitchAccentMode>("default");
	const [selectedPitchVariantKey, setSelectedPitchVariantKey] = useState<string | null>(null);
	const [customPitchReading, setCustomPitchReading] = useState("");
	const [customPitchAccentNumber, setCustomPitchAccentNumber] = useState("");

	const loadDetail = useCallback(async () => {
		if (!knowledgeId) {
			setDetail(null);
			setIsLoading(false);
			return;
		}

		setIsLoading(true);
		try {
			const nextDetail = await getKnowledgeDetail(drizzle, {
				knowledgeId,
				languageId: activeLanguageId,
			});
			setDetail(nextDetail);
		} finally {
			setIsLoading(false);
		}
	}, [activeLanguageId, drizzle, knowledgeId]);

	useFocusEffect(
		useCallback(() => {
			void loadDetail();
		}, [loadDetail]),
	);

	useEffect(() => {
		if (!detail) {
			setConfig(null);
			setNote("");
			setTags("");
			setSuspended(false);
			setPitchAccentMode("default");
			setSelectedPitchVariantKey(null);
			setCustomPitchReading("");
			setCustomPitchAccentNumber("");
			return;
		}

		setNote(detail.knowledge.note ?? "");
		setTags(detail.knowledge.tags ?? "");
		setSuspended(Boolean(detail.knowledge.suspended));
		if (detail.entryDetail) {
			setConfig(
				normalizeKnowledgeDefinitionConfig(
					detail.entryDetail,
					parseKnowledgeDefinitionConfig(detail.knowledge.definitionConfig),
				),
			);
		} else {
			setConfig(null);
		}

		const resolvedPitchAccent =
			detail.entryDetail?.languageId === "lang_ja" && detail.entryDetail.pitchAccents.length > 0
				? resolveKnowledgePitchAccent({
						pitchAccents: detail.entryDetail.pitchAccents,
						override: detail.knowledge,
						preferredReading: detail.entryDetail.canonicalReading,
					})
				: null;
		setPitchAccentMode(resolvedPitchAccent?.mode ?? "default");
		setSelectedPitchVariantKey(
			resolvedPitchAccent?.mode === "variant" && resolvedPitchAccent.primary
				? getPitchVariantSelectionKey({
						pitchAccent: resolvedPitchAccent.primary,
					})
				: null,
		);
		setCustomPitchReading(
			resolvedPitchAccent?.mode === "custom" ? resolvedPitchAccent.primaryReading : "",
		);
		setCustomPitchAccentNumber(
			resolvedPitchAccent?.mode === "custom"
				? String(resolvedPitchAccent.primaryAccentNumber)
				: "",
		);
	}, [detail]);

	const normalizedConfig = useMemo(() => {
		if (!detail?.entryDetail) return null;
		return normalizeKnowledgeDefinitionConfig(detail.entryDetail, config);
	}, [config, detail?.entryDetail]);

	const pitchAccentVariants = useMemo(() => {
		if (
			!detail?.entryDetail ||
			detail.entryDetail.languageId !== "lang_ja" ||
			detail.entryDetail.pitchAccents.length === 0
		) {
			return [];
		}

		return getSortedPitchAccents(detail.entryDetail.pitchAccents, {
			preferredReading: detail.entryDetail.canonicalReading,
		}).map((pitchAccent) => ({
			pitchAccent,
			reading: getPitchAccentDisplayReading(pitchAccent),
			key: getPitchVariantSelectionKey({
				pitchAccent,
			}),
		}));
	}, [detail?.entryDetail]);

	const selectedPitchVariant = useMemo(
		() =>
			pitchAccentVariants.find((variant) => variant.key === selectedPitchVariantKey) ?? null,
		[pitchAccentVariants, selectedPitchVariantKey],
	);

	const customPitchAccentNumberValue = useMemo(() => {
		const trimmed = customPitchAccentNumber.trim();
		if (!trimmed) return null;
		return /^-?\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : Number.NaN;
	}, [customPitchAccentNumber]);

	const customPitchValidation = useMemo(
		() =>
			validateCustomPitchAccent({
				reading: customPitchReading,
				accentNumber:
					customPitchAccentNumberValue === null ||
					Number.isNaN(customPitchAccentNumberValue)
						? customPitchAccentNumberValue
						: customPitchAccentNumberValue,
			}),
		[customPitchAccentNumberValue, customPitchReading],
	);

	const pitchAccentDraftOverride = useMemo<KnowledgePitchAccentOverride>(() => {
		if (pitchAccentMode === "variant" && selectedPitchVariant) {
			return {
				primaryPitchAccentDictionaryId: selectedPitchVariant.pitchAccent.dictionaryId,
				primaryPitchAccentReading: selectedPitchVariant.reading,
				primaryPitchAccentAccentNumber: selectedPitchVariant.pitchAccent.accentNumber,
				primaryPitchAccentIsCustom: false,
			};
		}

		if (pitchAccentMode === "custom") {
			return {
				primaryPitchAccentDictionaryId: null,
				primaryPitchAccentReading: customPitchReading,
				primaryPitchAccentAccentNumber:
					customPitchAccentNumberValue === null || Number.isNaN(customPitchAccentNumberValue)
						? null
						: customPitchAccentNumberValue,
				primaryPitchAccentIsCustom: true,
			};
		}

		return {
			primaryPitchAccentDictionaryId: null,
			primaryPitchAccentReading: null,
			primaryPitchAccentAccentNumber: null,
			primaryPitchAccentIsCustom: null,
		};
	}, [
		customPitchAccentNumberValue,
		customPitchReading,
		pitchAccentMode,
		selectedPitchVariant,
	]);

	const pitchAccentValidationMessage =
		pitchAccentMode === "custom" ? customPitchValidation.error : null;
	const isPitchAccentDraftValid =
		pitchAccentMode === "default" ||
		(pitchAccentMode === "variant" ? Boolean(selectedPitchVariant) : customPitchValidation.isValid);

	const draftComparison = useMemo(() => {
		if (!detail) return null;
		if (detail.entryDetail && normalizedConfig) {
			const front =
				detail.entryDetail.canonicalForm ??
				detail.entryDetail.forms[0]?.text ??
				detail.knowledge.front;
			const definitions = detail.entryDetail.senses
				.flatMap((sense) =>
					sense.glosses
						.filter((gloss) =>
							normalizedConfig.selectedGlossKeys.includes(
								getGlossKey(sense.id, gloss.glossOrder, gloss.glossLanguage),
							),
						)
						.map((gloss) => gloss.text),
				)
				.join("\n")
				.trim();

			return {
				front,
				definitions: definitions || "No definition available.",
				pronunciation: detail.entryDetail.canonicalReading ?? null,
				primaryPitchAccentDictionaryId:
					pitchAccentDraftOverride.primaryPitchAccentDictionaryId ?? null,
				primaryPitchAccentReading:
					pitchAccentDraftOverride.primaryPitchAccentReading ?? null,
				primaryPitchAccentAccentNumber:
					pitchAccentDraftOverride.primaryPitchAccentAccentNumber ?? null,
				primaryPitchAccentIsCustom:
					typeof pitchAccentDraftOverride.primaryPitchAccentIsCustom === "boolean"
						? pitchAccentDraftOverride.primaryPitchAccentIsCustom
						: null,
				configSignature: buildKnowledgeConfigSignature(
					detail.entryDetail,
					normalizedConfig,
				),
				definitionConfig: serializeKnowledgeDefinitionConfig(
					detail.entryDetail,
					normalizedConfig,
				),
				note: trimOrNull(note),
				tags: trimOrNull(tags),
				suspended,
			};
		}

		return {
			front: detail.knowledge.front,
			definitions: detail.knowledge.definitions,
			pronunciation: detail.knowledge.pronunciation,
			primaryPitchAccentDictionaryId:
				pitchAccentDraftOverride.primaryPitchAccentDictionaryId ?? null,
			primaryPitchAccentReading:
				pitchAccentDraftOverride.primaryPitchAccentReading ?? null,
			primaryPitchAccentAccentNumber:
				pitchAccentDraftOverride.primaryPitchAccentAccentNumber ?? null,
			primaryPitchAccentIsCustom:
				typeof pitchAccentDraftOverride.primaryPitchAccentIsCustom === "boolean"
					? pitchAccentDraftOverride.primaryPitchAccentIsCustom
					: null,
			configSignature:
				detail.knowledge.configSignature ?? "__all__",
			definitionConfig: detail.knowledge.definitionConfig,
			note: trimOrNull(note),
			tags: trimOrNull(tags),
			suspended,
		};
	}, [detail, normalizedConfig, note, pitchAccentDraftOverride, suspended, tags]);

	const hasChanges = useMemo(() => {
		if (!detail || !draftComparison) return false;
		return (
			detail.knowledge.front !== draftComparison.front ||
			detail.knowledge.definitions !== draftComparison.definitions ||
			(detail.knowledge.pronunciation ?? null) !== draftComparison.pronunciation ||
			(detail.knowledge.primaryPitchAccentDictionaryId ?? null) !==
				draftComparison.primaryPitchAccentDictionaryId ||
			(detail.knowledge.primaryPitchAccentReading ?? null) !==
				draftComparison.primaryPitchAccentReading ||
			(detail.knowledge.primaryPitchAccentAccentNumber ?? null) !==
				draftComparison.primaryPitchAccentAccentNumber ||
			(typeof detail.knowledge.primaryPitchAccentIsCustom === "boolean"
				? detail.knowledge.primaryPitchAccentIsCustom
				: null) !== draftComparison.primaryPitchAccentIsCustom ||
			(detail.knowledge.configSignature ?? "__all__") !==
				draftComparison.configSignature ||
			(detail.knowledge.definitionConfig ?? null) !==
				draftComparison.definitionConfig ||
			(detail.knowledge.note ?? null) !== draftComparison.note ||
			(detail.knowledge.tags ?? null) !== draftComparison.tags ||
			Boolean(detail.knowledge.suspended) !== draftComparison.suspended
		);
	}, [detail, draftComparison]);

	const selectedSenseCount = normalizedConfig?.selectedSenseIds.length ?? 0;
	const selectedGlossCount = normalizedConfig?.selectedGlossKeys.length ?? 0;
	const originDeckLabel = origin.deckName ?? origin.deckId ?? "this deck";
	const canEditPitchAccent =
		detail?.entryDetail?.languageId === "lang_ja" &&
		(detail.entryDetail.pitchAccents.length ?? 0) > 0;

	const toggleSense = (senseId: string, nextSelected: boolean) => {
		if (!detail?.entryDetail || !normalizedConfig) return;
		const sense = detail.entryDetail.senses.find((item) => item.id === senseId);
		if (!sense) return;

		const senseGlossKeys = sense.glosses.map((gloss) =>
			getGlossKey(sense.id, gloss.glossOrder, gloss.glossLanguage),
		);
		const nextSenseIds = nextSelected
			? [...new Set([...normalizedConfig.selectedSenseIds, senseId])]
			: normalizedConfig.selectedSenseIds.filter((item) => item !== senseId);
		const nextGlossKeys = nextSelected
			? [...new Set([...normalizedConfig.selectedGlossKeys, ...senseGlossKeys])]
			: normalizedConfig.selectedGlossKeys.filter(
					(glossKey) => !senseGlossKeys.includes(glossKey),
				);

		setConfig({
			selectedSenseIds: nextSenseIds,
			selectedGlossKeys: nextGlossKeys,
		});
	};

	const toggleGloss = (
		senseId: string,
		glossOrder: number,
		glossLanguage: string,
		nextSelected: boolean,
	) => {
		if (!detail?.entryDetail || !normalizedConfig) return;
		const targetKey = getGlossKey(senseId, glossOrder, glossLanguage);
		const nextGlossKeys = nextSelected
			? [...new Set([...normalizedConfig.selectedGlossKeys, targetKey])]
			: normalizedConfig.selectedGlossKeys.filter((item) => item !== targetKey);
		const remainingSenseGlosses =
			detail.entryDetail.senses
				.find((sense) => sense.id === senseId)
				?.glosses.map((gloss) =>
					getGlossKey(senseId, gloss.glossOrder, gloss.glossLanguage),
				) ?? [];
		const hasAnyGlossForSense = remainingSenseGlosses.some((key) =>
			nextGlossKeys.includes(key),
		);
		const nextSenseIds = nextSelected
			? [...new Set([...normalizedConfig.selectedSenseIds, senseId])]
			: hasAnyGlossForSense
				? normalizedConfig.selectedSenseIds
				: normalizedConfig.selectedSenseIds.filter((item) => item !== senseId);

		setConfig({
			selectedSenseIds: nextSenseIds,
			selectedGlossKeys: nextGlossKeys,
		});
	};

	const handleOpenEntry = () => {
		if (!detail?.knowledge.entryId) return;
		router.push({
			pathname: "/character",
			params: {
				entryId: detail.knowledge.entryId,
				backTo: `/knowledge/${detail.knowledge.id}`,
			},
		});
	};

	const handleSaveShared = () => {
		if (!detail || !hasChanges || isSaving || !isPitchAccentDraftValid) return;
		Alert.alert(
			"Update shared knowledge?",
			`This changes ${detail.linkedCardCount} linked card${detail.linkedCardCount === 1 ? "" : "s"} across ${detail.linkedDeckCount} deck${detail.linkedDeckCount === 1 ? "" : "s"}.`,
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Update",
					onPress: () => {
						void (async () => {
							setIsSaving(true);
							try {
								const result = await updateKnowledgeInPlace(drizzle, {
									knowledgeId: detail.knowledge.id,
									languageId: activeLanguageId,
									config: normalizedConfig,
									note,
									tags,
									pitchAccentOverride: pitchAccentDraftOverride,
									suspended,
								});
								if (result.status === "updated") {
									await loadDetail();
								}
							} finally {
								setIsSaving(false);
							}
						})();
					},
				},
			],
		);
	};

	const handleSaveForOriginDeck = () => {
		if (!detail || !origin.cardId || !hasChanges || isSaving || !isPitchAccentDraftValid) return;
		Alert.alert(
			`Create copy for ${originDeckLabel}?`,
			`This keeps the current shared knowledge in place and only changes the originating card for ${originDeckLabel}. The current knowledge is used by ${detail.linkedCardCount} linked card${detail.linkedCardCount === 1 ? "" : "s"} across ${detail.linkedDeckCount} deck${detail.linkedDeckCount === 1 ? "" : "s"}.`,
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Create copy",
					onPress: () => {
						void (async () => {
							setIsSaving(true);
							try {
								const result = await forkKnowledgeForCard(drizzle, {
									knowledgeId: detail.knowledge.id,
									cardId: origin.cardId!,
									languageId: activeLanguageId,
									config: normalizedConfig,
									note,
									tags,
									pitchAccentOverride: pitchAccentDraftOverride,
									suspended,
								});

								if (result.status === "copied" || result.status === "linked_existing") {
									router.replace(
										getKnowledgeRoute(result.knowledgeId, {
											cardId: origin.cardId,
											deckId: origin.deckId,
											deckName: origin.deckName,
											originPath: origin.originPath,
										}),
									);
									return;
								}

								if (result.status === "managed_by_primary") {
									Alert.alert(
										"Use the primary deck",
										"Linked decks are managed by their primary deck.",
									);
									return;
								}

								if (result.status === "card_already_exists") {
									Alert.alert(
										"Knowledge already in this deck",
										"This deck already has another card using the matching knowledge, so the current card was left unchanged.",
									);
								}
							} finally {
								setIsSaving(false);
							}
						})();
					},
				},
			],
		);
	};

	const handleTrash = () => {
		if (!detail || isSaving) return;
		Alert.alert(
			"Trash knowledge?",
			`This removes ${detail.linkedCardCount} linked card${detail.linkedCardCount === 1 ? "" : "s"} across ${detail.linkedDeckCount} deck${detail.linkedDeckCount === 1 ? "" : "s"} from active study.`,
			[
				{ text: "Cancel", style: "cancel" },
				{
					text: "Trash",
					style: "destructive",
					onPress: () => {
						void (async () => {
							setIsSaving(true);
							try {
								const result = await trashKnowledge(drizzle, {
									knowledgeId: detail.knowledge.id,
									languageId: activeLanguageId,
								});
								if (result.status === "trashed") {
									router.replace("/knowledge");
								}
							} finally {
								setIsSaving(false);
							}
						})();
					},
				},
			],
		);
	};

	if (isLoading) {
		return (
			<View className="flex-1 items-center justify-center bg-[#0F1012]">
				<ActivityIndicator color="#71717A" />
			</View>
		);
	}

	if (!detail) {
		return (
			<View className="flex-1 items-center justify-center gap-3 bg-[#0F1012] p-4">
				<Text className="text-sm text-zinc-400">Knowledge not found.</Text>
				<TouchableOpacity
					activeOpacity={0.85}
					className="rounded-xl border border-white/8 bg-[#141518] px-4 py-2.5"
					onPress={() => router.replace("/knowledge")}
				>
					<Text className="text-sm font-medium text-zinc-200">Back to knowledge</Text>
				</TouchableOpacity>
			</View>
		);
	}

	const impactLabel = `${detail.linkedCardCount} card${detail.linkedCardCount === 1 ? "" : "s"} · ${detail.linkedDeckCount} deck${detail.linkedDeckCount === 1 ? "" : "s"}`;

	return (
		<View className="flex-1 bg-[#0F1012]">
			<ScrollView
				className="flex-1"
				contentContainerClassName="pb-6"
				showsVerticalScrollIndicator={false}
			>
				{/* Header */}
				<View className="gap-2.5 px-4 pt-3">
					<View className="flex-row items-start justify-between gap-3">
						<View className="min-w-0 flex-1">
							<Text className="text-[11px] font-medium uppercase tracking-[0.2em] text-zinc-500">
								Knowledge
							</Text>
							<Text className="mt-1 text-2xl font-semibold text-zinc-100" numberOfLines={2}>
								{detail.knowledge.front}
							</Text>
							{detail.knowledge.pronunciation ? (
								<Text className="mt-0.5 text-sm text-zinc-400">
									{detail.knowledge.pronunciation}
								</Text>
							) : null}
						</View>
						{detail.knowledge.entryId ? (
							<TouchableOpacity
								activeOpacity={0.85}
								className="h-11 w-11 items-center justify-center rounded-xl border border-white/8 bg-[#15171A]"
								onPress={handleOpenEntry}
							>
								<ArrowUpRight size={18} color="#E4E4E7" />
							</TouchableOpacity>
						) : null}
					</View>

					<View className="flex-row flex-wrap items-center gap-x-2.5 gap-y-1">
						<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
							{reviewTypeLabel(detail.knowledge.reviewType)}
						</Text>
						{detail.knowledge.configLabel ? (
							<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-200">
								{detail.knowledge.configLabel}
							</Text>
						) : null}
						{suspended ? (
							<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-amber-200">
								Suspended
							</Text>
						) : null}
						<Text className="text-[10px] text-zinc-600">
							{impactLabel}
						</Text>
					</View>

					{origin.cardId ? (
						<View className="rounded-xl border border-sky-400/20 bg-sky-500/[0.08] px-3 py-2.5">
							<View className="flex-row items-center gap-2">
								<View className="h-6 w-6 items-center justify-center rounded-lg border border-sky-400/20 bg-sky-400/10">
									<Copy size={12} color="#BAE6FD" />
								</View>
								<Text className="min-w-0 flex-1 text-xs leading-4 text-sky-100/80">
									Opened from <Text className="font-medium text-sky-50">{originDeckLabel}</Text>. Update shared or create a copy.
								</Text>
							</View>
						</View>
					) : null}
				</View>

				{/* Sections */}
				<View className="mt-4 gap-2.5 px-3">
					{/* Usage by deck */}
					<View className="rounded-xl border border-white/10 bg-[#111214] px-3.5 py-3.5">
						<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
							Usage
						</Text>
						<View className="mt-2 gap-1.5">
							{detail.usageByDeck.map((deck) => (
								<View
									key={deck.deckId}
									className="flex-row items-center justify-between gap-2"
								>
									<View className="min-w-0 flex-1 flex-row items-center gap-1.5">
										<Text className="text-sm text-zinc-300" numberOfLines={1}>
											{deck.deckName}
										</Text>
										{origin.deckId === deck.deckId ? (
											<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-sky-200">
												Origin
											</Text>
										) : null}
									</View>
									<Text className="text-xs text-zinc-600">
										{deck.cardCount} card{deck.cardCount === 1 ? "" : "s"}
									</Text>
								</View>
							))}
						</View>
					</View>

					{/* Definitions */}
					{detail.entryDetail && normalizedConfig ? (
						<View className="rounded-xl border border-white/10 bg-[#111214] px-3.5 py-3.5">
							<View className="flex-row items-center justify-between">
								<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
									Definitions
								</Text>
								<Text className="text-[10px] text-zinc-600">
									{selectedSenseCount} sense{selectedSenseCount === 1 ? "" : "s"} · {selectedGlossCount} gloss{selectedGlossCount === 1 ? "" : "es"}
								</Text>
							</View>

							<View className="mt-3 gap-3">
								{/* Senses */}
								<View className="gap-1.5">
									<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">
										Senses
									</Text>
									<View className="gap-1.5">
										{detail.entryDetail.senses.map((sense) => {
											const selected = normalizedConfig.selectedSenseIds.includes(sense.id);
											return (
												<ToggleRow
													key={sense.id}
													selected={selected}
													onPress={() => toggleSense(sense.id, !selected)}
													title={formatPartOfSpeech(sense.partOfSpeech) ?? `Sense ${sense.senseOrder}`}
													subtitle={firstGlossPreview(sense) || null}
													trailing={`#${sense.senseOrder}`}
												/>
											);
										})}
									</View>
								</View>

								{/* Glosses */}
								{detail.entryDetail.senses
									.filter((sense) =>
										normalizedConfig.selectedSenseIds.includes(sense.id),
									)
									.map((sense) => (
										<View key={`${sense.id}-glosses`} className="gap-1.5">
											<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-600">
												{formatPartOfSpeech(sense.partOfSpeech) ?? `Sense ${sense.senseOrder}`}
											</Text>
											<View className="gap-1.5">
												{sense.glosses.map((gloss) => {
													const selected = normalizedConfig.selectedGlossKeys.includes(
														getGlossKey(
															sense.id,
															gloss.glossOrder,
															gloss.glossLanguage,
														),
													);
													return (
														<ToggleRow
															key={`${sense.id}-${gloss.glossOrder}-${gloss.glossLanguage}`}
															selected={selected}
															onPress={() =>
																toggleGloss(
																	sense.id,
																	gloss.glossOrder,
																	gloss.glossLanguage,
																	!selected,
																)
															}
															title={gloss.text}
															subtitle={null}
															trailing={`${gloss.glossOrder}`}
															compact
														/>
													);
												})}
											</View>
										</View>
									))}
							</View>
						</View>
					) : (
						<View className="rounded-xl border border-white/10 bg-[#111214] px-3.5 py-3.5">
							<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
								Definitions
							</Text>
							<Text className="mt-2 text-sm leading-5 text-zinc-300">
								{detail.knowledge.definitions}
							</Text>
						</View>
					)}

					{canEditPitchAccent ? (
						<View className="rounded-xl border border-white/10 bg-[#111214] px-3.5 py-3.5">
							<View className="flex-row items-center justify-between gap-3">
								<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
									Pitch Accent
								</Text>
								<Text className="text-[10px] text-zinc-600">
									{pitchAccentMode === "default"
										? "Entry default"
										: pitchAccentMode === "variant"
											? "Selected variant"
											: "Custom"}
								</Text>
							</View>

							<PitchAccentSection
								pitchAccents={detail.entryDetail!.pitchAccents}
								primaryOverride={pitchAccentDraftOverride}
								preferredReading={detail.entryDetail!.canonicalReading}
								className="mt-3 border-t-0 pt-0"
								showHeader={false}
							/>

							<View className="mt-3 flex-row gap-2">
								{(["default", "variant", "custom"] as const).map((mode) => {
									const selected = pitchAccentMode === mode;
									const label =
										mode === "default"
											? "Default"
											: mode === "variant"
												? "Variant"
												: "Custom";
									return (
										<TouchableOpacity
											key={mode}
											activeOpacity={0.85}
											className={cn(
												"flex-1 rounded-xl border px-3 py-2.5",
												selected
													? "border-zinc-200 bg-zinc-100"
													: "border-white/8 bg-[#17191c]",
											)}
											onPress={() => setPitchAccentMode(mode)}
										>
											<Text
												className={cn(
													"text-center text-sm font-medium",
													selected ? "text-zinc-900" : "text-zinc-200",
												)}
											>
												{label}
											</Text>
										</TouchableOpacity>
									);
								})}
							</View>

							{pitchAccentMode === "variant" ? (
								<View className="mt-3 gap-2">
									{pitchAccentVariants.map((variant) => {
										const selected = selectedPitchVariantKey === variant.key;
										return (
											<TouchableOpacity
												key={variant.key}
												activeOpacity={0.85}
												className={cn(
													"rounded-xl border px-3 py-2.5",
													selected
														? "border-white/12 bg-[#17191c]"
														: "border-white/6 bg-[#141518]",
												)}
												onPress={() => setSelectedPitchVariantKey(variant.key)}
											>
												<View className="flex-row items-center gap-2.5">
													<View
														className={cn(
															"h-[18px] w-[18px] items-center justify-center rounded border",
															selected
																? "border-zinc-200 bg-zinc-100"
																: "border-white/12 bg-transparent",
														)}
													>
														{selected ? (
															<Check size={11} color="#111214" strokeWidth={3} />
														) : null}
													</View>
													<View className="min-w-0 flex-1 gap-1">
														<View className="items-start">
															<PitchAccentPattern
																reading={variant.reading}
																accentNumber={variant.pitchAccent.accentNumber}
																compact
															/>
														</View>
														<Text className="text-xs text-zinc-500">
															{variant.reading} · accent {variant.pitchAccent.accentNumber}
														</Text>
													</View>
												</View>
											</TouchableOpacity>
										);
									})}
								</View>
							) : null}

							{pitchAccentMode === "custom" ? (
								<View className="mt-3 gap-2.5">
									<View>
										<Text className="mb-1.5 text-xs text-zinc-500">Reading</Text>
										<Input
											value={customPitchReading}
											onChangeText={setCustomPitchReading}
											placeholder="かな"
											autoCapitalize="none"
											autoCorrect={false}
											className="rounded-xl border-white/8 bg-[#17191c] text-sm"
											placeholderTextColor="#52525B"
										/>
									</View>
									<View>
										<Text className="mb-1.5 text-xs text-zinc-500">Accent number</Text>
										<Input
											value={customPitchAccentNumber}
											onChangeText={setCustomPitchAccentNumber}
											placeholder="0"
											keyboardType="number-pad"
											className="rounded-xl border-white/8 bg-[#17191c] text-sm"
											placeholderTextColor="#52525B"
										/>
									</View>
									{pitchAccentValidationMessage ? (
										<Text className="text-xs text-amber-200">
											{pitchAccentValidationMessage}
										</Text>
									) : null}
								</View>
							) : null}
						</View>
					) : null}

					{/* Notes & Tags */}
					<View className="rounded-xl border border-white/10 bg-[#111214] px-3.5 py-3.5">
						<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
							Notes & Tags
						</Text>
						<View className="mt-2.5 gap-2.5">
							<View>
								<Text className="mb-1.5 text-xs text-zinc-500">Note</Text>
								<Input
									value={note}
									onChangeText={setNote}
									placeholder="Optional note"
									multiline
									textAlignVertical="top"
									className="min-h-[80px] rounded-xl border-white/8 bg-[#17191c] py-2.5 text-sm"
									placeholderTextColor="#52525B"
								/>
							</View>
							<View>
								<Text className="mb-1.5 text-xs text-zinc-500">Tags</Text>
								<Input
									value={tags}
									onChangeText={setTags}
									placeholder="Comma-separated tags"
									className="rounded-xl border-white/8 bg-[#17191c] text-sm"
									placeholderTextColor="#52525B"
								/>
							</View>
						</View>
					</View>

					{/* State */}
					<TouchableOpacity
						activeOpacity={0.85}
						className="rounded-xl border border-white/10 bg-[#111214] px-3.5 py-3.5"
						onPress={() => setSuspended((c) => !c)}
					>
						<View className="flex-row items-center justify-between gap-3">
							<View className="min-w-0 flex-1">
								<Text className="text-[10px] font-medium uppercase tracking-[0.12em] text-zinc-500">
									State
								</Text>
								<Text className="mt-1 text-sm text-zinc-300">
									{suspended
										? "Suspended — linked cards are paused."
										: "Active — linked cards appear when due."}
								</Text>
							</View>
							<View
								className={cn(
									"h-5 w-5 items-center justify-center rounded-md border",
									suspended
										? "border-zinc-200 bg-zinc-100"
										: "border-white/12 bg-transparent",
								)}
							>
								{suspended ? <Check size={12} color="#111214" strokeWidth={3} /> : null}
							</View>
						</View>
					</TouchableOpacity>

					{/* Trash */}
					<TouchableOpacity
						activeOpacity={0.85}
						className="rounded-xl border border-red-500/15 bg-red-500/[0.04] px-3.5 py-3.5"
						onPress={handleTrash}
						disabled={isSaving}
					>
						<View className="flex-row items-center gap-2">
							<Trash2 size={14} color="#FCA5A5" />
							<Text className="text-sm text-red-200">Trash knowledge</Text>
							<Text className="text-xs text-red-300/40">
								({impactLabel})
							</Text>
						</View>
					</TouchableOpacity>
				</View>
			</ScrollView>

			{/* Bottom action bar */}
			<View className="border-t border-white/8 bg-[#0F1012] px-4 pb-5 pt-3">
				{hasChanges ? (
					<View className="gap-2">
						{!isPitchAccentDraftValid && pitchAccentValidationMessage ? (
							<Text className="text-center text-xs text-amber-200">
								{pitchAccentValidationMessage}
							</Text>
						) : null}
						<TouchableOpacity
							activeOpacity={0.85}
							className="h-11 flex-row items-center justify-center gap-2 rounded-xl bg-zinc-100"
							disabled={isSaving || !isPitchAccentDraftValid}
							style={isSaving || !isPitchAccentDraftValid ? { opacity: 0.5 } : undefined}
							onPress={handleSaveShared}
						>
							<Save size={16} color="#18181b" />
							<Text className="text-sm font-semibold text-zinc-900">
								Update shared knowledge
							</Text>
						</TouchableOpacity>
						{origin.cardId ? (
							<TouchableOpacity
								activeOpacity={0.85}
								className="h-11 flex-row items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#17191c]"
								disabled={isSaving || !isPitchAccentDraftValid}
								style={
									isSaving || !isPitchAccentDraftValid ? { opacity: 0.5 } : undefined
								}
								onPress={handleSaveForOriginDeck}
							>
								<Copy size={16} color="#E4E4E7" />
								<Text className="text-sm font-medium text-zinc-100">
									Copy for {originDeckLabel}
								</Text>
							</TouchableOpacity>
						) : null}
					</View>
				) : (
					<View className="h-11 items-center justify-center rounded-xl border border-white/6 bg-[#141518]">
						<Text className="text-sm text-zinc-600">No unsaved changes</Text>
					</View>
				)}
			</View>
		</View>
	);
}

const ToggleRow = ({
	selected,
	onPress,
	title,
	subtitle,
	trailing,
	compact = false,
}: {
	selected: boolean;
	onPress: () => void;
	title: string;
	subtitle: string | null;
	trailing: string;
	compact?: boolean;
}) => (
	<TouchableOpacity
		activeOpacity={0.85}
		className={cn(
			"rounded-xl border px-3",
			compact ? "py-2" : "py-2.5",
			selected
				? "border-white/12 bg-[#17191c]"
				: "border-white/6 bg-[#141518]",
		)}
		onPress={onPress}
	>
		<View className="flex-row items-start gap-2.5">
			<View
				className={cn(
					"mt-0.5 h-[18px] w-[18px] items-center justify-center rounded border",
					selected ? "border-zinc-200 bg-zinc-100" : "border-white/12 bg-transparent",
				)}
			>
				{selected ? <Check size={11} color="#111214" strokeWidth={3} /> : null}
			</View>
			<View className="min-w-0 flex-1">
				<Text className="text-sm leading-5 text-zinc-200">{title}</Text>
				{subtitle ? (
					<Text className="text-xs leading-4 text-zinc-500" numberOfLines={1}>{subtitle}</Text>
				) : null}
			</View>
			<Text className="mt-0.5 text-[10px] text-zinc-600">
				{trailing}
			</Text>
		</View>
	</TouchableOpacity>
);
