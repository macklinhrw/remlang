import { useEffect, useMemo, useRef, useState } from "react";
import { ScrollView, TouchableOpacity, View } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { ArrowRight, Check } from "lucide-react-native";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { type EntryDetailResult } from "@/lib/database/lexicon";
import {
	DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE,
	type KnowledgeDefinitionConfig,
	buildKnowledgeConfigSignature,
	getDefaultKnowledgeDefinitionConfig,
	getGlossKey,
	getNextKnowledgeConfigLabel,
	normalizeKnowledgeDefinitionConfig,
} from "@/lib/knowledge/config";
import { useEntryLookup } from "@/lib/store/entryLookupStore";
import { useAppLanguage } from "@/lib/store/appLanguageStore";
import { decks$ } from "@/lib/store/decksStore";
import { useSelector } from "@legendapp/state/react";

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

const parseJsonArray = <T,>(value: string | null | undefined): T[] => {
	if (!value) return [];
	try {
		const parsed = JSON.parse(value);
		return Array.isArray(parsed) ? (parsed as T[]) : [];
	} catch {
		return [];
	}
};

const parseKnowledgeConfig = (
	value: string | null | undefined,
): KnowledgeDefinitionConfig | null => {
	if (!value) return null;
	try {
		return JSON.parse(value) as KnowledgeDefinitionConfig;
	} catch {
		return null;
	}
};

const formatPartOfSpeech = (value: string | null | undefined) => {
	if (!value) return null;
	const parsed = parseJsonArray<string>(value);
	const parts = (parsed.length > 0 ? parsed : [value])
		.map((part) => part.trim())
		.filter(Boolean)
		.map((part) => PART_OF_SPEECH_LABELS[part] ?? part);
	const uniqueParts = [...new Set(parts)];
	return uniqueParts.length > 0 ? uniqueParts.join(" • ") : null;
};

const firstGlossPreview = (entry: EntryDetailResult["senses"][number]) =>
	entry.glosses
		.slice(0, 2)
		.map((gloss) => gloss.text)
		.join(" • ");

const isGlossSelected = (
	config: KnowledgeDefinitionConfig,
	senseId: string,
	glossOrder: number,
	glossLanguage: string,
) =>
	config.selectedGlossKeys.includes(getGlossKey(senseId, glossOrder, glossLanguage));

export default function AddFromDictionaryToDeckPage() {
	const router = useRouter();
	const drizzle = useDrizzle();
	const { entryId, config: configParam } = useLocalSearchParams<{
		entryId?: string;
		config?: string;
	}>();
	const { activeLanguageId } = useAppLanguage();
	const deckStoreRevision = useSelector(() => decks$.revision.get());
	const [config, setConfig] = useState<KnowledgeDefinitionConfig | null>(null);
	const previousEntryIdRef = useRef<string | null>(null);
	const { entryResult: entry, existingKnowledgeRows } = useEntryLookup({
		db: drizzle,
		requestKey: "add-to-deck-screen",
		entryId,
		languageId: activeLanguageId,
		includeKnowledgeVariants: true,
		refreshToken: deckStoreRevision,
	});

	const routeConfig = useMemo(
		() => parseKnowledgeConfig(configParam),
		[configParam],
	);

	useEffect(() => {
		if (!entry) {
			previousEntryIdRef.current = null;
			setConfig(null);
			return;
		}

		const routeStateKey = `${entry.id}:${configParam ?? ""}`;
		if (previousEntryIdRef.current !== routeStateKey) {
			previousEntryIdRef.current = routeStateKey;
			setConfig(routeConfig ?? getDefaultKnowledgeDefinitionConfig(entry));
		}
	}, [configParam, entry, routeConfig]);

	const normalizedConfig = useMemo(
		() => (entry ? normalizeKnowledgeDefinitionConfig(entry, config) : null),
		[config, entry],
	);

	const matchingKnowledge = useMemo(() => {
		if (!entry || !normalizedConfig) return null;
		const signature = buildKnowledgeConfigSignature(entry, normalizedConfig);
		return (
			existingKnowledgeRows.find(
				(item) =>
					(item.configSignature ?? DEFAULT_KNOWLEDGE_CONFIG_SIGNATURE) === signature,
			) ?? null
		);
	}, [entry, existingKnowledgeRows, normalizedConfig]);

	const pendingConfigLabel = useMemo(() => {
		if (matchingKnowledge?.configLabel) return matchingKnowledge.configLabel;
		return getNextKnowledgeConfigLabel(
			existingKnowledgeRows.map((item) => item.configLabel),
		);
	}, [existingKnowledgeRows, matchingKnowledge]);

	const entryLanguageId = entry?.languageId ?? null;
	const isEntryInActiveLanguage =
		entryLanguageId === null || entryLanguageId === activeLanguageId;
	const selectedGlossCount = normalizedConfig?.selectedGlossKeys.length ?? 0;
	const selectedSenseCount = normalizedConfig?.selectedSenseIds.length ?? 0;
	const canProceed =
		Boolean(entryId) && isEntryInActiveLanguage && Boolean(selectedGlossCount > 0);

	const toggleSense = (senseId: string, nextSelected: boolean) => {
		if (!entry || !normalizedConfig) return;
		const sense = entry.senses.find((item) => item.id === senseId);
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
		if (!entry || !normalizedConfig) return;
		const targetKey = getGlossKey(senseId, glossOrder, glossLanguage);
		const nextGlossKeys = nextSelected
			? [...new Set([...normalizedConfig.selectedGlossKeys, targetKey])]
			: normalizedConfig.selectedGlossKeys.filter((item) => item !== targetKey);
		const remainingSenseGlosses = entry.senses
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

	const handleNext = () => {
		if (!entryId || !normalizedConfig) return;
		const configParam = JSON.stringify(normalizedConfig);
		router.push(
			`/select-card-type?entryId=${encodeURIComponent(entryId)}&config=${encodeURIComponent(configParam)}`,
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
					<View className="flex-row items-start justify-between gap-3">
						<View className="min-w-0 flex-1">
							<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
								Step 1 of 3
							</Text>
							<Text className="mt-2 text-[28px] font-semibold leading-8 text-zinc-100">
								Select Senses
							</Text>
						</View>
					</View>

					{entry ? (
						<View className="mt-3 gap-2">
							<Text className="text-[30px] font-semibold leading-9 text-zinc-100">
								{entry.canonicalForm ?? entry.forms[0]?.text ?? entryId}
							</Text>
							{entry.canonicalReading ? (
								<Text className="text-base text-zinc-400">{entry.canonicalReading}</Text>
							) : null}
						</View>
					) : entryId ? (
						<View className="mt-3 self-start rounded-full border border-white/8 bg-[#121315] px-3 py-1.5">
							<Text className="text-xs font-medium text-zinc-300">{entryId}</Text>
						</View>
					) : null}

					<View className="mt-4 flex-row flex-wrap gap-2">
						<SummaryPill label={`${selectedSenseCount} sense${selectedSenseCount === 1 ? "" : "s"}`} />
						<SummaryPill
							label={`${selectedGlossCount} definition${selectedGlossCount === 1 ? "" : "s"}`}
						/>
						<SummaryPill
							label={
								matchingKnowledge
									? `Uses ${matchingKnowledge.configLabel ?? pendingConfigLabel}`
									: `Creates ${pendingConfigLabel}`
							}
						/>
					</View>

					{entryId && !isEntryInActiveLanguage ? (
						<Text className="mt-3 text-sm leading-5 text-zinc-500">
							Switch languages in Settings to add this entry to a deck.
						</Text>
					) : null}
					{selectedGlossCount === 0 ? (
						<Text className="mt-3 text-sm leading-5 text-zinc-500">
							Select at least one definition before continuing.
						</Text>
					) : (
						<Text className="mt-3 text-sm leading-5 text-zinc-400">
							Choose the senses and exact definition lines this knowledge card should test.
						</Text>
					)}
				</View>

				{entry && normalizedConfig ? (
					<View className="mt-5 gap-5">
						<View className="gap-2.5">
							<SectionHeader
								title="Senses"
								meta="Select which sense groups belong to this knowledge"
							/>
							<View className="gap-2">
								{entry.senses.map((sense) => {
									const selected = normalizedConfig.selectedSenseIds.includes(sense.id);
									const partOfSpeech = formatPartOfSpeech(sense.partOfSpeech);
									return (
										<ToggleRow
											key={sense.id}
											selected={selected}
											onPress={() => toggleSense(sense.id, !selected)}
											title={partOfSpeech ?? `Sense ${sense.senseOrder}`}
											subtitle={firstGlossPreview(sense) || "No glosses available."}
											trailing={`#${sense.senseOrder}`}
										/>
									);
								})}
							</View>
						</View>

						<View className="gap-2.5">
							<SectionHeader
								title="Definitions"
								meta="Trim each selected sense down to the exact lines you want to review"
							/>
							<View className="gap-3">
								{entry.senses
									.filter((sense) => normalizedConfig.selectedSenseIds.includes(sense.id))
									.map((sense) => {
										const partOfSpeech = formatPartOfSpeech(sense.partOfSpeech);
										return (
											<View
												key={`${sense.id}-definitions`}
												className="rounded-[24px] border border-white/8 bg-[#121315] px-4 py-4"
											>
												<View className="flex-row items-start justify-between gap-3">
													<View className="min-w-0 flex-1">
														<Text className="text-base font-medium text-zinc-100">
															{partOfSpeech ?? `Sense ${sense.senseOrder}`}
														</Text>
													</View>
													<Text className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
														#{sense.senseOrder}
													</Text>
												</View>
												<View className="mt-3 gap-2">
													{sense.glosses.map((gloss) => {
														const selected = isGlossSelected(
															normalizedConfig,
															sense.id,
															gloss.glossOrder,
															gloss.glossLanguage,
														);
														return (
															<ToggleRow
																key={getGlossKey(
																	sense.id,
																	gloss.glossOrder,
																	gloss.glossLanguage,
																)}
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
										);
									})}
							</View>
						</View>
					</View>
				) : null}
			</ScrollView>

			<View className="border-t border-white/8 bg-[#0F1012] px-4 pb-5 pt-3">
				<TouchableOpacity
					activeOpacity={0.85}
					className="h-12 flex-row items-center justify-center gap-2 rounded-2xl bg-zinc-100 disabled:opacity-50"
					onPress={handleNext}
					disabled={!canProceed}
				>
					<Text className="text-base font-medium text-zinc-900">Choose Card Type</Text>
					<ArrowRight size={18} color="#18181b" />
				</TouchableOpacity>
			</View>
		</View>
	);
}

const SectionHeader = ({
	title,
	meta,
}: {
	title: string;
	meta: string;
}) => (
	<View className="gap-1">
		<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
			{title}
		</Text>
		<Text className="text-sm leading-5 text-zinc-400">{meta}</Text>
	</View>
);

const SummaryPill = ({ label }: { label: string }) => (
	<View className="rounded-full border border-white/8 bg-[#121315] px-3 py-1.5">
		<Text className="text-xs font-medium text-zinc-300">{label}</Text>
	</View>
);

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
		className={[
			"rounded-[22px] border px-3.5",
			compact ? "py-3" : "py-3.5",
			selected
				? "border-white/16 bg-[#17191c]"
				: "border-white/8 bg-[#141518]",
		].join(" ")}
		onPress={onPress}
	>
		<View className="flex-row items-start gap-3">
			<View
				className={[
					"mt-0.5 h-5 w-5 items-center justify-center rounded-md border",
					selected ? "border-zinc-200 bg-zinc-100" : "border-white/12 bg-transparent",
				].join(" ")}
			>
				{selected ? <Check size={12} color="#111214" strokeWidth={3} /> : null}
			</View>
			<View className="min-w-0 flex-1 gap-1">
				<Text className="text-sm font-medium leading-5 text-zinc-100">{title}</Text>
				{subtitle ? (
					<Text className="text-sm leading-5 text-zinc-500">{subtitle}</Text>
				) : null}
			</View>
			<Text className="text-[11px] font-medium uppercase tracking-[0.16em] text-zinc-500">
				{trailing}
			</Text>
		</View>
	</TouchableOpacity>
);
