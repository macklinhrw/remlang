import { useLocalSearchParams, useNavigation, useRouter } from "expo-router";
import * as React from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	BackHandler,
	ScrollView,
	TouchableOpacity,
	View,
	useWindowDimensions,
} from "react-native";
import { useFocusEffect } from "@react-navigation/native";
import { createMaterialTopTabNavigator } from "@react-navigation/material-top-tabs";
import { LegendList } from "@legendapp/list";
import { inArray } from "drizzle-orm";
import { ArrowLeft, FolderPlus } from "lucide-react-native";
import pinyin_tone from "pinyin-tone";
import { pinyin } from "pinyin-pro";
import StrokeCanvas from "@/components/drawing/stroke-canvas";
import { PitchAccentSection } from "@/components/japanese/pitch-accent-section";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useDrizzle } from "@/lib/database/DrizzleContext";
import { type EntryDetailResult } from "@/lib/database/lexicon";
import { jaCharacterComponents, jaCharacterData } from "@/lib/database/schema";
import { useAppLanguage } from "@/lib/store/appLanguageStore";
import { useEntryLookup } from "@/lib/store/entryLookupStore";
import {
	type DefinitionSegment,
	parseClassifierDefinition,
	parseDefinitionLine,
	roundNumber,
} from "@/app/dictionary";
import { cn } from "@/lib/utils";

const Tab = createMaterialTopTabNavigator();
type CharacterBackTarget =
	| `/deck/${string}`
	| `/deck/${string}/review`
	| `/folder/${string}/review`
	| `/knowledge/${string}`;
type JaCharacterRow = typeof jaCharacterData.$inferSelect;
type JaCharacterComponentRow = typeof jaCharacterComponents.$inferSelect;
type JaReading = {
	type?: string | null;
	onType?: string | null;
	status?: string | null;
	value: string;
};

const formatReading = (reading: string | null, languageId: string) => {
	if (!reading) return null;
	if (languageId === "lang_zh" && /^[a-z0-9\s:]+$/i.test(reading)) {
		return pinyin_tone(reading);
	}
	return reading;
};

const getPrimaryTraditionalForm = (entry: EntryDetailResult) => {
	return (
		entry.forms.find(
			(form) => form.script === "Hant" && form.text !== entry.canonicalForm,
		)?.text ?? null
	);
};

const getPrimaryMetadata = (entry: EntryDetailResult) => {
	const items: { id: string; label: string; value: string }[] = [];

	if (entry.zhData?.hsk) {
		items.push({ id: "hsk", label: "HSK", value: entry.zhData.hsk });
	}

	if (entry.jaData?.jlpt) {
		items.push({ id: "jlpt", label: "JLPT", value: entry.jaData.jlpt });
	}

	const frequencyRank =
		entry.zhData?.frequencyRank && entry.zhData.frequencyRank <= 30000
			? roundNumber(entry.zhData.frequencyRank)
			: entry.jaData?.frequencyRank
				? roundNumber(entry.jaData.frequencyRank)
				: null;

	if (frequencyRank) {
		items.push({ id: "freq", label: "Rank", value: String(frequencyRank) });
	}

	return items;
};

const getDisplayCharacters = (entry: EntryDetailResult) => {
  return (entry.canonicalForm ?? entry.forms.find((form) => form.isPrimary)?.text ?? "").split("");
};

const hasHanCharacters = (value: string) => /\p{sc=Han}/u.test(value);

const getJapaneseKanjiCharacters = (entry: EntryDetailResult) => {
	const seen = new Set<string>();
	return getDisplayCharacters(entry)
		.filter((character) => hasHanCharacters(character))
		.filter((character) => {
			if (seen.has(character)) return false;
			seen.add(character);
			return true;
		});
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

const formatJapaneseReadings = (value: string | null | undefined) => {
	const readings = parseJsonArray<JaReading>(value);
	const onReadings = readings
		.filter((reading) => reading.type === "ja_on")
		.map((reading) => reading.value);
	const kunReadings = readings
		.filter((reading) => reading.type === "ja_kun")
		.map((reading) => reading.value);

	return {
		onReadings,
		kunReadings,
	};
};

const PART_OF_SPEECH_LABELS: Record<string, string> = {
	"adj-f": "Prenominal adjective",
	"adj-i": "I-adjective",
	"adj-ix": "I-adjective",
	"adj-kari": "Adjective",
	"adj-ku": "Adjective",
	"adj-na": "Na-adjective",
	"adj-nari": "Adjective",
	"adj-no": "Noun modifier",
	"adj-pn": "Pre-noun adjective",
	"adj-shiku": "Adjective",
	"adj-t": "Taru-adjective",
	adv: "Adverb",
	"adv-to": "Adverb",
	aux: "Auxiliary",
	"aux-adj": "Auxiliary adjective",
	"aux-v": "Auxiliary verb",
	conj: "Conjunction",
	ctr: "Counter",
	exp: "Expression",
	int: "Interjection",
	n: "Noun",
	"n-adv": "Adverbial noun",
	"n-pr": "Proper noun",
	"n-pref": "Noun prefix",
	"n-suf": "Noun suffix",
	"n-t": "Temporal noun",
	num: "Numeric",
	pn: "Pronoun",
	pref: "Prefix",
	prt: "Particle",
	suf: "Suffix",
	unc: "Unclassified",
	v1: "Ichidan verb",
	"v1-s": "Ichidan verb",
	v5aru: "Godan verb",
	v5b: "Godan verb",
	v5g: "Godan verb",
	v5k: "Godan verb",
	"v5k-s": "Godan verb",
	v5m: "Godan verb",
	v5n: "Godan verb",
	v5r: "Godan verb",
	"v5r-i": "Godan verb",
	v5s: "Godan verb",
	v5t: "Godan verb",
	v5u: "Godan verb",
	"v5u-s": "Godan verb",
	v5uru: "Godan verb",
	vi: "Intransitive verb",
	vk: "Kuru verb",
	vs: "Suru verb",
	"vs-c": "Suru verb",
	"vs-i": "Suru verb",
	"vs-s": "Suru verb",
	vt: "Transitive verb",
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

const DefinitionGlossRow = ({
	entry,
	gloss,
	index,
}: {
	entry: EntryDetailResult;
	gloss: string;
	index: number;
}) => {
	const classifierText = parseClassifierDefinition(gloss);

	return (
		<View className="flex-row items-start gap-3 py-2.5">
			<View className="mt-0.5 h-6 min-w-6 items-center justify-center rounded-full bg-white/6 px-2">
				<Text className="text-[11px] font-semibold text-zinc-300">{index + 1}</Text>
			</View>
			<View className="min-w-0 flex-1">
				{classifierText ? (
					<Text className="leading-7">
						{classifierText.length > 0 && (
							<Text className={cn("italic text-zinc-400", "text-base")}>
								{classifierText.length === 1 ? "Measure Word: " : "Measure Words: "}
							</Text>
						)}
						{classifierText.simplified?.map((simpChar, cIndex) => {
							const tradChar = classifierText.traditional?.[cIndex];
							return (
								<Text key={`${entry.id}-cl-${index}-${cIndex}`}>
									<Text className={cn("text-blue-100 font-bold", "text-base")}>
										{simpChar}
										{tradChar && (
											<Text className={cn("text-red-100", "text-base")}>
												{" "}
												({tradChar})
											</Text>
										)}
									</Text>
									{classifierText.pinyin[cIndex] && (
										<Text className={cn("font-semibold text-zinc-300", "text-base")}>
											{" "}
											{pinyin_tone(classifierText.pinyin[cIndex].toLowerCase())}
										</Text>
									)}
									{cIndex < classifierText.length - 1 && ", "}
								</Text>
							);
						})}
					</Text>
				) : (
					<Text className="leading-7">
						{parseDefinitionLine(gloss).map(
							(segment: DefinitionSegment, segmentIndex: number) => {
								if (segment.type === "text") {
									return (
										<Text
											key={`${entry.id}-def-${index}-txt-${segmentIndex}`}
											className={cn("text-base text-zinc-200")}
										>
											{segment.content}
										</Text>
									);
								}

								return (
									<Text key={`${entry.id}-def-${index}-styled-${segmentIndex}`}>
										<Text className={cn("font-semibold text-zinc-100", "text-base")}>
											{segment.simplified}
											{segment.traditional && (
												<Text className={cn("text-zinc-400", "text-base")}>
													{" "}
													({segment.traditional})
												</Text>
											)}
										</Text>
										{segment.pinyin && (
											<Text className={cn("text-zinc-400", "text-base")}>
												{" "}
												{pinyin_tone(segment.pinyin.toLowerCase())}
											</Text>
										)}
									</Text>
								);
							},
						)}
					</Text>
				)}
			</View>
		</View>
	);
};

export default function CharacterScreen() {
	const router = useRouter();
	const navigation = useNavigation();
	const {
		entryId: entryIdParam,
		character: characterParam,
		backTo: backToParam,
	} = useLocalSearchParams<{
		entryId?: string;
		character?: string;
		backTo?: string;
	}>();
	const drizzle = useDrizzle();
	const { activeLanguageId } = useAppLanguage();
	const backTo =
		typeof backToParam === "string" && backToParam.length > 0
			? (backToParam as CharacterBackTarget)
			: null;
	const handleBack = useCallback(() => {
		if (backTo) {
			router.replace(backTo);
			return;
		}

		if (navigation.canGoBack()) {
			navigation.goBack();
			return;
		}

		router.replace("/decks");
	}, [backTo, navigation, router]);

	useEffect(() => {
		navigation.setOptions({
			headerLeft: backTo
				? () => (
						<TouchableOpacity
							activeOpacity={0.85}
							className="ml-4 h-10 w-10 items-center justify-center rounded-2xl border border-white/8 bg-[#141518]"
							onPress={handleBack}
						>
							<ArrowLeft size={18} color="#fafafa" />
						</TouchableOpacity>
					)
				: undefined,
		});
	}, [backTo, handleBack, navigation]);

	useFocusEffect(
		useCallback(() => {
			if (!backTo) {
				return;
			}

			const subscription = BackHandler.addEventListener("hardwareBackPress", () => {
				handleBack();
				return true;
			});

			return () => {
				subscription.remove();
			};
		}, [backTo, handleBack]),
	);
	const { entryResult, isLoading, errorMessage } = useEntryLookup({
		db: drizzle,
		requestKey: "character-screen",
		entryId: entryIdParam,
		character: characterParam,
		languageId: activeLanguageId,
		includeKnowledgeVariants: false,
	});

	if (isLoading) {
		return (
			<View className="flex-1 items-center justify-center">
				<Text>Loading...</Text>
			</View>
		);
	}

	if (!entryResult) {
		return (
			<View className="flex-1 items-center justify-center p-4">
				<Text>{errorMessage ?? "Entry not found."}</Text>
			</View>
		);
	}

	return (
		<View className="flex-1">
			<InnerCharacter entryResult={entryResult} backTo={backTo} />
		</View>
	);
}

const InnerCharacter = ({
	entryResult,
	backTo,
}: {
	entryResult: EntryDetailResult;
	backTo: CharacterBackTarget | null;
}) => {
	const router = useRouter();
	const { width } = useWindowDimensions();
	const [characterIndex, setCharacterIndex] = useState(0);

	const strokeCharacters = useMemo(
		() =>
			entryResult.languageId === "lang_ja"
				? getJapaneseKanjiCharacters(entryResult)
				: getDisplayCharacters(entryResult),
		[entryResult],
	);
	const currentCharacter = useMemo(
		() => strokeCharacters[characterIndex] ?? "",
		[characterIndex, strokeCharacters],
	);
	const formattedReading = useMemo(
		() => formatReading(entryResult.canonicalReading, entryResult.languageId),
		[entryResult.canonicalReading, entryResult.languageId],
	);
	const traditionalForm = useMemo(
		() => getPrimaryTraditionalForm(entryResult),
		[entryResult],
	);
	const metadataItems = useMemo(
		() => getPrimaryMetadata(entryResult),
		[entryResult],
	);
	const hasNextCharacter = characterIndex < strokeCharacters.length - 1;
	const hasPrevCharacter = characterIndex > 0;

	useEffect(() => {
		setCharacterIndex(0);
	}, [entryResult.id]);

	const handleNextCharacter = useCallback(() => {
		if (hasNextCharacter) setCharacterIndex((value) => value + 1);
	}, [hasNextCharacter]);

	const handlePrevCharacter = useCallback(() => {
		if (hasPrevCharacter) setCharacterIndex((value) => value - 1);
	}, [hasPrevCharacter]);

	return (
		<View className="flex-1">
			<View className="border-b border-white/8 px-4 pb-2 pt-3">
				<View className="flex-row items-start gap-3">
					<View className="min-w-0 flex-1">
						<View className="flex-row items-start justify-between gap-3">
							<Text className="flex-1 text-[30px] font-semibold leading-[34px] text-zinc-100">
								{entryResult.canonicalForm}
							</Text>
							<Button
								onPress={() =>
									router.push(`/add-from-dictionary-to-deck?entryId=${entryResult.id}`)
								}
								size="icon"
								className="mt-0.5 h-9 w-9 rounded-xl border border-white/10 bg-white/5"
								accessibilityLabel="Add to deck"
							>
								<FolderPlus size={18} color="#E5E7EB" />
							</Button>
						</View>
						<View className="mt-1.5 flex-row flex-wrap items-center gap-x-3 gap-y-1">
							{formattedReading && (
								<Text className="text-lg font-medium text-zinc-200">
									{formattedReading}
								</Text>
							)}
							{traditionalForm && traditionalForm !== entryResult.canonicalForm && (
								<Text className="text-sm text-zinc-500">{traditionalForm}</Text>
							)}
						</View>
						{metadataItems.length > 0 && (
							<View className="mt-2 flex-row flex-wrap gap-2">
								{metadataItems.map((item) => (
									<View
										key={item.id}
										className="flex-row items-center gap-1.5 rounded-full border border-white/8 bg-white/[0.04] px-2.5 py-1"
									>
										<Text className="text-[10px] font-medium uppercase tracking-[0.16em] text-zinc-500">
											{item.label}
										</Text>
										<Text className="text-sm font-semibold text-zinc-100">
											{item.value}
										</Text>
									</View>
								))}
							</View>
						)}
					</View>
				</View>
			</View>
			<Tab.Navigator
				screenOptions={{
					tabBarScrollEnabled: true,
					tabBarStyle: {
						backgroundColor: "#0F1012",
						borderBottomColor: "rgba(255,255,255,0.08)",
						borderBottomWidth: 1,
						elevation: 0,
						shadowOpacity: 0,
					},
					tabBarIndicatorStyle: {
						backgroundColor: "#E5E7EB",
						height: 2,
						borderRadius: 999,
					},
					tabBarLabelStyle: {
						fontSize: 13,
						fontWeight: "600",
						textTransform: "none",
					},
					tabBarItemStyle: {
						width: "auto",
					},
					tabBarActiveTintColor: "#F4F4F5",
					tabBarInactiveTintColor: "#71717A",
					tabBarPressColor: "transparent",
				}}
			>
				<Tab.Screen name="definitions">
					{() => <DefinitionsTab entryResult={entryResult} />}
				</Tab.Screen>
				<Tab.Screen name="examples">
					{() => <ExamplesTab entryResult={entryResult} />}
				</Tab.Screen>
				<Tab.Screen name="stroke">
					{() => (
						<StrokeTab
							entryResult={entryResult}
							strokeCharacters={strokeCharacters}
							currentCharacter={currentCharacter}
							characterIndex={characterIndex}
							characterCount={strokeCharacters.length}
							hasNextCharacter={hasNextCharacter}
							hasPrevCharacter={hasPrevCharacter}
							onNext={handleNextCharacter}
							onPrev={handlePrevCharacter}
							width={width}
						/>
					)}
				</Tab.Screen>
				{entryResult.languageId === "lang_ja" && entryResult.pitchAccents.length > 0 && (
					<Tab.Screen name="pitch">
						{() => (
							<View className="flex-1 p-4 pb-6">
								<PitchAccentSection
									pitchAccents={entryResult.pitchAccents}
									preferredReading={entryResult.canonicalReading}
									className="border-t-0 pt-0"
								/>
							</View>
						)}
					</Tab.Screen>
				)}
				{entryResult.languageId === "lang_ja" && (
					<Tab.Screen name="decomposition">
						{() => (
							<JapaneseDecompositionTab
								strokeCharacters={strokeCharacters}
								currentCharacter={currentCharacter}
								characterIndex={characterIndex}
								characterCount={strokeCharacters.length}
								backTo={backTo}
							/>
						)}
					</Tab.Screen>
				)}
			</Tab.Navigator>
		</View>
	);
};

const DefinitionItem = ({
	entry,
	sense,
	index,
}: {
	entry: EntryDetailResult;
	sense: EntryDetailResult["senses"][number];
	index: number;
}) => {
	const partOfSpeech = formatPartOfSpeech(sense.partOfSpeech);
	const senseTitle = partOfSpeech ?? "Definition";
	return (
		<View
			key={`${entry.id}-def-${index}`}
			className="rounded-2xl border border-white/8 bg-[#111214] px-4 py-4"
		>
			<View className="mb-3 flex-row items-start justify-between gap-3 border-b border-white/6 pb-3">
				<View className="min-w-0 flex-1">
					<Text className="text-sm font-medium text-zinc-300">{senseTitle}</Text>
				</View>
				<View className="h-7 min-w-7 items-center justify-center rounded-full border border-white/8 bg-white/[0.04] px-2">
					<Text className="text-[11px] font-semibold text-zinc-300">
						{index + 1}
					</Text>
				</View>
			</View>
			<View>
				{sense.glosses.map((gloss, glossIndex) => (
					<View
						key={`${entry.id}-sense-${sense.id}-gloss-${gloss.glossOrder}`}
						className={cn(glossIndex > 0 && "border-t border-white/6")}
					>
						<DefinitionGlossRow
							entry={entry}
							gloss={gloss.text}
							index={glossIndex}
						/>
					</View>
				))}
			</View>
		</View>
	);
};

const hasStructuredSenses = (entry: EntryDetailResult) =>
	entry.senses.some((sense) => {
		const hasPartOfSpeech = Boolean(sense.partOfSpeech?.trim());
		const hasMultipleGlosses = sense.glosses.length > 1;
		return hasPartOfSpeech || hasMultipleGlosses;
	});

const FlatDefinitionsCard = ({ entry }: { entry: EntryDetailResult }) => {
	const glosses = entry.senses.flatMap((sense) => sense.glosses);

	return (
		<View className="rounded-2xl border border-white/8 bg-[#111214] px-4 py-2">
			{glosses.map((gloss, index) => (
				<View
					key={`${entry.id}-flat-gloss-${index}-${gloss.glossOrder}`}
					className={cn(index > 0 && "border-t border-white/6")}
				>
					<DefinitionGlossRow entry={entry} gloss={gloss.text} index={index} />
				</View>
			))}
		</View>
	);
};

const DefinitionsTab = ({ entryResult }: { entryResult: EntryDetailResult }) => {
	const useStructuredSenses = useMemo(
		() => hasStructuredSenses(entryResult),
		[entryResult],
	);

	return (
		<View className="flex-1 p-4 pb-6">
			{useStructuredSenses ? (
				<LegendList
					data={entryResult.senses}
					renderItem={({ item, index }) => (
						<DefinitionItem entry={entryResult} sense={item} index={index} />
					)}
					keyExtractor={(item) => item.id}
					ListEmptyComponent={<Text>No results</Text>}
					estimatedItemSize={140}
					contentContainerStyle={{ gap: 12, paddingBottom: 12 }}
					recycleItems
				/>
			) : entryResult.senses.length > 0 ? (
				<FlatDefinitionsCard entry={entryResult} />
			) : (
				<Text>No results</Text>
			)}
		</View>
	);
};

const ExampleItem = ({
	entryResult,
	example,
}: {
	entryResult: EntryDetailResult;
	example: EntryDetailResult["examples"][number];
}) => {
	const englishTranslation =
		example.translations.find((translation) => translation.languageCode === "eng")
			?.text ?? example.translations[0]?.text;

	return (
		<View className="rounded-2xl border border-white/8 bg-[#111214] px-4 py-4">
			<View className="mb-2">
				<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
					Example
				</Text>
			</View>
			<Text className="text-base text-zinc-100">{example.text}</Text>
			{entryResult.languageId === "lang_zh" && (
				<Text className="mt-1 text-sm italic text-zinc-400">{pinyin(example.text)}</Text>
			)}
			{englishTranslation && (
				<Text className="mt-2 text-sm text-zinc-300">{englishTranslation}</Text>
			)}
		</View>
	);
};

const ExamplesTab = ({ entryResult }: { entryResult: EntryDetailResult }) => {
	return (
		<View className="flex-1 p-4 pb-6">
			<LegendList
				data={entryResult.examples}
				renderItem={({ item }) => (
					<ExampleItem entryResult={entryResult} example={item} />
				)}
				keyExtractor={(item) => item.id}
				ListEmptyComponent={<Text>No results</Text>}
				estimatedItemSize={120}
				contentContainerStyle={{ gap: 12 }}
				recycleItems
			/>
		</View>
	);
};

const CharacterNavigatorButtons = ({
	count,
	activeIndex,
	onNext,
	onPrev,
	canNext,
	canPrev,
	label,
}: {
	count: number;
	activeIndex: number;
	onNext: () => void;
	onPrev: () => void;
	canNext: boolean;
	canPrev: boolean;
	label: string;
}) => {
	if (count <= 1) {
		return null;
	}

	return (
		<View className="mt-3 w-full self-stretch pb-1">
			<View className="mb-1 items-center">
				<Text className="text-[11px] font-medium uppercase tracking-[0.18em] text-zinc-500">
					{label}
				</Text>
				<Text className="mt-0.5 text-sm text-zinc-300">
					{activeIndex + 1} / {count}
				</Text>
			</View>
			<View className="w-full flex-row gap-2">
				<Button
					onPress={onPrev}
					disabled={!canPrev}
					size="sm"
					className="h-10 min-w-0 basis-0 flex-1 rounded-2xl border border-white/8 bg-[#15171A] px-0"
				>
					<Text className="text-sm font-medium text-zinc-100">Prev</Text>
				</Button>
				<Button
					onPress={onNext}
					disabled={!canNext}
					size="sm"
					className="h-10 min-w-0 basis-0 flex-1 rounded-2xl border border-white/8 bg-[#15171A] px-0"
				>
					<Text className="text-sm font-medium text-zinc-100">Next</Text>
				</Button>
			</View>
		</View>
	);
};

const StrokeTab = ({
	entryResult,
	strokeCharacters,
	currentCharacter,
	characterIndex,
	characterCount,
	hasNextCharacter,
	hasPrevCharacter,
	onNext,
	onPrev,
	width,
}: {
	entryResult: EntryDetailResult;
	strokeCharacters: string[];
	currentCharacter: string;
	characterIndex: number;
	characterCount: number;
	hasNextCharacter: boolean;
	hasPrevCharacter: boolean;
	onNext: () => void;
	onPrev: () => void;
	width: number;
}) => {
	const drizzle = useDrizzle();
	const [japaneseKanjiRows, setJapaneseKanjiRows] = useState<JaCharacterRow[]>([]);
	const [strokeViewportWidth, setStrokeViewportWidth] = useState<number | null>(null);
	const canvasWidth = Math.max(180, strokeViewportWidth ?? width - 16);
	const canvasHeight = canvasWidth * 0.9;

	useEffect(() => {
		let cancelled = false;

		const fetchJapaneseKanji = async () => {
			if (entryResult.languageId !== "lang_ja" || strokeCharacters.length === 0) {
				if (!cancelled) setJapaneseKanjiRows([]);
				return;
			}

			const rows = await drizzle.query.jaCharacterData.findMany({
				where: inArray(jaCharacterData.character, strokeCharacters),
			});

			if (!cancelled) {
				const rowsByCharacter = new Map(rows.map((row) => [row.character, row]));
				setJapaneseKanjiRows(
					strokeCharacters
						.map((character) => rowsByCharacter.get(character))
						.filter((row): row is JaCharacterRow => !!row),
				);
			}
		};

		void fetchJapaneseKanji();

		return () => {
			cancelled = true;
		};
	}, [drizzle, entryResult.languageId, strokeCharacters]);

	const currentJapaneseKanjiRow = useMemo(
		() => japaneseKanjiRows.find((row) => row.character === currentCharacter) ?? null,
		[currentCharacter, japaneseKanjiRows],
	);

	if (entryResult.languageId === "lang_ja") {
		if (strokeCharacters.length === 0) {
			return (
				<View className="flex-1 items-center justify-center p-4">
					<Text>This entry is usually written without kanji.</Text>
				</View>
			);
		}

		return (
			<View className="flex-1 px-4 pb-2 pt-1">
				<View
					className="flex-1"
					onLayout={(event) =>
						setStrokeViewportWidth(event.nativeEvent.layout.width)
					}
				>
					<View className="items-start justify-center">
						{currentJapaneseKanjiRow?.svg ? (
							<StrokeCanvas
								character={currentCharacter}
								languageId="lang_ja"
								width={canvasWidth}
								height={canvasHeight}
								showStaticPreview
							/>
						) : (
							<View className="items-center justify-center py-12">
								<Text>No stroke SVG data found for {currentCharacter}.</Text>
							</View>
						)}
					</View>
					<CharacterNavigatorButtons
						count={characterCount}
						activeIndex={characterIndex}
						onNext={onNext}
						onPrev={onPrev}
						canNext={hasNextCharacter}
						canPrev={hasPrevCharacter}
						label="Kanji"
					/>
				</View>
			</View>
		);
	}

	if (entryResult.languageId !== "lang_zh" || !currentCharacter) {
		return (
			<View className="flex-1 items-center justify-center p-4">
				<Text>Stroke practice is only available for Chinese entries right now.</Text>
			</View>
		);
	}

	return (
		<View className="flex-1 px-4 pb-2 pt-1">
			<View
				className="flex-1"
				onLayout={(event) =>
					setStrokeViewportWidth(event.nativeEvent.layout.width)
				}
			>
				<View className="items-start justify-center">
					<StrokeCanvas
						character={currentCharacter}
						languageId="lang_zh"
						width={canvasWidth}
						height={canvasHeight}
						showStaticPreview
					/>
				</View>
				<CharacterNavigatorButtons
					count={characterCount}
					activeIndex={characterIndex}
					onNext={onNext}
					onPrev={onPrev}
					canNext={hasNextCharacter}
					canPrev={hasPrevCharacter}
					label="Character"
				/>
			</View>
		</View>
	);
};

const JapaneseDecompositionTab = ({
	strokeCharacters,
	currentCharacter,
	characterIndex,
	characterCount,
	backTo,
}: {
	strokeCharacters: string[];
	currentCharacter: string;
	characterIndex: number;
	characterCount: number;
	backTo: CharacterBackTarget | null;
}) => {
	const drizzle = useDrizzle();
	const router = useRouter();
	const [componentRows, setComponentRows] = useState<JaCharacterComponentRow[]>([]);
	const [characterRows, setCharacterRows] = useState<JaCharacterRow[]>([]);
	const characterRouteParams = backTo ? { backTo } : undefined;

	useEffect(() => {
		let cancelled = false;

		const fetchDecompositionData = async () => {
			if (strokeCharacters.length === 0) {
				if (!cancelled) {
					setComponentRows([]);
					setCharacterRows([]);
				}
				return;
			}

			const components = await drizzle.query.jaCharacterComponents.findMany({
				where: inArray(jaCharacterComponents.character, strokeCharacters),
			});

			const charactersToLoad = Array.from(
				new Set([
					...strokeCharacters,
					...components.map((component) => component.component),
				]),
			);

			const rows =
				charactersToLoad.length > 0
					? await drizzle.query.jaCharacterData.findMany({
							where: inArray(jaCharacterData.character, charactersToLoad),
						})
					: [];

			if (!cancelled) {
				setComponentRows(components);
				setCharacterRows(rows);
			}
		};

		void fetchDecompositionData();

		return () => {
			cancelled = true;
		};
	}, [drizzle, strokeCharacters]);

	const currentComponents = useMemo(
		() =>
			componentRows
				.filter((row) => row.character === currentCharacter)
				.sort(
					(left, right) =>
						(left.componentOrder ?? Number.MAX_SAFE_INTEGER) -
						(right.componentOrder ?? Number.MAX_SAFE_INTEGER),
				),
		[currentCharacter, componentRows],
	);

	const characterRowsByCharacter = useMemo(
		() => new Map(characterRows.map((row) => [row.character, row])),
		[characterRows],
	);
	const showTopLevelKanji = strokeCharacters.length > 1;

	if (strokeCharacters.length === 0) {
		return (
			<View className="flex-1 items-center justify-center p-4">
				<Text>This entry is usually written without kanji.</Text>
			</View>
		);
	}

	return (
		<ScrollView
			className="flex-1"
			contentContainerClassName="p-4"
			contentContainerStyle={{ paddingBottom: 24 }}
		>
			<View className="gap-2 px-2 pb-4">
				{showTopLevelKanji ? (
					<>
						<Text>Kanji: {characterCount}</Text>
						<Text className="text-sm text-muted-foreground">
							Select a kanji to open its own screen and view its decomposition.
						</Text>
					</>
				) : (
					<>
						<Text>
							Kanji: {characterIndex + 1} / {characterCount}
						</Text>
						<View className="flex flex-row items-baseline gap-3 flex-wrap">
							<Text className="text-3xl font-bold text-blue-100">{currentCharacter}</Text>
							{currentComponents.length > 0 && (
								<Text className="text-sm text-muted-foreground">
									{currentComponents.length} component
									{currentComponents.length === 1 ? "" : "s"}
								</Text>
							)}
						</View>
					</>
				)}
			</View>

			<View className="gap-3">
				{showTopLevelKanji ? (
					strokeCharacters.map((character) => {
						const characterRow = characterRowsByCharacter.get(character) ?? null;
						const { onReadings, kunReadings } = formatJapaneseReadings(
							characterRow?.readingsJson,
						);
						const meanings = parseJsonArray<{ lang: string; value: string }>(
							characterRow?.meaningsJson,
						)
							.filter((meaning) => meaning.lang === "en")
							.map((meaning) => meaning.value)
							.slice(0, 3);

								return (
									<TouchableOpacity
										key={`top-level-kanji-${character}`}
										onPress={() =>
											router.push({
												pathname: "/character",
												params: {
													character,
													...characterRouteParams,
												},
											})
										}
									>
								<View className="rounded-xl border border-border/60 px-4 py-3 gap-2">
									<View className="flex flex-row items-baseline gap-3 flex-wrap">
										<Text className="text-3xl font-bold text-blue-100">
											{character}
										</Text>
										<Text className="text-sm text-muted-foreground">
											Open character
										</Text>
									</View>
									{onReadings.length > 0 && (
										<Text className="text-sm">On: {onReadings.join(" ・ ")}</Text>
									)}
									{kunReadings.length > 0 && (
										<Text className="text-sm">
											Kun: {kunReadings.join(" ・ ")}
										</Text>
									)}
									{meanings.length > 0 && (
										<Text className="text-sm text-muted-foreground">
											{meanings.join(" • ")}
										</Text>
									)}
								</View>
							</TouchableOpacity>
						);
					})
				) : currentComponents.length === 0 ? (
					<View className="items-center justify-center py-12">
						<Text>No decomposition data found for {currentCharacter}.</Text>
					</View>
				) : (
					currentComponents.map((component) => {
						const componentCharacterRow =
							characterRowsByCharacter.get(component.component) ?? null;
						const { onReadings, kunReadings } = formatJapaneseReadings(
							componentCharacterRow?.readingsJson,
						);
						const meanings = parseJsonArray<{ lang: string; value: string }>(
							componentCharacterRow?.meaningsJson,
						)
							.filter((meaning) => meaning.lang === "en")
							.map((meaning) => meaning.value)
							.slice(0, 3);

						return (
							<View
								key={component.id}
								className="rounded-xl border border-border/60 px-4 py-3 gap-2"
							>
								<View className="flex flex-row items-baseline gap-3 flex-wrap">
									<Text className="text-3xl font-bold text-blue-100">
										{component.component}
									</Text>
									<Text className="text-sm text-muted-foreground">
										Part {component.componentOrder ?? "?"}
									</Text>
								</View>
								{onReadings.length > 0 && (
									<Text className="text-sm">
										On: {onReadings.join(" ・ ")}
									</Text>
								)}
								{kunReadings.length > 0 && (
									<Text className="text-sm">
										Kun: {kunReadings.join(" ・ ")}
									</Text>
								)}
								{meanings.length > 0 && (
									<Text className="text-sm text-muted-foreground">
										{meanings.join(" • ")}
									</Text>
								)}
								{onReadings.length === 0 &&
									kunReadings.length === 0 &&
									meanings.length === 0 && (
										<Text className="text-sm text-muted-foreground">
											No reading metadata found for this component.
										</Text>
									)}
							</View>
						);
					})
				)}
			</View>

		</ScrollView>
	);
};
